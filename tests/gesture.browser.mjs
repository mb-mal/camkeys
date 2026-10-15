import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { depthDemoHands } from "../src/depth-demo.js";
import { resample, wordPath } from "../src/core.js";
import { pointStraight } from "./hand-fixture.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = depthDemoHands(0, 0.5625)[0];
await context.addInitScript(() => {
  localStorage.setItem(
    "camkeys-depth",
    JSON.stringify({ reference: 0.4, limit: 1.35, calibrated: true }),
  );
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
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 540;
    setInterval(() => canvas.getContext("2d").fillRect(0, 0, 960, 540), 40);
    return canvas.captureStream(25);
  };
});
await page.route("**/tracking.worker.js", (route) =>
  route.fulfill({
    contentType: "application/javascript",
    body: `
let action={type:'idle'},start=null,point={x:.4,y:.6},shift=0;
const pointStraight=${pointStraight.toString()};
const channel=new BroadcastChannel('gesture-fixture');
channel.onmessage=({data})=>{action=data;start=null;};
self.onmessage=({data})=>{
 if(data.type==='init'){self.postMessage({type:'ready'});return;}
 start??=data.time;const elapsed=data.time-start;
 if(action.type==='word'){point=action.points[Math.min(action.points.length-1,Math.floor(elapsed/50))];shift=0;}
 if(action.type==='flick') shift=Math.min(1,elapsed/240)*action.dx;
 if(action.type==='reset')shift=0;
 const template=${JSON.stringify(base)};
 const dx=point.x-.03-template[5].x,dy=point.y+.02-template[5].y;
 const hand=template.map(p=>({...p,x:p.x+dx+shift,y:p.y+dy}));
 pointStraight(hand,1,{x:point.x+shift,y:point.y,z:-.08});
 const other=${JSON.stringify(base)}.map(p=>({...p,x:p.x-.2}));
 if(action.type==='word'){other[12].x+=(Math.floor(elapsed/40)%2)*.005;other[12].z=.04*Math.sin(elapsed/25);}
 if(action.farNoise){const wrist={...other[0]};for(let i=1;i<other.length;i++){other[i].x=wrist.x+(other[i].x-wrist.x)*.45;other[i].y=wrist.y+(other[i].y-wrist.y)*.45;}for(const p of other)p.x+=.05*Math.sin(elapsed/40);}
 if(action.type==='compete') other[12].x=.1+.05*Math.sin(elapsed/130);
 pointStraight(other,2,{...other[12],z:other[12].z-.06});
 data.bitmap.close();self.postMessage({type:'result',time:data.time,inferenceMs:0,result:{landmarks:action.type==='lost'?[]:[hand,other].map(h=>h.map(p=>({...p,x:1-p.x})))}});
};`,
  }),
);
const send = (action) =>
  page.evaluate((action) => {
    const c = new BroadcastChannel("gesture-fixture");
    c.postMessage(action);
    c.close();
  }, action);
const checks = [];
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#layout-toggle").click();
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("source-badge").textContent === "Живая камера",
  );
  await send({
    type: "word",
    points: resample(wordPath("hello", "en"), 28).map((p) => ({
      x: 0.06 + 0.88 * p.x,
      y: 0.38 + 0.52 * p.y,
    })),
  });
  await page.waitForFunction(() =>
    document.getElementById("gesture").textContent.includes("Вне глубины"),
  );
  assert.equal(await page.locator("#finger-count").textContent(), "0 / 10");
  assert.equal(await page.locator("#text").inputValue(), "");
  checks.push(
    "Depth excludes all hands from typing but moving fingertip is still selected for analysis with explicit blocked status",
  );
  await page.waitForTimeout(500);
  await page.locator("#depth-calibrate").click();
  await page.waitForFunction(
    () => document.getElementById("finger-count").textContent === "10 / 10",
  );
  for (const [word, lang] of [
    ["hello", "en"],
    ["привет", "ru"],
  ]) {
    await page.locator("#layout-" + lang).click();
    const points = resample(wordPath(word, lang), 28).map((p) => ({
      x: 0.06 + 0.88 * p.x,
      y: 0.38 + 0.52 * p.y,
    }));
    // Reset origin to the first letter, with no input retained across loss.
    await send({ type: "lost" });
    await page.waitForTimeout(350);
    await send({ type: "word", points: [points[0]] });
    await page.waitForTimeout(400);
    await send({ type: "word", points, farNoise: lang === "ru" });
    await page.waitForFunction(
      () => document.getElementById("gesture").textContent === "Слово готово",
    );
    assert.match(
      await page.locator("#active-tip").getAttribute("data-tip-id"),
      /hand\d+-1/,
    );
    if (lang === "ru") {
      assert.equal(await page.locator("#finger-count").textContent(), "5 / 10");
      checks.push(
        "More active far hand does not intercept the near index tracing RU word",
      );
    }
    assert.equal(
      await page.locator("#text").inputValue(),
      word === "hello" ? "" : "hello ",
    );
    assert.equal(
      await page.locator("#candidates button").first().textContent(),
      word + lang.toUpperCase(),
    );
    await send({ type: "flick", dx: 0.16 });
    await page.waitForFunction(
      (word) =>
        document.getElementById("flick-result").textContent ===
        `Вставлено: ${word}`,
      word,
    );
    assert.equal(
      await page.locator("#text").inputValue(),
      word === "hello" ? "hello " : "hello привет ",
    );
    assert.equal(
      await page.locator("#camera-text").textContent(),
      word === "hello" ? "hello" : "hello привет",
    );
    await page.waitForTimeout(1000);
    assert.equal(
      await page.locator("#text").inputValue(),
      word === "hello" ? "hello " : "hello привет ",
    );
    checks.push(
      `${word}: active index beats other hand's planar jitter and z fluctuations; right flick commits once`,
    );
  }
  await send({ type: "lost" });
  await page.waitForTimeout(350);
  await send({ type: "reset" });
  await page.waitForTimeout(400);
  await send({ type: "flick", dx: 0.16 });
  await page.waitForTimeout(650);
  assert.equal(await page.locator("#text").inputValue(), "hello привет ");
  checks.push(
    "Tracking loss clears candidates; empty flick cannot repeat previous word",
  );
  await send({ type: "lost" });
  await page.waitForTimeout(350);
  const interrupted = resample(wordPath("привет", "ru"), 28).map((p) => ({
    x: 0.06 + 0.88 * p.x,
    y: 0.38 + 0.52 * p.y,
  }));
  await send({ type: "word", points: [interrupted[0]] });
  await page.waitForTimeout(350);
  await send({ type: "word", points: interrupted });
  await page.waitForFunction(
    () => document.getElementById("gesture").textContent === "Скольжение",
  );
  await send({ type: "lost" });
  await page.waitForTimeout(350);
  await page.locator("#label-word").fill("привет");
  await page.locator("#record").click();
  assert.equal(await page.locator("#sample-count").textContent(), "0 записей");
  assert.equal(await page.locator("#candidates button").count(), 0);
  checks.push(
    "An interrupted partial camera word cannot be saved as a training clip",
  );
  await send({ type: "lost" });
  await page.waitForTimeout(350);
  await send({ type: "reset" });
  await page.waitForTimeout(450);
  await send({ type: "compete" });
  await page.waitForFunction(() =>
    /hand\d+-2/.test(document.getElementById("active-tip").dataset.tipId),
  );
  assert.equal(await page.locator("#finger-count").textContent(), "10 / 10");
  assert.equal(await page.locator("#text").inputValue(), "hello привет ");
  checks.push(
    "Both hands and all ten tips remain tracked; moving tip of second hand alone selected",
  );
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/gesture.png", fullPage: true });
  await writeFile(
    "test-results/gesture-report.json",
    JSON.stringify({ checks, errors, physicalCamera: false }, null, 2),
  );
  console.log(checks.join("\n"));
} catch (error) {
  console.log(
    await page.locator("#tracking").textContent(),
    await page.locator("#gesture").textContent(),
    await page.locator("#active-tip").textContent(),
    await page.locator("#candidates").textContent(),
    errors,
  );
  throw error;
} finally {
  await browser.close();
}
