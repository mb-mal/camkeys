import { vocabulary } from "./core.js";
export function installRussianDictionary(text) {
  const words = new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/)[0])
      .filter((word) => /^[а-яё]{1,32}$/.test(word)),
  );
  if (words.size < 40000)
    throw new Error("Русский словарь повреждён или неполон");
  vocabulary.ru = [...words];
  return words.size;
}
