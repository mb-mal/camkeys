import { chromium } from "playwright";
import assert from "node:assert/strict";
import { wordPath, resample, homography, project } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }),
  errors = [];
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
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#auto-commit").uncheck();
  assert.equal(await page.locator("#camera-text").textContent(), "");
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  const enter = async (word) => {
    await page.locator("#overlay").scrollIntoViewIfNeeded();
    const box = await page.locator("#overlay").boundingBox();
    const points = resample(wordPath(word, "ru"), 32);
    for (let i = 0; i < points.length; i++) {
      const p = project(forward, points[i].x, points[i].y);
      await page.mouse.move(box.x + p.x * box.width, box.y + p.y * box.height);
      if (!i) await page.mouse.down();
      if (!i) {
        await page.waitForFunction(
          (letter) =>
            document.getElementById("camera-text").textContent === letter,
          word[0],
        );
        assert.equal(await page.locator("#camera-text").textContent(), word[0]);
        assert.equal(
          await page.locator("#camera-text").getAttribute("data-phase"),
          "letters",
        );
        assert.equal(
          await page
            .locator("#camera-text")
            .evaluate((el) => Number(getComputedStyle(el).opacity)),
          1,
        );
      }
    }
    await page.mouse.up();
    await page.waitForFunction(
      () => document.getElementById("camera-text").dataset.phase === "word",
    );
    assert.equal(await page.locator("#camera-text").textContent(), word);
    await page
      .locator("#candidates button")
      .filter({ hasText: word + "RU" })
      .click();
  };
  await enter("привет");
  await page.waitForTimeout(700);
  const opacity = await page
    .locator("#camera-text")
    .evaluate((el) => Number(getComputedStyle(el).opacity));
  assert.ok(opacity > 0 && opacity < 1);
  assert.equal((await page.locator("#text").inputValue()).trim(), "привет");
  await enter("мир");
  assert.equal(await page.locator("#camera-text").textContent(), "мир");
  await page.waitForTimeout(1400);
  assert.equal(
    await page.locator("#camera-text").isVisible(),
    true,
    "previous animation cannot hide the newer word",
  );
  await page.waitForTimeout(750);
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  assert.equal(await page.locator("#camera-text").textContent(), "");
  assert.equal(
    await page.locator("#camera-text").getAttribute("data-phase"),
    "idle",
  );
  assert.equal((await page.locator("#text").inputValue()).trim(), "привет мир");
  await page.locator("#toggle-camera-text").click();
  await page.locator("#toggle-camera-text").click();
  assert.equal(await page.locator("#camera-text").isVisible(), true);
  assert.equal(
    await page.locator("#camera-text").textContent(),
    "",
    "visibility updates cannot resurrect an expired word",
  );
  await enter("привет");
  await page.waitForTimeout(2150);
  assert.equal(await page.locator("#camera-text").textContent(), "");
  assert.equal(
    (await page.locator("#text").inputValue()).trim(),
    "привет мир привет",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Three cycles: letters → recognized word → gradual 2-second fade → visible empty field; new input cancels older fade; editor keeps all words.",
  );
} finally {
  await browser.close();
}
