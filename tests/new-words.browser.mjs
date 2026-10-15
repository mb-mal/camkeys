import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { homography, project } from "../src/core.js";
const source = JSON.parse(
  fs.readFileSync("test-results/live-new-words.json"),
).rows;
const meta = source[0],
  frames = source.filter((r) => r.event === "tracker-frame");
// Recover camera corners from the saved inverse without assuming target letters.
const inverseMatrix = meta.inverse;
const corners = (() => {
  const cameraPoints = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const mapped = cameraPoints.map(([x, y]) => {
    const p = project(inverseMatrix, x, y);
    return [p.x, p.y];
  });
  const f = homography(mapped, cameraPoints);
  return cameraPoints.map(([x, y]) => {
    const p = project(f, x, y);
    return [p.x, p.y];
  });
})();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
  errors = [];
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
        setInterval(() => c.getContext("2d").fillRect(0, 0, 960, 540), 25);
        return c.captureStream(40);
      };
    },
    { corners },
  );
  await page.route("**/tracking.worker.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    const frames=${JSON.stringify(frames)};let i=0,origin=null,clockOffset=0;
    onmessage=({data})=>{
      if(data.type==='init'){postMessage({type:'ready'});return;}
      if(origin===null){origin=data.time;clockOffset=performance.now()-data.time;} const f=frames[i++];data.bitmap.close();
      const time=f?origin+f.time-frames[0].time:data.time;
      const delay=Math.max(0,time-(performance.now()-clockOffset));
      setTimeout(()=>postMessage({type:'result',time,inferenceMs:0,result:{landmarks:(f?.hands||[]).map(h=>h.map(p=>({...p,x:1-p.x})))}}),delay);
    };`,
    }),
  );
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(() =>
    document.getElementById("dictionary-status").textContent.includes("48"),
  );
  assert.equal(await page.locator("#auto-camera-insert").isChecked(), true);
  await page.locator("#trace-start").click();
  await page.evaluate(() => {
    window.overlayStates = [];
    const el = document.getElementById("camera-text");
    new MutationObserver(() =>
      window.overlayStates.push({
        text: el.textContent,
        phase: el.dataset.phase,
      }),
    ).observe(el, {
      childList: true,
      attributes: true,
      attributeFilter: ["data-phase"],
    });
  });
  await page.locator("#camera").click();
  await page.waitForFunction(
    () => document.getElementById("text").value.trim() === "привет воображение",
    null,
    { timeout: 90000 },
  );
  await page.waitForTimeout(2500);
  const overlayStates = await page.evaluate(() => window.overlayStates);
  let previousEnd = -1;
  for (const word of ["привет", "воображение"]) {
    const end = overlayStates.findIndex(
      (s) => s.phase === "fading" && s.text === word,
    );
    assert.ok(end >= 0, `overlay fades ${word} on insertion`);
    assert.ok(
      overlayStates
        .slice(previousEnd + 1, end)
        .some((s) => s.phase === "letters" && s.text),
      "camera movement supplies letters before insertion",
    );
    const prefixes = overlayStates
      .slice(previousEnd + 1, end)
      .filter((s) => s.phase === "letters" && s.text)
      .map((s) => s.text);
    assert.ok(
      prefixes.every((text) => word.startsWith(text)),
      `preview contains only likely word prefixes: ${JSON.stringify(prefixes)}`,
    );
    assert.ok(
      prefixes.every((text, i) => !i || text.startsWith(prefixes[i - 1])),
      "preview must not shrink on ambiguous samples",
    );
    previousEnd = end;
    assert.ok(
      overlayStates.slice(end + 1).some((s) => s.phase === "idle" && !s.text),
      "fade clears the current word",
    );
  }
  assert.equal(await page.locator("#camera-text").textContent(), "");
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  await page.locator("#stop").click();
  assert.equal(
    (await page.locator("#text").inputValue()).trim(),
    "привет воображение",
  );
  await page.locator("#trace-stop").click();
  const trace = JSON.parse(await page.locator("#trace-data").inputValue());
  const commits = trace.rows.filter((r) => r.event === "commit");
  assert.deepEqual(
    commits.map((r) => r.candidate.word),
    ["привет", "воображение"],
  );
  assert.equal(
    trace.rows.filter(
      (r) =>
        r.event === "auto-insert" ||
        (r.event === "insertion-decision" && r.inserted),
    ).length,
    2,
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "test-results/new-words-browser.png",
    fullPage: true,
  });
  fs.writeFileSync(
    "test-results/new-words-browser.json",
    JSON.stringify(
      {
        text: await page.locator("#text").inputValue(),
        commits,
        decisions: trace.rows.filter((r) => r.event === "insertion-decision"),
        errors,
        overlayStates,
      },
      null,
      2,
    ),
  );
  console.log(
    "Original recorded frames automatically insert привет воображение exactly once, without clicking candidates or assigning input text.",
  );
} catch (error) {
  fs.writeFileSync(
    "test-results/new-words-failure.json",
    JSON.stringify(
      {
        error: String(error),
        errors,
        text: await page.locator("#text").inputValue(),
        overlayStates: await page.evaluate(() => window.overlayStates),
        tracking: await page.locator("#tracking").textContent(),
        trace: await page.locator("#trace-data").inputValue(),
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "test-results/new-words-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
