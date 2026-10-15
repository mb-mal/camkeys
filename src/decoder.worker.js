import { rankToken, vocabulary } from "./core.js";
import { PrefixDecoder } from "./prefix-decoder.js";
import { installRussianDictionary } from "./russian-dictionary.js";
let ready = false;
const prefixes = new Map();
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const response = await fetch("/dictionaries/ru_50k.txt");
      if (!response.ok) throw new Error(`Словарь: HTTP ${response.status}`);
      const count = installRussianDictionary(await response.text());
      for (const layout of ["ru", "en"])
        prefixes.set(layout, new PrefixDecoder(vocabulary[layout], layout));
      ready = true;
      postMessage({ type: "ready", count });
      return;
    }
    if (!ready) throw new Error("Словарь ещё не загружен");
    const start = performance.now();
    const token = data.token;
    if (data.type === "preview") {
      const preview = prefixes
        .get(token.layout)
        .predict(data.path, { requireStartHold: token.source === "camera" });
      postMessage({
        type: "preview",
        token,
        preview,
        ms: performance.now() - start,
      });
      return;
    }
    const results = rankToken(token, data.context, data.extra);
    postMessage({
      type: "result",
      token,
      results,
      ms: performance.now() - start,
    });
  } catch (error) {
    postMessage({ type: "error", message: error.message, token: data.token });
  }
};
