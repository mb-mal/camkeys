import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import { wordPath, resample, homography, project } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage(),
  errors = [],
  words = ["keyboard", "recognition", "possibilities", "don't"];
page.on("pageerror", (e) => errors.push(e.message));
const forward = homography(
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  displayCorners(),
);
let attempting = "";
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(
    () =>
      document
        .getElementById("dictionary-status")
        .textContent.includes("EN:") &&
      !document
        .getElementById("dictionary-status")
        .textContent.includes("резервный"),
  );
  await page.locator("#layout-toggle").click();
  await page.locator("#auto-commit").uncheck();
  await page.evaluate(() => {
    window.pointerEvents = [];
    const canvas = document.getElementById("overlay");
    for (const type of ["pointerdown", "pointermove"])
      canvas.addEventListener(
        type,
        (e) => {
          if (type === "pointerdown") window.pointerEvents = [];
          if (type === "pointermove" && !e.buttons) return;
          const b = canvas.getBoundingClientRect();
          window.pointerEvents.push({
            x: e.clientX,
            y: e.clientY,
            left: b.left,
            top: b.top,
            width: b.width,
            height: b.height,
          });
        },
        true,
      );
  });
  for (const word of words) {
    attempting = word;
    await page.locator("#overlay").scrollIntoViewIfNeeded();
    const box = await page.locator("#overlay").boundingBox(),
      path = resample(wordPath(word, "en"), 72);
    for (let i = 0; i < path.length; i++) {
      const p = project(forward, path[i].x, path[i].y);
      await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height);
      if (!i) await page.mouse.down();
    }
    await page.mouse.up();
    const rects = await page.evaluate(() => window.pointerEvents);
    assert.ok(
      Math.max(...rects.map((r) => r.top)) -
        Math.min(...rects.map((r) => r.top)) <
        1,
      "keyboard must not shift during a word",
    );
    await page.waitForFunction(
      (word) =>
        document.getElementById("camera-text").dataset.phase === "word" &&
        document.getElementById("camera-text").textContent === word,
      word,
    );
    assert.equal(await page.locator("#layout-toggle").textContent(), "EN");
    assert.ok(
      (await page.locator("#candidates small").allTextContents()).every(
        (x) => x === "EN",
      ),
    );
    await page
      .locator("#candidates button")
      .filter({ hasText: word + "EN" })
      .click();
  }
  assert.equal(
    (await page.locator("#text").inputValue()).trim(),
    words.join(" "),
  );
  await page.reload();
  assert.equal(await page.locator("#layout-toggle").textContent(), "EN");
  assert.equal(
    (await page.locator("#text").inputValue()).trim(),
    words.join(" "),
  );
  const degraded = await browser.newPage();
  await degraded.route("**/dictionaries/en_50k.txt", (r) =>
    r.fulfill({ status: 503, body: "unavailable" }),
  );
  await degraded.goto("http://127.0.0.1:5173/");
  await degraded.waitForFunction(() =>
    document
      .getElementById("dictionary-status")
      .textContent.includes("EN: резервный"),
  );
  assert.match(
    await degraded.locator("#dictionary-status").textContent(),
    /RU: 48/,
  );
  assert.equal(await degraded.locator("#layout-toggle").textContent(), "RU");
  await degraded.close();
  assert.deepEqual(errors, []);
  fs.mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/english-layout.png",
    fullPage: true,
  });
  fs.writeFileSync(
    "test-results/english-layout.json",
    JSON.stringify(
      {
        words,
        text: await page.locator("#text").inputValue(),
        errors,
        physicalCamera: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "English full dictionary and contractions work through the actual worker; layout remains manual and persistent; failed EN dictionary does not disable RU.",
  );
} catch (error) {
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(
    "test-results/english-failure.json",
    JSON.stringify(
      {
        attempting,
        error: String(error),
        errors,
        text: await page.locator("#camera-text").textContent(),
        candidates: await page.locator("#candidates").textContent(),
        dictionary: await page.locator("#dictionary-status").textContent(),
        layout: await page.locator("#layout-toggle").textContent(),
        events: await page.evaluate(() => window.pointerEvents),
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "test-results/english-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
