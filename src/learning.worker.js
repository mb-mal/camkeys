import { PersonalNetwork } from "./network.js";
const network = new PersonalNetwork();
let busy = false;
self.onmessage = async ({ data: { id, type, payload } }) => {
  if (busy) {
    self.postMessage({ id, error: "Сеть занята обучением" });
    return;
  }
  busy = true;
  try {
    let result;
    if (type === "train") {
      const metrics = await network.train(payload, (p) =>
        self.postMessage({ progress: p }),
      );
      result = { metrics, model: await network.serialize() };
    } else if (type === "predict") result = await network.predict(payload);
    else if (type === "restore") {
      await network.restore(payload);
      result = { labels: network.labels };
    } else if (type === "clear") {
      network.dispose();
      result = true;
    } else throw new Error("Неизвестная операция сети");
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message });
  } finally {
    busy = false;
  }
};
