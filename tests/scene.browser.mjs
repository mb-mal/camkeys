import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { depthDemoHands } from "../src/depth-demo.js";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  }),
  page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const fixture = (scale) => {
  const hand = depthDemoHands(0, 0.75, scale)[0];
  [4, 8, 12, 16, 20].forEach(
    (i, f) => (hand[i] = { x: 0.3 + f * 0.025, y: 0.5, z: -0.02 }),
  );
  return hand;
};
let nearHand = fixture(0.22),
  farHand = fixture(0.105);
await context.addInitScript(() => {
  navigator.mediaDevices.getUserMedia = async () => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const ctx = c.getContext("2d");
    setInterval(() => {
      ctx.fillRect(0, 0, 640, 480);
    }, 80);
    return c.captureStream(15);
  };
  window.__sceneCircles = [];
  const clear = CanvasRenderingContext2D.prototype.clearRect,
    arc = CanvasRenderingContext2D.prototype.arc;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    if (this.canvas.id === "scene") window.__sceneCircles = [];
    return clear.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.arc = function (x, y, r, ...args) {
    if (this.canvas.id === "scene") window.__sceneCircles.push({ x, y, r });
    return arc.call(this, x, y, r, ...args);
  };
});
await page.route("**/tracking.worker.js", (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `let phase='near';const channel=new BroadcastChannel('camkeys-projection-fixture');channel.onmessage=({data})=>phase=data;self.onmessage=({data})=>{if(data.type==='init'){self.postMessage({type:'ready'});return;}const hand=phase==='near'?${JSON.stringify(nearHand)}:${JSON.stringify(farHand)};data.bitmap.close();self.postMessage({type:'result',time:data.time,inferenceMs:0,result:{landmarks:[hand]}});};`,
  }),
);
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#text").fill("сохранить текст");
  await page.locator("#text").dispatchEvent("input");
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("finger-count").textContent === "5 / 10" &&
      window.__sceneCircles.length === 5,
  );
  const near = await page.evaluate(() => window.__sceneCircles[0]);
  await page.waitForTimeout(450);
  await page.locator("#depth-calibrate").click();
  await page.waitForFunction(
    () =>
      document
        .getElementById("depth-reference")
        .textContent.includes("ваша калибровка") &&
      document.getElementById("finger-count").textContent === "5 / 10" &&
      window.__sceneCircles.length === 5,
  );
  const calibrated = await page.evaluate(() => window.__sceneCircles[0]);
  assert.ok(
    near.y > calibrated.y && near.r > calibrated.r,
    JSON.stringify({ near, calibrated }),
  );
  await page.evaluate(() => {
    const channel = new BroadcastChannel("camkeys-projection-fixture");
    channel.postMessage("far");
    channel.close();
  });
  await page.waitForFunction(
    () =>
      document
        .getElementById("depth-status")
        .textContent.includes("далеко: 1") &&
      window.__sceneCircles.length === 5,
    {},
    { timeout: 20000 },
  );
  // Let the indicator EMA settle; the filter already exited at the first far sample.
  await page.waitForTimeout(500);
  const far = await page.evaluate(() => window.__sceneCircles[0]);
  assert.ok(
    far.y < calibrated.y && far.r < calibrated.r,
    JSON.stringify({ far, calibrated }),
  );
  assert.equal(await page.locator("#finger-count").textContent(), "0 / 10");
  assert.equal(await page.locator("#text").inputValue(), "сохранить текст");
  await page.screenshot({
    path: "test-results/projection.png",
    fullPage: true,
  });
  await page.locator("#stop").click();
  await page.reload();
  assert.match(
    await page.locator("#depth-reference").textContent(),
    /ваша калибровка/,
  );
  assert.equal(await page.locator("#text").inputValue(), "сохранить текст");
  assert.deepEqual(errors, []);
  const report = {
    near,
    calibrated,
    far,
    errors,
    scope:
      "Artificial landmarks and video; actual UI calibration and canvas rendering, no physical camera or distance verified",
  };
  await writeFile(
    "test-results/projection-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({
    path: "test-results/projection-failure.png",
    fullPage: true,
  });
  await writeFile(
    "test-results/projection-failure.json",
    JSON.stringify(
      {
        error: error.message,
        status: await page.locator("#status").textContent(),
        depth: await page.locator("#depth-status").textContent(),
        circles: await page.evaluate(() => window.__sceneCircles),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
