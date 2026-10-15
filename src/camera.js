export function acquireCameraStream(request, isCurrent, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(
        new Error(
          "Камера не вернула поток за 20 секунд. Проверьте запрос разрешения в браузере и доступность камеры, затем повторите запуск.",
        ),
      );
    }, timeoutMs);
    Promise.resolve()
      .then(request)
      .then(
        (media) => {
          clearTimeout(timer);
          if (expired || !isCurrent()) {
            media.getTracks().forEach((t) => t.stop());
            if (!expired) reject(new Error("Запуск камеры отменён"));
            return;
          }
          resolve(media);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}
export function waitForVideoFrame(video, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const events = ["loadeddata", "playing", "resize"];
    const cleanup = () => {
      clearTimeout(timer);
      events.forEach((e) => video.removeEventListener(e, check));
      video.removeEventListener("error", fail);
    };
    const fail = (error) => {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error("Ошибка воспроизведения камеры"),
      );
    };
    const check = () => {
      if (
        !video.paused &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            "Камера подключена, но декодированный видеокадр не получен за 8 секунд. Проверьте камеру и повторите запуск.",
          ),
        ),
      timeoutMs,
    );
    events.forEach((e) => video.addEventListener(e, check));
    video.addEventListener("error", fail);
    Promise.resolve()
      .then(() => video.play())
      .then(check, (error) =>
        fail(
          new Error(
            `Не удалось начать воспроизведение видео камеры: ${error.message || String(error)}`,
          ),
        ),
      );
    check();
  });
}
