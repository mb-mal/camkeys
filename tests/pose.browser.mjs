import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pointingFingers } from "../src/hand-pose.js";
import { fistHand, pointStraight } from "./hand-fixture.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const photo = await readFile("test-results/right_hands.jpg");
await page.route("**/pose-photo.jpg", (r) =>
  r.fulfill({ contentType: "image/jpeg", body: photo }),
);
await context.addInitScript(() => {
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
    return c.captureStream(25);
  };
});
try {
  await page.goto("http://127.0.0.1:5173/");
  const actual = await page.evaluate(async () => {
    const img = new Image();
    img.src = "/pose-photo.jpg";
    await img.decode();
    const w = new Worker("/tracking.worker.js");
    try {
      await new Promise((resolve, reject) => {
        w.onmessage = ({ data }) =>
          data.type === "ready"
            ? resolve()
            : data.type === "error"
              ? reject(new Error(data.message))
              : null;
        w.postMessage({ type: "init" });
      });
      const bitmap = await createImageBitmap(img);
      const result = await new Promise((resolve, reject) => {
        w.onmessage = ({ data }) =>
          data.type === "result"
            ? resolve(data.result)
            : data.type === "error"
              ? reject(new Error(data.message))
              : null;
        w.postMessage({ type: "frame", bitmap, time: performance.now() }, [
          bitmap,
        ]);
      });
      return {
        landmarks: result.landmarks,
        aspect: img.naturalHeight / img.naturalWidth,
      };
    } finally {
      w.terminate();
    }
  });
  const detected = actual.landmarks.map((h) =>
    pointingFingers(h, actual.aspect),
  );
  assert.equal(detected.length, 2);
  assert.ok(
    detected.every((bits) => bits.some(Boolean)),
    JSON.stringify(detected),
  );
  checks.push(
    "Actual MediaPipe on official two-hand photo produces eligible extended fingertips",
  );
  const first = fistHand(0.3, 0.16),
    second = fistHand(0.7, 0.2);
  assert.deepEqual(pointingFingers(first, 0.5625), [
    false,
    false,
    false,
    false,
    false,
  ]);
  await page.route("**/tracking.worker.js", (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: `
const straighten=${pointStraight.toString()};let mode='index',lastTime=0,frozenTime=0;const channel=new BroadcastChannel('pose-fixture');channel.onmessage=({data})=>{mode=data;if(mode==='hold')frozenTime=lastTime;};
self.onmessage=({data})=>{if(data.type==='init'){self.postMessage({type:'ready'});return;}
const h=${JSON.stringify(first)}.map(p=>({...p})),other=${JSON.stringify(second)}.map(p=>({...p,x:p.x+.08*Math.sin(data.time/100)}));
const t=mode==='hold'?frozenTime:data.time;lastTime=data.time;
if(mode!=='fist'&&mode!=='lost'){const f=mode==='middle'?2:1,b=1+4*f,a=h[b];straighten(h,f,{x:a.x+.03+.025*Math.sin(t/170),y:a.y-.02,z:-.11-.025*Math.sin(t/190)});}
if(mode==='far'){const wrist={...h[0]};for(let i=1;i<h.length;i++){h[i].x=wrist.x+(h[i].x-wrist.x)*.35;h[i].y=wrist.y+(h[i].y-wrist.y)*.35;h[i].z*=.35;}}
data.bitmap.close();self.postMessage({type:'result',time:data.time,inferenceMs:0,result:{landmarks:mode==='lost'?[]:[h,other].map(hand=>hand.map(p=>({...p,x:1-p.x})))}});};`,
    }),
  );
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      /hand\d+-1/.test(document.getElementById("active-tip").dataset.tipId) &&
      document.getElementById("finger-count").textContent === "10 / 10",
  );
  assert.match(await page.locator("#active-tip").textContent(), /указательный/);
  assert.equal(await page.locator("#finger-count").textContent(), "10 / 10");
  assert.equal(await page.locator("#text").inputValue(), "");
  checks.push(
    "Foreshortened extended index is chosen while larger nearer moving fist and curled digits are excluded",
  );
  const send = (mode) =>
    page.evaluate((mode) => {
      const c = new BroadcastChannel("pose-fixture");
      c.postMessage(mode);
      c.close();
    }, mode);
  const selected = await page
    .locator("#active-tip")
    .getAttribute("data-tip-id");
  await page.evaluate(() => {
    window.__heldSamples = [];
    window.__heldObserver = new MutationObserver(() =>
      window.__heldSamples.push({
        time: performance.now(),
        id: document.getElementById("active-tip").dataset.tipId,
      }),
    );
    window.__heldObserver.observe(document.getElementById("active-tip"), {
      attributes: true,
      attributeFilter: ["data-tip-id"],
    });
  });
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(4000);
    assert.equal(
      await page.locator("#active-tip").getAttribute("data-tip-id"),
      selected,
    );
  }
  await send("hold");
  await page.waitForTimeout(1200);
  const ready = await page.locator("#candidates").textContent();
  await page.waitForTimeout(6200);
  assert.equal(
    await page.locator("#active-tip").getAttribute("data-tip-id"),
    selected,
  );
  assert.match(
    await page.locator("#active-tip").textContent(),
    /удержание.*5 с/,
  );
  assert.equal(await page.locator("#candidates").textContent(), ready);
  const held = await page.evaluate(() => {
    window.__heldObserver.disconnect();
    return window.__heldSamples;
  });
  assert.ok(held.length > 100 && held.every((s) => s.id === selected));
  await send("index");
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator("#active-tip").getAttribute("data-tip-id"),
    selected,
  );
  checks.push(
    "Selection stays uninterrupted across 3/5/10 seconds of motion and over 7 seconds of rest; ready word survives, then motion resumes",
  );
  await send("fist");
  await page.waitForFunction(() =>
    document
      .getElementById("active-tip")
      .textContent.includes("Пальцы согнуты"),
  );
  await page.waitForTimeout(900);
  assert.equal(
    await page.locator("#active-tip").getAttribute("data-tip-id"),
    "",
  );
  assert.equal(await page.locator("#text").inputValue(), "");
  checks.push(
    "Two moving fists yield no active tip, candidates, or inserted words",
  );
  await send("middle");
  await page.waitForFunction(() =>
    /hand\d+-2/.test(document.getElementById("active-tip").dataset.tipId),
  );
  assert.match(await page.locator("#active-tip").textContent(), /средний/);
  assert.equal(await page.locator("#text").inputValue(), "");
  checks.push(
    "Extended middle digit can be selected; implementation does not hard-code index",
  );
  await send("far");
  await page.waitForFunction(() =>
    document
      .getElementById("active-tip")
      .textContent.includes("вне рабочей глубины"),
  );
  assert.equal(await page.locator("#candidates button").count(), 0);
  await send("lost");
  await page.waitForTimeout(600);
  assert.equal(
    await page.locator("#active-tip").getAttribute("data-tip-id"),
    "",
  );
  await send("index");
  await page.waitForFunction(
    () =>
      /hand\d+-1/.test(document.getElementById("active-tip").dataset.tipId) &&
      document.getElementById("finger-count").textContent === "10 / 10",
  );
  assert.notEqual(
    await page.locator("#active-tip").getAttribute("data-tip-id"),
    selected,
  );
  assert.equal(await page.locator("#text").inputValue(), "");
  checks.push(
    "Depth exclusion and actual disappearance interrupt input; return gets a fresh hand identity without joining paths",
  );
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/pose.png", fullPage: true });
  await writeFile(
    "test-results/pose-report.json",
    JSON.stringify(
      { checks, actualPhotoPose: detected, errors, physicalCamera: false },
      null,
      2,
    ),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
