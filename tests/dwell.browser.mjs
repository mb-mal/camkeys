import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { depthDemoHands } from "../src/depth-demo.js";
import { pointStraight } from "./hand-fixture.js";
import { calibrationLetters } from "../src/calibration.js";
const lang = process.env.DWELL_LANG || "ru",
  fps = Number(process.env.DWELL_FPS || 25),
  sequence = calibrationLetters[lang],
  firstLetter = sequence[0];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(
  ({ lang, fps }) => {
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
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 960;
      c.height = 540;
      setInterval(() => c.getContext("2d").fillRect(0, 0, 960, 540), 40);
      return c.captureStream(fps);
    };
    window.__keys = {};
    const text = CanvasRenderingContext2D.prototype.fillText;
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
  },
  { lang, fps },
);
const send = (data) =>
  page.evaluate((data) => {
    const c = new BroadcastChannel("dwell-fixture");
    c.postMessage(data);
    c.close();
  }, data);
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#trace-start").click();
  const first = await page.evaluate(
      (l) => window.__keys[l],
      firstLetter.toUpperCase(),
    ),
    base = depthDemoHands(0, 0.5625)[0];
  await page.route("**/tracking.worker.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `
    const straight=${pointStraight.toString()},base=${JSON.stringify(base)};let point=${JSON.stringify(first)},from=point,target=point,start=0,mode='normal';
    new BroadcastChannel('dwell-fixture').onmessage=({data})=>{if(data.mode)mode=data.mode;if(Number.isFinite(data.x)){from={...point};target=data;start=0;}};
    self.onmessage=({data})=>{if(data.type==='init'){postMessage({type:'ready'});return;}start ||= data.time;const u=Math.min(1,(data.time-start)/300);point={x:from.x+(target.x-from.x)*u,y:from.y+(target.y-from.y)*u};
    const p={...point,x:point.x+(mode === "jitter" ? .025 : .0006)*Math.sin(data.time/73),y:point.y+.0006*Math.cos(data.time/87)},hand=base.map(q=>({...q,x:q.x+p.x-.03-base[5].x,y:q.y+p.y+.02-base[5].y}));straight(hand,1,{...p,z:-.1});
    data.bitmap.close();setTimeout(()=>postMessage({type:'result',time:mode==='stale'?data.time-1000:data.time,inferenceMs:0,result:{landmarks:mode==='lost'?[]:[hand.map(q=>({...q,x:1-q.x}))]}}),${Math.floor(1000 / fps)});};`,
    }),
  );
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("source-badge").textContent === "Живая камера",
  );
  await page.locator("#calibrate").click();
  const before = await page.evaluate(() =>
    localStorage.getItem("camkeys-corners"),
  );
  const checks = [],
    started = await page.evaluate(() => performance.now());
  await page.waitForFunction(
    () => document.getElementById("camera-dwell").value >= 1500,
  );
  assert.match(await page.locator("#wizard-step").textContent(), /Шаг 1/);
  await page.waitForFunction(() =>
    document.getElementById("wizard-step").textContent.startsWith("Шаг 2"),
  );
  const firstElapsed = (await page.evaluate(() => performance.now())) - started;
  assert.ok(firstElapsed >= 1900 && firstElapsed < 2900, String(firstElapsed));
  await page.waitForTimeout(7200);
  assert.match(await page.locator("#wizard-step").textContent(), /Шаг 2/);
  checks.push(
    "Rendered Й automatically captured after 2 seconds with no click/flexion; same point held >10 seconds does not capture Ъ",
  );
  console.log(checks.at(-1));
  const point = async (letter) =>
    page.evaluate((l) => window.__keys[l], letter.toUpperCase());
  await send(await point(sequence[1]));
  await page.waitForFunction(
    () => document.getElementById("camera-dwell").value >= 1000,
  );
  await send({ mode: "stale" });
  await page.waitForFunction(
    () =>
      document.getElementById("camera-dwell").value === 0 &&
      document.getElementById("camera-confirm").disabled,
  );
  await send({ mode: "normal" });
  await page.waitForFunction(
    () => document.getElementById("camera-dwell").value >= 1500,
  );
  assert.match(await page.locator("#wizard-step").textContent(), /Шаг 2/);
  await page.waitForFunction(() =>
    document.getElementById("wizard-step").textContent.startsWith("Шаг 3"),
  );
  checks.push(
    "Stale camera frames reset countdown; fresh 2-second hold resumes at same step",
  );
  for (let i = 2; i < sequence.length; i++) {
    await send(await point(sequence[i]));
    await page.waitForFunction(
      ({ step }) =>
        document
          .getElementById("wizard-step")
          .textContent.startsWith(
            step === 10 ? "Проверка завершена" : "Шаг " + (step + 1),
          ),
      { step: i + 1 },
    );
    if (i < 9)
      assert.equal(
        await page.evaluate(() => localStorage.getItem("camkeys-corners")),
        before,
      );
  }
  assert.match(
    await page.locator("#wizard-feedback").textContent(),
    /Контроль пройден/,
  );
  checks.push(
    "All ten actual renderer centers pass independent control by camera dwell, with small XY noise and no click/z press",
  );
  console.log(checks.at(-1));
  await page.locator("#stop").click();
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("finger-count").textContent === "5 / 10" &&
      document
        .getElementById("input-dwell")
        .textContent.startsWith("Удержание:"),
  );
  const typingStart = await page.evaluate(() => performance.now());
  await page.waitForFunction(
    (l) =>
      document.getElementById("gesture").textContent ===
      "Буквы: " + l.toUpperCase(),
    firstLetter,
  );
  const typingElapsed =
    (await page.evaluate(() => performance.now())) - typingStart;
  assert.ok(typingElapsed >= 350 && typingElapsed < 800, String(typingElapsed));
  assert.equal(
    await page.locator("#candidates button").first().textContent(),
    firstLetter + lang.toUpperCase(),
  );
  await page.waitForTimeout(10000);
  assert.equal(
    await page.locator("#gesture").textContent(),
    "Буквы: " + firstLetter.toUpperCase(),
  );
  assert.equal(await page.locator("#text").inputValue(), "сохранить");
  await send({ x: 0.1, y: 0.5 });
  await page.waitForTimeout(550);
  await send(first);
  await page.waitForFunction(
    (l) =>
      document.getElementById("gesture").textContent ===
      "Буквы: " + l.repeat(2).toUpperCase(),
    firstLetter,
  );
  assert.equal(await page.locator("#text").inputValue(), "сохранить");
  await page.locator("#candidates button").first().click();
  assert.equal(
    await page.locator("#text").inputValue(),
    "сохранить " + firstLetter.repeat(2) + " ",
  );
  checks.push(
    "0.5-second normal hold produces single-letter candidates; 10-second hold never repeats or inserts; leave/return repeats letter; only explicit candidate inserts",
  );
  assert.deepEqual(errors, []);
  await page.locator("#trace-stop").click();
  const trace = JSON.parse(await page.locator("#trace-data").inputValue());
  assert.equal(trace.rows.filter((r) => r.event === "calibration-capture" && r.accepted).length, 10);
  for (const event of ["tracker-frame", "projection", "calibration-gate", "dwell", "decode-request", "decode-result", "input-state", "commit"])
    assert.ok(trace.rows.some((r) => r.event === event), event);
  assert.ok(trace.rows.some((r) => r.event === "dwell" && r.fired && r.duration === 2000));
  assert.ok(trace.rows.some((r) => r.event === "dwell" && r.fired && r.duration === 500));
  checks.push("Opt-in telemetry records raw hands, projections, all ten captures, dwell actions, decoding and explicit commit");
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/dwell.png", fullPage: true });
  await writeFile(
    `test-results/dwell-${lang}-${fps}-report.json`,
    JSON.stringify(
      {
        lang,
        fps,
        checks,
        firstElapsed,
        typingElapsed,
        errors,
        physicalCamera: false,
      },
      null,
      2,
    ),
  );
  console.log(checks.at(-1));
} finally {
  await browser.close();
}
