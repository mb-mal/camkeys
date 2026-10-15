import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { wordPath } from "../src/core.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
await context.addInitScript(
  (clip) => {
    if (localStorage.getItem("camkeys-test-fixture") !== "overlay-regression") {
      localStorage.setItem("camkeys-test-fixture", "overlay-regression");
      localStorage.setItem("camkeys-text", JSON.stringify("привет мир"));
      localStorage.setItem("camkeys-layout", JSON.stringify("en"));
      localStorage.setItem(
        "camkeys-clips",
        JSON.stringify({ version: 1, clips: [clip] }),
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
    }
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 960;
      c.height = 540;
      setInterval(() => c.getContext("2d").fillRect(0, 0, 960, 540), 80);
      return c.captureStream(15);
    };
  },
  {
    word: "hello",
    lang: "en",
    source: "pointer",
    path: wordPath("hello", "en"),
    frames: [],
  },
);
await page.route("**/tracking.worker.js", (r) =>
  r.fulfill({
    contentType: "application/javascript",
    body: `self.onmessage=({data})=>{if(data.type==='init'){self.postMessage({type:'ready'});return;}data.bitmap.close();self.postMessage({type:'result',time:data.time,inferenceMs:0,result:{landmarks:[]}});};`,
  }),
);
const saved = () =>
  page.evaluate(() =>
    Object.fromEntries(
      ["camkeys-clips", "camkeys-corners", "camkeys-network"].map((k) => [
        k,
        localStorage.getItem(k),
      ]),
    ),
  );
try {
  await page.goto("http://127.0.0.1:5173/");
  const original = await saved();
  assert.equal(
    await page.locator("#camera-text").isVisible(),
    true,
    "empty field is ready for a new word",
  );
  await page.locator("#text").fill("привет мир");
  assert.equal(await page.locator("#camera-text").textContent(), "");
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1100 });
    const position = await page.evaluate(() => {
      const stage = document.getElementById("stage"),
        box = stage.getBoundingClientRect();
      const top =
        parseFloat(stage.style.getPropertyValue("--keyboard-top")) / 100;
      return {
        overlay: document.getElementById("camera-text").getBoundingClientRect()
          .bottom,
        keyboard: box.top + box.height * top,
      };
    });
    assert.ok(
      position.overlay <= position.keyboard - 6,
      JSON.stringify({ width, position }),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  await page.locator("#toggle-camera-text").click();
  assert.equal(await page.locator("#camera-text").isVisible(), false);
  assert.equal(await page.locator("#text").inputValue(), "привет мир");
  await page.reload();
  assert.equal(await page.locator("#camera-text").isVisible(), false);
  await page.locator("#toggle-camera-text").click();
  await page.locator("#clear-text").click();
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  assert.equal(await page.locator("#text").inputValue(), "");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("camkeys-text")),
    '""',
  );
  await page.locator("#undo").click();
  assert.equal(await page.locator("#camera-text").textContent(), "");
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  await page.locator("#text").fill("");
  await page.locator("#text").dispatchEvent("input");
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  await page.reload();
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  checks.push(
    "Hide keeps real text and persists; clear empties the field and is undoable; editor history never becomes the current word",
  );
  await page.locator("#text").fill("мой текст");
  await page.locator("#text").dispatchEvent("input");
  await page.locator("#demo").click();
  await page.waitForFunction(() =>
    document
      .getElementById("status")
      .textContent.includes("Демонстрация завершена"),
  );
  await page.locator("#candidates button").first().click();
  assert.equal(await page.locator("#text").inputValue(), "мой текст");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("camkeys-text")),
    '"мой текст"',
  );
  assert.match(await page.locator("#camera-text").textContent(), /Демо.*hello/);
  await page.locator("#camera").click();
  await page.waitForFunction(
    () =>
      document.getElementById("source-badge").textContent === "Живая камера",
  );
  assert.equal(await page.locator("#camera-text").textContent(), "");
  assert.deepEqual(await saved(), original);
  await page.locator("#clear-text").click();
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  assert.equal(
    await page.locator("#source-badge").textContent(),
    "Живая камера",
  );
  await page.locator("#stop").click();
  await page.locator("#demo").click();
  await page.locator("#clear-text").click();
  await page.waitForTimeout(3500);
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  assert.equal(await page.locator("#camera-text").textContent(), "");
  assert.equal(await page.locator("#source-badge").textContent(), "Без камеры");
  assert.equal(await page.locator("#candidates button").count(), 0);
  checks.push(
    "Clear cancels a running demo; its later frames cannot recreate the overlay",
  );
  await page.reload();
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  checks.push(
    "Demo preview is marked, never persisted as real text, and disappears on camera transition; clear works in camera without stopping tracking",
  );
  assert.deepEqual(errors, []);
  await page.locator("#text").fill("привет мир мои заметки");
  const sibling = await context.newPage();
  await sibling.goto("http://127.0.0.1:5173/");
  await page.goto(
    "http://127.0.0.1:5173/?cleanupSample=camkeys-sample-2026-10-14",
  );
  assert.equal(
    (await page.locator("#text").inputValue()).trim(),
    "мои заметки",
  );
  await sibling.waitForFunction(
    () => document.getElementById("text").value.trim() === "мои заметки",
  );
  assert.deepEqual(await saved(), original);
  assert.equal(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("camkeys-sample-cleanup-backup")),
    ),
    "привет мир мои заметки",
  );
  await page.reload();
  assert.equal(
    (await page.locator("#text").inputValue()).trim(),
    "мои заметки",
  );
  const isolated = await browser.newContext();
  const cleanPage = await isolated.newPage();
  await cleanPage.goto("http://127.0.0.1:5173/");
  assert.equal(
    await cleanPage.evaluate(() => localStorage.getItem("camkeys-text")),
    null,
  );
  await isolated.close();
  await sibling.close();
  checks.push(
    "Explicit cleanup removes only authorized sample, backs up original, syncs sibling tab, and isolated contexts do not share localStorage",
  );
  await mkdir("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/text-overlay.png",
    fullPage: true,
  });
  await writeFile(
    "test-results/text-overlay-report.json",
    JSON.stringify({ checks, errors, physicalCamera: false }, null, 2),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
