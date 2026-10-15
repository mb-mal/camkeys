import { rankToken, vocabulary } from "./core.js";
import { PrefixDecoder } from "./prefix-decoder.js";
import { installRussianDictionary } from "./russian-dictionary.js";
import { installEnglishDictionary } from "./english-dictionary.js";
let ready = false;
const prefixes = new Map();
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const counts = {},
        errors = {};
      await Promise.all(
        [
          ["ru", installRussianDictionary],
          ["en", installEnglishDictionary],
        ].map(async ([layout, install]) => {
          try {
            const response = await fetch(`/dictionaries/${layout}_50k.txt`, {
              signal: AbortSignal.timeout(6000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            counts[layout] = install(await response.text());
          } catch (error) {
            counts[layout] = null;
            errors[layout] = error.message;
          }
        }),
      );
      for (const layout of ["ru", "en"])
        prefixes.set(layout, new PrefixDecoder(vocabulary[layout], layout));
      ready = true;
      postMessage({ type: "ready", count: counts.ru, counts, errors });
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
