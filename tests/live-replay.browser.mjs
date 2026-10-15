import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { homography, project, keys } from "../src/core.js";
const rows = JSON.parse(
  fs.readFileSync("test-results/live-proizvedenie.json"),
).rows;
const captures = rows.filter((r) => r.event === "calibration-capture");
const anchors = captures.slice(0, 4);
const forward = homography(
  anchors.map((r) => {
    const k = keys("ru").find((k) => k.letter === r.letter.toLowerCase());
    return [k.x, k.y];
  }),
  anchors.map((r) => [r.point.x, r.point.y]),
);
const corners = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
].map(([x, y]) => {
  const p = project(forward, x, y);
  return [p.x, p.y];
});
const frames = rows.filter(
  (r) => r.event === "tracker-frame" && r.time > captures.at(-1).time,
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.addInitScript(
    ({ corners }) => {
      localStorage.setItem("camkeys-corners", JSON.stringify(corners));
      localStorage.setItem("camkeys-calibrated", "true");
      navigator.mediaDevices.getUserMedia = async () => {
        const c = document.createElement("canvas");
        c.width = 960;
        c.height = 540;
        setInterval(() => c.getContext("2d").fillRect(0, 0, 960, 540), 40);
        return c.captureStream(25);
      };
    },
    { corners },
  );
  await page.route("**/tracking.worker.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    const frames=${JSON.stringify(frames)}; let i=0,origin=null;
    onmessage=({data})=>{
      if(data.type==='init'){postMessage({type:'ready'});return;}
      origin ??= data.time; const frame=frames[i++];
      data.bitmap.close();
      const time=frame ? origin+frame.time-frames[0].time : data.time;
      postMessage({type:'result',time,inferenceMs:0,result:{landmarks:(frame?.hands||[]).map(h=>h.map(p=>({...p,x:1-p.x})))}});
    };`,
    }),
  );
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#auto-camera-insert").uncheck();
  await page.waitForFunction(() =>
    document.getElementById("dictionary-status").textContent.includes("48"),
  );
  await page.locator("#trace-start").click();
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#candidates button")?.textContent ===
      "произведениеRU",
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(15000);
  await page.locator("#stop").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#candidates button")?.textContent ===
      "произведениеRU",
  );
  await page.locator("#candidates button").first().click();
  assert.equal(
    (await page.locator("#text").inputValue()).trim(),
    "произведение",
  );
  await page.locator("#trace-stop").click();
  const log = JSON.parse(await page.locator("#trace-data").inputValue());
  const matches = log.rows.filter(
    (r) =>
      r.event === "dictionary-result" &&
      r.accepted &&
      r.results[0]?.word === "произведение",
  );
  assert.ok(
    new Set(matches.map((r) => r.token.session)).size >= 2,
    "both original attempts must reach the UI",
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "test-results/live-replay-browser.png",
    fullPage: true,
  });
  fs.writeFileSync(
    "test-results/live-replay-browser.json",
    JSON.stringify(
      {
        matches: matches.map((r) => ({
          session: r.token.session,
          ms: r.ms,
          candidates: r.results,
        })),
        text: await page.locator("#text").inputValue(),
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "Both recorded attempts reached the UI as top candidate; camera stop preserves results; explicit click inserts произведение.",
  );
} finally {
  await browser.close();
}
