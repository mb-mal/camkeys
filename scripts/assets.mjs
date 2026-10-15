import { mkdir, cp, writeFile, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
const url =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
await mkdir("public/models", { recursive: true });
await mkdir("public/vendor", { recursive: true });
await mkdir("public/licenses", { recursive: true });
await cp("node_modules/@mediapipe/tasks-vision/wasm", "public/vendor/wasm", {
  recursive: true,
});
await cp(
  "node_modules/@mediapipe/tasks-vision/vision_bundle.cjs",
  "public/vendor/vision_bundle.js",
);
let exists = false;
try {
  exists = (await stat("public/models/hand_landmarker.task")).size > 1000000;
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
if (!exists) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Модель: HTTP ${response.status}`);
  await writeFile(
    "public/models/hand_landmarker.task",
    Buffer.from(await response.arrayBuffer()),
  );
}
const bytes = await readFile("public/models/hand_landmarker.task");
const hash = createHash("sha256").update(bytes).digest("hex");
if (hash !== "fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1")
  throw new Error(
    "SHA-256 модели не совпадает с проверенным bundle версии 1. Удалите public/models/hand_landmarker.task и повторите загрузку.",
  );
await writeFile(
  "public/models/source.json",
  JSON.stringify(
    {
      url,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    null,
    2,
  ),
);
console.log(`WASM и модель доступны локально (${bytes.length} байт).`);
for (const [name, licenseUrl] of [
  [
    "MediaPipe",
    "https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/LICENSE",
  ],
  [
    "TensorFlow.js",
    "https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE",
  ],
]) {
  try {
    await stat(`public/licenses/${name}.txt`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    const r = await fetch(licenseUrl, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`Лицензия ${name}: HTTP ${r.status}`);
    await writeFile(`public/licenses/${name}.txt`, await r.text());
  }
}
