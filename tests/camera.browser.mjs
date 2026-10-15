import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { PersonalNetwork } from "../src/network.js";
import { wordPath } from "../src/core.js";
await mkdir("test-results", { recursive: true });
const image = await readFile("test-results/right_hands.jpg");
const clips = [];
for (const word of ["hello", "world"])
  for (let i = 0; i < 3; i++)
    clips.push({
      word,
      lang: "en",
      source: "pointer",
      frames: [],
      path: wordPath(word, "en"),
    });
const net = new PersonalNetwork();
await net.train(clips, () => {}, 3);
const model = await net.serialize();
net.dispose();
const browser = await chromium.launch({ channel: "msedge", headless: true });
const results = [];
try {
  for (const existing of [false, true]) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1100 },
      }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/fixture-hands.jpg", (r) =>
      r.fulfill({ contentType: "image/jpeg", body: image }),
    );
    await context.addInitScript(
      ({ existing, clips, model }) => {
        if (existing && !sessionStorage.getItem("fixture-seeded")) {
          sessionStorage.setItem("fixture-seeded", "yes");
          localStorage.setItem(
            "camkeys-text",
            JSON.stringify("данные сохраняются"),
          );
          localStorage.setItem(
            "camkeys-clips",
            JSON.stringify({ version: 1, clips }),
          );
          localStorage.setItem("camkeys-network", JSON.stringify(model));
          // A previous calibrated distance can reject all hands. It must not prevent calibration.
          localStorage.setItem(
            "camkeys-depth",
            JSON.stringify({ reference: 0.8, limit: 1.35, calibrated: true }),
          );
        }
        navigator.mediaDevices.getUserMedia = async () => {
          const photo = new Image();
          photo.src = "/fixture-hands.jpg";
          await photo.decode();
          const c = document.createElement("canvas");
          c.width = photo.naturalWidth;
          c.height = photo.naturalHeight;
          const ctx = c.getContext("2d"),
            paint = () => ctx.drawImage(photo, 0, 0);
          paint();
          setInterval(paint, 80);
          return c.captureStream(15);
        };
      },
      { existing, clips, model },
    );
    try {
      await page.goto("http://127.0.0.1:5173/");
      if (existing) {
        await page.waitForFunction(() =>
          document
            .getElementById("network-status")
            .textContent.includes("восстановлена"),
        );
        assert.equal(
          await page.locator("#text").inputValue(),
          "данные сохраняются",
        );
      }
      await page.locator("#calibrate").click();
      await page.locator("#camera").click();
      await page.waitForFunction(
        () =>
          document.getElementById("source-badge").textContent ===
          "Живая камера",
        {},
        { timeout: 30000 },
      );
      assert.equal(
        await page.locator("#calibrate").textContent(),
        "Калибровка",
      );
      await page.waitForFunction(
        () =>
          document
            .getElementById("depth-status")
            .textContent.includes("Рука 1"),
        {},
        { timeout: 20000 },
      );
      const initialDepth = await page.locator("#depth-status").textContent();
      if (existing) assert.match(initialDepth, /далеко: [12]/);
      await page.locator("#calibrate").click();
      assert.equal(
        await page.locator("#calibrate").textContent(),
        "Отменить калибровку",
      );
      await page.waitForTimeout(1200);
      await page.locator("#depth-calibrate").click();
      await page.waitForFunction(
        () =>
          document
            .getElementById("depth-reference")
            .textContent.includes("ваша калибровка") &&
          document
            .getElementById("status")
            .textContent.includes("ладонь принята"),
        {},
        { timeout: 10000 },
      );
      // A static photo verifies real raw-position confirmation, not human finger presses.
      await page.locator("#wizard-confirm").waitFor({ state: "visible" });
      await page.waitForFunction(
        () => !document.getElementById("wizard-confirm").disabled,
      );
      await page.locator("#wizard-confirm").click();
      await page.waitForFunction(() =>
        document.getElementById("wizard-step").textContent.startsWith("Шаг 2"),
      );
      await page.locator("#wizard-cancel").click();
      await page.waitForFunction(
        () =>
          document.getElementById("finger-count").textContent === "10 / 10" ||
          document.getElementById("finger-count").textContent === "5 / 10",
        {},
        { timeout: 15000 },
      );
      const video = await page.locator("#video").evaluate((v) => ({
        width: v.videoWidth,
        height: v.videoHeight,
        readyState: v.readyState,
        paused: v.paused,
      }));
      assert.match(
        await page.locator("#status").textContent(),
        /Ввод готов|Прежняя геометрия сохранена/,
      );
      assert.ok(
        video.width > 0 &&
          video.height > 0 &&
          video.readyState >= 2 &&
          !video.paused,
      );
      await page.screenshot({
        path: `test-results/camera-${existing ? "existing" : "fresh"}.png`,
        fullPage: true,
      });
      await page.locator("#calibrate").click();
      await page.locator("#stop").click();
      assert.equal(
        await page.locator("#calibrate").textContent(),
        "Калибровка",
      );
      await page.locator("#camera").click();
      await page.waitForFunction(
        () =>
          document.getElementById("finger-count").textContent === "10 / 10" ||
          document.getElementById("finger-count").textContent === "5 / 10",
        {},
        { timeout: 30000 },
      );
      await page.locator("#stop").click();
      await page.reload();
      if (existing) {
        assert.equal(
          await page.locator("#text").inputValue(),
          "данные сохраняются",
        );
        assert.equal(
          await page.locator("#sample-count").textContent(),
          "6 записей",
        );
        await page.waitForFunction(() =>
          document
            .getElementById("network-status")
            .textContent.includes("восстановлена"),
        );
      }
      assert.deepEqual(errors, []);
      results.push({
        existing,
        video,
        initialDepth,
        status: "passed",
        scope:
          "Photo video stream + actual MediaPipe WASM/model worker; no physical camera",
      });
    } catch (error) {
      await page.screenshot({
        path: "test-results/camera-failure.png",
        fullPage: true,
      });
      await writeFile(
        "test-results/camera-failure.json",
        JSON.stringify(
          {
            existing,
            error: error.message,
            status: await page.locator("#status").textContent(),
            depth: await page.locator("#depth-status").textContent(),
            errors,
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(
    "test-results/camera-report.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
