import test from "node:test";
import assert from "node:assert/strict";
import { removeKnownSample } from "../src/sample-cleanup.js";
test("explicit cleanup removes only the known sample and preserves remaining text", () => {
  assert.equal(removeKnownSample("привет мир "), "");
  assert.equal(removeKnownSample("привет мир мои заметки"), " мои заметки");
  assert.equal(removeKnownSample("мои заметки"), "мои заметки");
  assert.equal(removeKnownSample("привет мироздание"), "привет мироздание");
});
