import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { wordPath, resample } from "../src/core.js";
import { displayCorners } from "../src/scene.js";
import { homography, project } from "../src/core.js";
const display = homography(
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  displayCorners(),
);
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  errors = [],
  external = [],
  informational = [];
page.setDefaultTimeout(15000);
page.setDefaultNavigationTimeout(15000);
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") {
    if (m.text() === "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.")
      informational.push(m.text());
    else errors.push(m.text());
  }
});
page.on("request", (r) => {
  if (
    !r.url().startsWith("http://127.0.0.1:5173") &&
    !r.url().startsWith("data:") &&
    !r.url().startsWith("blob:")
  )
    external.push(r.url());
});
const check = [];
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.locator("#layout-en").click();
  await page.getByRole("button", { name: "Демонстрация", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .getElementById("status")
        .textContent.includes("Демонстрация завершена"),
    {},
    { timeout: 15000 },
  );
  await page
    .locator("#candidates button")
    .filter({ hasText: /^helloEN$/ })
    .waitFor();
  await page
    .locator("#candidates button")
    .filter({ hasText: /^helloEN$/ })
    .click();
  assert.equal(await page.locator("#text").inputValue(), "");
  assert.match(await page.locator("#camera-text").textContent(), /Демо.*hello/);
  await page.getByRole("button", { name: "Записать", exact: true }).click();
  assert.match(
    await page.locator("#status").textContent(),
    /Синтетическое демо/,
  );
  check.push(
    "Synthetic demo respects manual EN; preview is separate from real text; no demo training",
  );
  await page.getByRole("button", { name: "Стоп", exact: true }).click();
  await page.locator("#text").fill("hello ");
  await page.locator("#text").dispatchEvent("input");
  const swipe = async (word, lang) => {
    await page.locator("#layout-" + lang).click();
    await page.locator("#overlay").scrollIntoViewIfNeeded();
    const box = await page.locator("#overlay").boundingBox();
    const path = resample(wordPath(word, lang), 40);
    for (let i = 0; i < path.length; i++) {
      const p = project(display, path[i].x, path[i].y),
        x = box.x + p.x * box.width,
        y = box.y + p.y * box.height;
      await page.mouse.move(x, y);
      if (i === 0) await page.mouse.down();
    }
    await page.mouse.up();
    await page.waitForTimeout(100);
  };
  for (const [word, lang] of [
    ["привет", "ru"],
    ["hello", "en"],
  ])
    for (let i = 0; i < 3; i++) {
      await swipe(word, lang);
      await page
        .locator("#candidates button")
        .filter({ hasText: new RegExp(`^${word}${lang.toUpperCase()}$`) })
        .waitFor();
      await page.locator("#label-word").fill(word);
      await page.getByRole("button", { name: "Записать", exact: true }).click();
    }
  assert.equal(await page.locator("#sample-count").textContent(), "6 записей");
  await page.getByRole("button", { name: "Обучить сеть", exact: true }).click();
  await page.waitForFunction(
    () =>
      document
        .getElementById("network-status")
        .textContent.includes("параметров"),
    {},
    { timeout: 120000 },
  );
  check.push(
    "Six robot pointer fixtures recorded; Conv1D trained in browser worker, holdout reported",
  );
  const networkText = await page.locator("#network-status").textContent();
  await swipe("hello", "en");
  assert.ok(
    (await page.locator("#candidates small").allTextContents()).every(
      (l) => l === "EN",
    ),
  );
  check.push(
    "Personal model containing RU/EN classes only offers the manually selected EN classes",
  );
  await page.screenshot({ path: "test-results/desktop.png", fullPage: true });
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт", exact: true }).click();
  await (await downloadPromise).saveAs("test-results/trajectories.json");
  await page.reload();
  await page.waitForFunction(() =>
    document
      .getElementById("network-status")
      .textContent.includes("восстановлена"),
  );
  assert.match(await page.locator("#text").inputValue(), /hello/);
  assert.equal(await page.locator("#sample-count").textContent(), "6 записей");
  assert.equal(await page.locator("#word-count").textContent(), "1 слово");
  check.push(
    "Text, samples and trained weights survive reload; dataset exported",
  );
  await page.locator("#import").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1,"clips":[{"word":"<script>"}]}'),
  });
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.startsWith("Импорт:"),
  );
  assert.equal(await page.locator("#sample-count").textContent(), "6 записей");
  check.push("Malformed import rejected without replacing records");
  await page.locator("summary").click();
  await page.locator("#auto-commit").check();
  const beforeDepth = await page.locator("#text").inputValue();
  await page.locator("#depth-demo").click();
  await page.waitForFunction(
    () =>
      document.getElementById("finger-count").textContent === "5 / 10" &&
      document.getElementById("depth-status").textContent.includes("далеко: 1"),
  );
  await page.screenshot({ path: "test-results/depth.png", fullPage: true });
  await page.waitForFunction(
    () =>
      document
        .getElementById("status")
        .textContent.includes("Демо глубины завершено"),
    {},
    { timeout: 15000 },
  );
  assert.equal(await page.locator("#finger-count").textContent(), "0 / 10");
  assert.match(await page.locator("#depth-status").textContent(), /далеко: 2/);
  assert.equal(await page.locator("#text").inputValue(), beforeDepth);
  assert.equal(await page.locator("#candidates button").count(), 0);
  await page.locator("#label-word").fill("hello");
  await page.locator("#record").click();
  assert.equal(await page.locator("#sample-count").textContent(), "6 записей");
  await page.locator("#depth-calibrate").click();
  assert.match(await page.locator("#status").textContent(), /живой камеры/);
  await page.locator("#stop").click();
  await page.locator("#depth-limit").focus();
  await page.locator("#depth-limit").press("ArrowRight");
  assert.equal(await page.locator("#depth-limit-value").textContent(), "1.40×");
  await page.reload();
  assert.equal(await page.locator("#depth-limit-value").textContent(), "1.40×");
  await page.locator("#depth-reset").click();
  check.push(
    "Depth demo: far fingers excluded, active exit cancels partial word despite auto-commit, no training record, threshold persists",
  );
  const tracker = await page.evaluate(async () => {
    const worker = new Worker("/tracking.worker.js");
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({ error: "timeout" });
      }, 30000);
      worker.onerror = (e) => {
        clearTimeout(timer);
        worker.terminate();
        resolve({ error: e.message });
      };
      worker.onmessage = async ({ data }) => {
        if (data.type === "ready") {
          const c = new OffscreenCanvas(640, 480);
          c.getContext("2d").fillRect(0, 0, 640, 480);
          const bitmap = c.transferToImageBitmap();
          worker.postMessage(
            { type: "frame", bitmap, time: performance.now() },
            [bitmap],
          );
        } else {
          clearTimeout(timer);
          worker.terminate();
          resolve(
            data.type === "result"
              ? {
                  hands: data.result.landmarks.length,
                  inferenceMs: data.inferenceMs,
                }
              : { error: data.message },
          );
        }
      };
      worker.postMessage({ type: "init" });
    });
  });
  assert.equal(tracker.hands, 0, JSON.stringify(tracker));
  check.push(
    "MediaPipe model and WASM initialize in classic worker; blank image inference returns zero hands",
  );
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      const ctx = c.getContext("2d");
      ctx.fillRect(0, 0, 640, 480);
      setInterval(() => ctx.fillRect(0, 0, 640, 480), 80);
      return c.captureStream(15);
    };
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Подключить камеру", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.getElementById("source-badge").textContent === "Живая камера" &&
      document.getElementById("gesture").textContent === "Нужна калибровка" &&
      document.getElementById("finger-count").textContent === "0 / 10",
    {},
    { timeout: 30000 },
  );
  assert.match(await page.locator("#text").inputValue(), /hello/);
  await page.getByRole("button", { name: "Стоп", exact: true }).click();
  check.push(
    "Main camera pipeline consumes a simulated blank video stream, blocks uncalibrated input with no hands, and stops cleanly; no real device accessed",
  );
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Test permission denied", "NotAllowedError");
    };
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Подключить камеру", exact: true })
    .click();
  await page.waitForFunction(() =>
    document
      .getElementById("status")
      .textContent.includes("Доступ к камере запрещён"),
  );
  assert.match(await page.locator("#text").inputValue(), /hello/);
  check.push(
    "Camera permission error is explicit; text retained and mouse fallback available",
  );
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    assert.ok(
      dimensions.scroll <= dimensions.width,
      JSON.stringify(dimensions),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  check.push("No horizontal overflow at 320 / 768 / 1024 / 1440 px");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await writeFile(
    "test-results/browser-report.json",
    JSON.stringify(
      {
        check,
        networkText,
        tracker,
        errors,
        informational,
        external,
        scope:
          "Robot pointer and blank-image tests only; live camera hand accuracy NOT tested",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      { passed: check, tracker, errors, informational, external },
      null,
      2,
    ),
  );
} catch (error) {
  await page.screenshot({
    path: "test-results/browser-failure.png",
    fullPage: true,
  });
  await writeFile(
    "test-results/browser-failure.json",
    JSON.stringify(
      {
        error: error.message,
        errors,
        status: await page.locator("#status").textContent(),
        source: await page.locator("#source-badge").textContent(),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser.close();
}
