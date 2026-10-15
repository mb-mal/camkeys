export class Telemetry {
  constructor(limit = 50000) {
    this.limit = limit;
    this.rows = [];
    this.active = false;
    this.reason = "Не записывается";
  }
  start(metadata = {}) {
    if (this.active) return;
    if (this.rows.length >= this.limit) return;
    this.active = true;
    this.reason = "Запись";
    this.record("start", { wallTime: new Date().toISOString(), ...metadata });
  }
  record(event, data = {}) {
    if (!this.active) return;
    this.rows.push(
      structuredClone({
        seq: this.rows.length,
        received: performance.now(),
        event,
        ...data,
      }),
    );
    if (this.rows.length >= this.limit) {
      this.active = false;
      this.reason =
        "Лимит журнала достигнут; запись остановлена без удаления данных";
    }
  }
  stop() {
    this.record("stop");
    this.active = false;
    this.reason = "Запись остановлена";
  }
  json() {
    return JSON.stringify({
      schema: 1,
      build: "dwell-trace-2026-10-15",
      rows: this.rows,
    });
  }
}
export const telemetry = new Telemetry();

export function mountTelemetry(metadata) {
  const panel = document.createElement("section");
  panel.className = "card";
  panel.style.padding = "20px";
  panel.innerHTML = `<h2>Диагностика живого ввода</h2>
    <p>Локальный журнал: координаты рук, глубина, таймеры, буквы и кандидаты. Без видео и без отправки на сервер. Сначала включите запись, затем камеру и калибровку. После попытки нажмите «Остановить и показать». Не обновляйте вкладку до сохранения JSON.</p>
    <button id="trace-start">Записать диагностику</button>
    <button id="trace-stop">Остановить и показать</button>
    <button id="trace-export">Скачать JSON</button>
    <p id="trace-status" role="status"></p>
    <details><summary>Сырые события для разбора</summary><textarea id="trace-data" readonly aria-label="Журнал телеметрии" style="width:100%;height:180px"></textarea></details>`;
  document.querySelector("main").prepend(panel);
  const $ = (id) => document.getElementById(id);
  $("trace-start").onclick = () => telemetry.start(metadata());
  $("trace-stop").onclick = () => {
    telemetry.stop();
    $("trace-data").value = telemetry.json();
  };
  $("trace-export").onclick = () => {
    telemetry.stop();
    $("trace-data").value = telemetry.json();
    const url = URL.createObjectURL(
      new Blob([telemetry.json()], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "camkeys-telemetry.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  setInterval(() => {
    $("trace-status").textContent =
      `${telemetry.reason} · ${telemetry.rows.length} / ${telemetry.limit} событий`;
    $("trace-start").disabled =
      telemetry.active || telemetry.rows.length >= telemetry.limit;
  }, 500);
  window.addEventListener("error", (e) =>
    telemetry.record("error", { message: e.message }),
  );
  window.addEventListener("unhandledrejection", (e) =>
    telemetry.record("rejection", { message: String(e.reason) }),
  );
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button)
      telemetry.record("button", {
        id: button.id,
        label: button.textContent.trim(),
      });
  });
}
