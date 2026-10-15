import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { depthDemoHands } from "../src/depth-demo.js";
import { pointStraight } from "./hand-fixture.js";
import { calibrationLetters } from "../src/calibration.js";
import { displayCorners } from "../src/scene.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const checks = [];
await mkdir("test-results", { recursive: true });
try {
  for (const [lang, width, height, viewport] of [
    ["ru", 960, 540, 1440],
    ["en", 720, 540, 768],
    ["ru", 640, 480, 320],
    ["en", 640, 640, 1024],
  ]) {
    const context = await browser.newContext({
        viewport: { width: viewport, height: 1100 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.addInitScript(
      ({ width, height, lang }) => {
        localStorage.setItem("camkeys-layout", JSON.stringify(lang));
        localStorage.setItem("camkeys-text", JSON.stringify("сохранить"));
        localStorage.setItem(
          "camkeys-corners",
          JSON.stringify([
            [0.06, 0.38],
            [0.94, 0.38],
            [0.94, 0.9],
            [0.06, 0.9],
          ]),
        );
        localStorage.setItem(
          "camkeys-depth",
          JSON.stringify({ reference: 0.4, limit: 1.35, calibrated: true }),
        );
        navigator.mediaDevices.getUserMedia = async () => {
          const c = document.createElement("canvas");
          c.width = width;
          c.height = height;
          setInterval(
            () => c.getContext("2d").fillRect(0, 0, width, height),
            40,
          );
          return c.captureStream(25);
        };
        window.__keys = {};
        window.__point = null;
        const text = CanvasRenderingContext2D.prototype.fillText,
          arc = CanvasRenderingContext2D.prototype.arc;
        CanvasRenderingContext2D.prototype.fillText = function (
          label,
          x,
          y,
          ...rest
        ) {
          if (this.canvas.id === "overlay" && [...label].length === 1)
            window.__keys[label] = {
              x: x / this.canvas.width,
              y: y / this.canvas.height,
            };
          return text.call(this, label, x, y, ...rest);
        };
        CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...rest) {
          if (this.canvas.id === "overlay" && r === 11)
            window.__point = {
              x: x / this.canvas.width,
              y: y / this.canvas.height,
            };
          return arc.call(this, x, y, r, ...rest);
        };
      },
      { width, height, lang },
    );
    const base = depthDemoHands(0, height / width)[0];
    await page.route("**/tracking.worker.js", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: `
      const straight=${pointStraight.toString()},base=${JSON.stringify(base)};let point={x:.5,y:.45},from=point,target=point,start=0;
      new BroadcastChannel('rendered-fixture').onmessage=({data})=>{from={...point};target=data;start=0;};
      self.onmessage=({data})=>{if(data.type==='init'){postMessage({type:'ready'});return;}start ||= data.time;const q=Math.min(1,(data.time-start)/600);point={x:from.x+(target.x-from.x)*q,y:from.y+(target.y-from.y)*q};
      const hand=base.map(p=>({...p,x:p.x+point.x-.03-base[5].x,y:p.y+point.y+.02-base[5].y}));straight(hand,1,{...point,z:-.1});
      const other=base.map(p=>({...p,x:.10+(p.x-base[0].x)*1.3,y:.32+(p.y-base[0].y)*1.3,z:p.z*1.3}));straight(other,1,{x:.14,y:.24,z:-.13});
      data.bitmap.close();postMessage({type:'result',time:data.time,inferenceMs:0,result:{landmarks:[other,hand].map(h=>h.map(p=>({...p,x:1-p.x})))}});};`,
      }),
    );
    const send = (p) =>
      page.evaluate((p) => {
        const c = new BroadcastChannel("rendered-fixture");
        c.postMessage(p);
        c.close();
      }, p);
    const target = async (letter, point = null) => {
      point ||= await page.evaluate(
        (l) => window.__keys[l],
        letter.toUpperCase(),
      );
      await send(point);
      await page.waitForFunction((p) => {
        const q = window.__point;
        return (
          q &&
          Math.hypot(q.x - p.x, q.y - p.y) < 0.002 &&
          !document.getElementById("camera-confirm").disabled
        );
      }, point);
      await page.locator("#camera-confirm").click();
    };
    const saved = () =>
      page.evaluate(() => localStorage.getItem("camkeys-corners"));
    try {
      await page.goto("http://127.0.0.1:5173/");
      await page.locator("#camera").click();
      await page.waitForFunction(
        () =>
          document.getElementById("source-badge").textContent ===
          "Живая камера",
      );
      await page.locator("#calibrate").click();
      const old = await saved();
      // Deliberate duplicates reproduce the error and its recovery on the video.
      const first = await page.evaluate(
        (l) => window.__keys[l],
        calibrationLetters[lang][0].toUpperCase(),
      );
      for (let i = 0; i < 4; i++) {
        await target(calibrationLetters[lang][i], first);
        await page.waitForTimeout(470);
      }
      await page.waitForFunction(
        () => !document.getElementById("camera-retry").hidden,
      );
      assert.match(
        await page.locator("#camera-readiness").textContent(),
        /одной позиции/,
      );
      assert.equal(await saved(), old);
      await page.locator("#camera-retry").click();
      assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
      if (lang === "ru" && width === 960) {
        for (const [step, wrongLetter] of ["ъ", "й", "ю", "я"].entries()) {
          const wrongPoint = await page.evaluate(
            (l) => window.__keys[l],
            wrongLetter.toUpperCase(),
          );
          await target(calibrationLetters[lang][step], wrongPoint);
          await page.waitForTimeout(470);
        }
        await page.waitForFunction(
          () => !document.getElementById("camera-retry").hidden,
        );
        assert.match(
          await page.locator("#camera-readiness").textContent(),
          /Порядок/,
        );
        assert.equal(await saved(), old);
        await page.locator("#camera-retry").click();
      }
      // Every point comes from fillText coordinates of the real 45° renderer.
      for (let i = 0; i < 10; i++) {
        await target(calibrationLetters[lang][i]);
        if (i < 9) assert.equal(await saved(), old);
        if (i === 3)
          await page.setViewportSize({
            width: viewport === 320 ? 768 : 320,
            height: 1100,
          });
      }
      await page.waitForFunction(() =>
        document
          .getElementById("wizard-feedback")
          .textContent.includes("Контроль пройден"),
      );
      assert.equal(await page.locator("#text").inputValue(), "сохранить");
      const corners = JSON.parse(await saved());
      assert.ok(
        corners.every(
          (p, i) =>
            Math.hypot(
              p[0] - displayCorners()[i][0],
              p[1] - displayCorners()[i][1],
            ) < 0.01,
        ),
        "fitted map matches renderer plane, including key offsets",
      );
      assert.deepEqual(errors, []);
      const report = {
        lang,
        video: [width, height],
        viewport,
        stored: JSON.parse(await saved()),
        points: await page.evaluate(() => window.__keys),
        checks:
          "duplicates → retry anchors → 10 rendered centers → independent controls; nearer stationary hand never steals moving index; mirrored observations; resize; saved text",
      };
      checks.push(report);
      console.log(
        `${lang} ${width}×${height}: rendered calibration and recovery passed`,
      );
      await page.screenshot({
        path: `test-results/rendered-${lang}-${width}.png`,
        fullPage: true,
      });
    } catch (error) {
      console.log({
        lang,
        width,
        height,
        step: await page.locator("#wizard-step").textContent(),
        instruction: await page.locator("#wizard-instruction").textContent(),
        ready: await page.locator("#camera-readiness").textContent(),
        point: await page.evaluate(() => window.__point),
        errors,
      });
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(
    "test-results/calibration-rendered-report.json",
    JSON.stringify({ checks, physicalCamera: false }, null, 2),
  );
} finally {
  await browser.close();
}
