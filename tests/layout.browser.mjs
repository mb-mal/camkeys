import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { wordPath, homography, project, resample } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
});
const page = await context.newPage();
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const clip = {
  word: "hello",
  lang: "en",
  source: "pointer",
  path: wordPath("hello", "en"),
  frames: [],
};
await context.addInitScript((clip) => {
  if (!sessionStorage.getItem("seeded")) {
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("camkeys-text", JSON.stringify("сохранённый текст"));
    localStorage.setItem(
      "camkeys-clips",
      JSON.stringify({ version: 1, clips: [clip] }),
    );
  }
}, clip);
const forward = homography(
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  displayCorners(),
);
try {
  await page.goto("http://127.0.0.1:5173/");
  const savedClips = await page.evaluate(() =>
    localStorage.getItem("camkeys-clips"),
  );
  await page.locator("#layout-toggle").click();
  assert.equal(
    await page.locator("#layout-toggle").getAttribute("data-layout"),
    "en",
  );
  await page.locator("#layout-toggle").hover();
  await page.waitForFunction(
    () =>
      getComputedStyle(document.getElementById("layout-toggle"))
        .backgroundColor === "rgb(27, 72, 54)",
  );
  await page.locator("#overlay").scrollIntoViewIfNeeded();
  const box = await page.locator("#overlay").boundingBox();
  const path = resample(wordPath("привет", "ru"), 24).map((p) =>
    project(forward, p.x, p.y),
  );
  for (let i = 0; i < path.length; i++) {
    await page.mouse.move(
      box.x + path[i].x * box.width,
      box.y + path[i].y * box.height,
    );
    if (i === 0) await page.mouse.down();
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  const langs = await page.locator("#candidates small").allTextContents();
  assert.ok(langs.length > 0 && langs.every((l) => l === "EN"));
  assert.equal(
    await page.locator("#layout-toggle").getAttribute("data-layout"),
    "en",
  );
  checks.push(
    "RU-like path in manual EN stays EN; all candidates use selected language",
  );
  await page.getByText("Настройки ввода", { exact: true }).click();
  await page.locator("#auto-commit").check();
  await page.locator("#overlay").scrollIntoViewIfNeeded();
  const b = await page.locator("#overlay").boundingBox();
  await page.mouse.move(b.x + path[0].x * b.width, b.y + path[0].y * b.height);
  await page.mouse.down();
  await page.mouse.move(b.x + path[3].x * b.width, b.y + path[3].y * b.height);
  await page.locator("#layout-toggle").focus();
  await page.keyboard.press("Space");
  await page.mouse.up();
  await page.waitForTimeout(350);
  assert.equal(await page.locator("#text").inputValue(), "сохранённый текст");
  assert.equal(await page.locator("#candidates button").count(), 0);
  checks.push(
    "Changing layout during a path cancels unfinished word and pending decode without insertion",
  );
  await page.locator("#calibrate").click();
  assert.match(await page.locator("#wizard-instruction").textContent(), /Й/);
  await page.locator("#layout-toggle").click();
  assert.equal(await page.locator("#wizard").isVisible(), false);
  assert.match(await page.locator("#status").textContent(), /Мастер отменён/);
  await page.locator("#calibrate").click();
  assert.match(await page.locator("#wizard-instruction").textContent(), /Q/);
  await page.locator("#wizard-cancel").click();
  await page.reload();
  assert.equal(
    await page.locator("#layout-toggle").getAttribute("data-layout"),
    "en",
  );
  assert.equal(await page.locator("#text").inputValue(), "сохранённый текст");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("camkeys-clips")),
    savedClips,
  );
  checks.push(
    "Manual layout persists; wizard language follows it and cancellation preserves data",
  );
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    const toggle = await page.locator("#layout-toggle").boundingBox();
    const stage = await page.locator("#stage").boundingBox();
    assert.ok(
      Math.abs(toggle.width - toggle.height) < 1,
      "language button is circular",
    );
    assert.ok(
      Math.abs(stage.x + stage.width - toggle.x - toggle.width - 12) < 2,
      "language button stays at the camera right edge",
    );
    assert.ok(
      Math.abs(stage.y + stage.height - toggle.y - toggle.height - 12) < 2,
      "language button stays at the camera bottom edge",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  }
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/layout.png", fullPage: true });
  await writeFile(
    "test-results/layout-report.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(checks.join("\n"));
} finally {
  await browser.close();
}
