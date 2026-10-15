import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { homography, project } from "../src/core.js";
const rows = JSON.parse(
  fs.readFileSync("test-results/live-new-words.json"),
).rows;
const frames = rows.filter(
  (r) => r.event === "tracker-frame" && r.time <= 103600,
);
const unit = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  meta = rows[0];
const mapped = unit.map(([x, y]) => {
  const p = project(meta.inverse, x, y);
  return [p.x, p.y];
});
const forward = homography(mapped, unit),
  corners = unit.map(([x, y]) => {
    const p = project(forward, x, y);
    return [p.x, p.y];
  });
const browser = await chromium.launch({ channel: "msedge", headless: true }),
  checks = [];
try {
  for (const mode of ["left-pending", "left-inserted", "right-now"]) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.addInitScript(
        ({ corners }) => {
          localStorage.setItem("camkeys-corners", JSON.stringify(corners));
          localStorage.setItem("camkeys-calibrated", "true");
          localStorage.setItem("camkeys-text", JSON.stringify("до"));
          navigator.mediaDevices.getUserMedia = async () => {
            const c = document.createElement("canvas");
            c.width = 960;
            c.height = 540;
            setInterval(() => c.getContext("2d").fillRect(0, 0, 960, 540), 25);
            return c.captureStream(40);
          };
        },
        { corners },
      );
      await page.route("**/tracking.worker.js", (r) =>
        r.fulfill({
          contentType: "application/javascript",
          body: `
        const frames=${JSON.stringify(frames)};let i=0,origin=null,clockOffset=0,shift=0,commandStart=null;
        const commands = new BroadcastChannel('word-commands');
        commands.onmessage=({data})=>{if(typeof data==='number'){shift=data;commandStart=null;commands.postMessage({ack:data})}};
        onmessage=({data})=>{if(data.type==='init'){postMessage({type:'ready'});return;}
          if(origin===null){origin=data.time;clockOffset=performance.now()-data.time;}const frame=frames[Math.min(i++,frames.length-1)];data.bitmap.close();
          const time=i<=frames.length?origin+frame.time-frames[0].time:data.time;
          if(shift)commandStart??=data.time;
          const dx=shift*Math.min(1,(data.time-(commandStart||data.time))/180);
          setTimeout(()=>postMessage({type:'result',time,inferenceMs:0,result:{landmarks:frame.hands.map(h=>h.map(p=>({...p,x:1-p.x-dx})))}}),Math.max(0,time-(performance.now()-clockOffset)));
        };`,
        }),
      );
      await page.goto("http://127.0.0.1:5173/");
      if (mode === "right-now")
        await page.locator("#auto-camera-insert").uncheck();
      await page.locator("#trace-start").click();
      await page.locator("#camera").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#candidates button")?.textContent ===
          "приветRU",
        null,
        { timeout: 30000 },
      );
      await page.waitForFunction(() => {
        const message = document.getElementById("flick-state").textContent;
        return (
          message.startsWith("Автовставка через") ||
          message === "Влево отменить · вправо вставить"
        );
      });
      if (mode === "left-inserted")
        await page.waitForFunction(
          () => document.getElementById("text").value.trim() === "до привет",
        );
      else
        assert.equal((await page.locator("#text").inputValue()).trim(), "до");
      await page.evaluate(
        (dx) =>
          new Promise((resolve, reject) => {
            const c = new BroadcastChannel("word-commands");
            const timer = setTimeout(() => {
              c.close();
              reject(new Error("Fixture command not acknowledged"));
            }, 3000);
            c.onmessage = ({ data }) => {
              if (data.ack === dx) {
                clearTimeout(timer);
                c.close();
                resolve();
              }
            };
            c.postMessage(dx);
          }),
        mode === "right-now" ? 0.15 : -0.15,
      );
      if (mode === "right-now")
        await page.waitForFunction(
          () => document.getElementById("text").value.trim() === "до привет",
        );
      else
        await page.waitForFunction(
          () =>
            document
              .getElementById("flick-result")
              .textContent.includes("отменен") ||
            document
              .getElementById("flick-result")
              .textContent.includes("отменён") ||
            document
              .getElementById("flick-result")
              .textContent.includes("отменена"),
        );
      await page.waitForTimeout(1800);
      const text = (await page.locator("#text").inputValue()).trim();
      assert.equal(text, mode === "right-now" ? "до привет" : "до");
      assert.deepEqual(errors, []);
      checks.push({ mode, text, errors });
      await page.screenshot({
        path: `test-results/command-${mode}.png`,
        fullPage: true,
      });
    } catch (error) {
      await page
        .locator("#trace-stop")
        .click()
        .catch(() => {});
      fs.writeFileSync(
        `test-results/command-${mode}-failure.json`,
        await page.locator("#trace-data").inputValue(),
      );
      await page.screenshot({
        path: `test-results/command-${mode}-failure.png`,
        fullPage: true,
      });
      throw error;
    } finally {
      await context.close();
    }
  }
  fs.writeFileSync(
    "test-results/word-commands-browser.json",
    JSON.stringify(checks, null, 2),
  );
  console.log(checks);
} finally {
  await browser.close();
}
