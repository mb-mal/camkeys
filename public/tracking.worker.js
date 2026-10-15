// Classic worker: MediaPipe's WASM loader uses importScripts.
self.exports = {};
let tracker = null;
self.onmessage = async ({ data }) => {
  if (data.type === "init") {
    try {
      importScripts("/vendor/vision_bundle.js");
      const { FilesetResolver, HandLandmarker } = self.exports;
      const files = await FilesetResolver.forVisionTasks("/vendor/wasm");
      tracker = await HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "/models/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({
        type: "error",
        message: `Трекер: ${e.message}. Выполните npm run assets и перезапустите камеру.`,
      });
    }
  } else if (data.type === "frame") {
    try {
      if (!tracker) throw new Error("Трекер не готов");
      const start = performance.now();
      const result = tracker.detectForVideo(data.bitmap, data.time);
      self.postMessage({
        type: "result",
        result,
        time: data.time,
        inferenceMs: performance.now() - start,
      });
    } catch (e) {
      self.postMessage({ type: "error", message: e.message });
    } finally {
      data.bitmap.close();
    }
  }
};
