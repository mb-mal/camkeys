import test from "node:test";
import assert from "node:assert/strict";
import { acquireCameraStream, waitForVideoFrame } from "../src/camera.js";
test("camera request timeout releases any stream that resolves late", async () => {
  let deliver,
    stopped = false;
  const request = new Promise((r) => (deliver = r));
  await assert.rejects(
    acquireCameraStream(
      () => request,
      () => true,
      5,
    ),
    /разрешения/,
  );
  deliver({ getTracks: () => [{ stop: () => (stopped = true) }] });
  await new Promise((r) => setTimeout(r, 1));
  assert.equal(stopped, true);
});
test("permission error propagates, and cancelled request cannot attach its stream", async () => {
  await assert.rejects(
    acquireCameraStream(
      () => Promise.reject(new Error("denied")),
      () => true,
      50,
    ),
    /denied/,
  );
  let stopped = false;
  await assert.rejects(
    acquireCameraStream(
      () =>
        Promise.resolve({
          getTracks: () => [{ stop: () => (stopped = true) }],
        }),
      () => false,
      50,
    ),
    /отменён/,
  );
  assert.equal(stopped, true);
});
class Video extends EventTarget {
  constructor() {
    super();
    this.readyState = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.paused = true;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
}
test("video requires a decoded frame and nonzero dimensions, and times out explicitly", async () => {
  const v = new Video();
  await assert.rejects(waitForVideoFrame(v, 5), /кадр/);
  const ready = waitForVideoFrame(v, 50);
  v.readyState = 2;
  v.videoWidth = 640;
  v.videoHeight = 480;
  v.dispatchEvent(new Event("loadeddata"));
  await ready;
});
test("playback failure is identified as video playback rather than camera permission denial", async () => {
  const v = new Video();
  v.play = () =>
    Promise.reject(new DOMException("autoplay blocked", "NotAllowedError"));
  await assert.rejects(
    waitForVideoFrame(v, 50),
    (error) =>
      error.name === "Error" && error.message.includes("воспроизведение"),
  );
});
