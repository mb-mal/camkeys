import * as tf from "@tensorflow/tfjs-core";
import { sequential, layers } from "@tensorflow/tfjs-layers";
import "@tensorflow/tfjs-backend-cpu";
import { resample, validateDataset, wordPath } from "./core.js";

export function features(path) {
  const p = resample(path, 32);
  return p.map((v, i) => [
    v.x,
    v.y,
    i ? v.x - p[i - 1].x : 0,
    i ? v.y - p[i - 1].y : 0,
  ]);
}
function createModel(count) {
  const model = sequential();
  model.add(
    layers.conv1d({
      inputShape: [32, 4],
      filters: 8,
      kernelSize: 3,
      activation: "relu",
    }),
  );
  model.add(layers.flatten());
  model.add(layers.dense({ units: 24, activation: "relu" }));
  model.add(layers.dense({ units: count, activation: "softmax" }));
  model.compile({
    optimizer: tf.train.adam(0.003),
    loss: "categoricalCrossentropy",
    metrics: ["accuracy"],
  });
  return model;
}
export class PersonalNetwork {
  constructor() {
    this.model = null;
    this.labels = [];
  }
  dispose() {
    if (this.model) {
      this.model.optimizer?.dispose();
      this.model.dispose();
      this.model = null;
    }
    this.labels = [];
  }
  async train(records, onProgress = () => {}, epochs = 55) {
    const clips = validateDataset({ version: 1, clips: records }),
      groups = new Map();
    for (const c of clips) {
      const id = `${c.lang}:${c.word}`;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(c);
    }
    const eligible = [...groups].filter(([, rows]) => rows.length >= 3);
    if (eligible.length < 2)
      throw new Error(
        "Нужно минимум по 3 записи для двух слов. Синтетическая демонстрация не обучает сеть.",
      );
    await tf.setBackend("cpu");
    await tf.ready();
    const labels = eligible.map(([id]) => id),
      train = [],
      holdout = [];
    eligible.forEach(([, rows], label) => {
      holdout.push({ clip: rows.at(-1), label });
      rows.slice(0, -1).forEach((clip) => train.push({ clip, label }));
    });
    const model = createModel(labels.length);
    const x = tf.tensor3d(train.map((r) => features(r.clip.path)));
    const y = tf.tensor2d(
      train.map((r) => labels.map((_, i) => (i === r.label ? 1 : 0))),
    );
    const vx = tf.tensor3d(holdout.map((r) => features(r.clip.path)));
    const vy = tf.tensor2d(
      holdout.map((r) => labels.map((_, i) => (i === r.label ? 1 : 0))),
    );
    try {
      const history = await model.fit(x, y, {
        epochs,
        batchSize: Math.min(16, train.length),
        shuffle: true,
        validationData: [vx, vy],
        callbacks: {
          onEpochEnd: (epoch, logs) =>
            onProgress({ epoch: epoch + 1, epochs, loss: logs.loss }),
        },
      });
      this.dispose();
      this.model = model;
      this.labels = labels;
      return {
        parameters: model.countParams(),
        trainCount: train.length,
        holdoutCount: holdout.length,
        holdoutAccuracy: history.history.val_acc.at(-1),
        epochs,
      };
    } catch (e) {
      model.optimizer?.dispose();
      model.dispose();
      throw e;
    } finally {
      x.dispose();
      y.dispose();
      vx.dispose();
      vy.dispose();
    }
  }
  async predict(path) {
    if (!this.model) return [];
    const probabilities = tf.tidy(
      () => this.model.predict(tf.tensor3d([features(path)])).arraySync()[0],
    );
    return this.labels
      .map((id, i) => {
        const [lang, word] = id.split(":");
        return {
          word,
          lang,
          probability: probabilities[i],
          method: "Персональная Conv1D",
        };
      })
      .sort((a, b) => b.probability - a.probability);
  }
  async serialize() {
    if (!this.model) throw new Error("Нет обученной сети");
    return {
      version: 1,
      labels: this.labels,
      weights: this.model
        .getWeights()
        .map((w) => ({ shape: w.shape, values: Array.from(w.dataSync()) })),
    };
  }
  async restore(data) {
    if (
      data?.version !== 1 ||
      !Array.isArray(data.labels) ||
      data.labels.length < 2 ||
      data.labels.length > 166 ||
      new Set(data.labels).size !== data.labels.length
    )
      throw new Error("Неверная модель");
    for (const id of data.labels) {
      if (typeof id !== "string" || id.length > 36)
        throw new Error("Неверная метка");
      const [lang, word] = id.split(":");
      if (!["ru", "en"].includes(lang) || !word || id !== `${lang}:${word}`)
        throw new Error("Неверная метка");
      wordPath(word, lang);
    }
    await tf.setBackend("cpu");
    await tf.ready();
    const model = createModel(data.labels.length),
      expected = model.getWeights();
    let tensors = [];
    try {
      if (
        !Array.isArray(data.weights) ||
        data.weights.length !== expected.length
      )
        throw new Error("Неверные веса");
      tensors = data.weights.map((w, i) => {
        if (
          JSON.stringify(w.shape) !== JSON.stringify(expected[i].shape) ||
          !Array.isArray(w.values) ||
          w.values.length !== expected[i].size ||
          !w.values.every(Number.isFinite)
        )
          throw new Error("Неверные веса");
        return tf.tensor(w.values, w.shape);
      });
      model.setWeights(tensors);
      this.dispose();
      this.model = model;
      this.labels = data.labels;
    } catch (e) {
      model.optimizer?.dispose();
      model.dispose();
      throw e;
    } finally {
      tensors.forEach((t) => t.dispose());
    }
  }
}
