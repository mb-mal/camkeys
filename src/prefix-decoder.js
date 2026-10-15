import { keys, resample } from "./core.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const metric = (p) => ({ ...p, y: p.y * 0.4 });

// Spatial simplification keeps turns rather than treating each crossed key as
// an intention. The moving endpoint needs 120 ms of stability before use.
function evidencePath(path, requireStartHold) {
  let points = path
    .filter(
      (p) =>
        Number.isFinite(p.x) &&
        Number.isFinite(p.y) &&
        p.x >= 0 &&
        p.x <= 1 &&
        p.y >= 0 &&
        p.y <= 1,
    )
    .map(metric);
  if (!points.length) return [];
  if (requireStartHold) {
    let start = -1;
    for (let i = 0; i < points.length; i++) {
      let j = i;
      while (j < points.length - 1 && points[j].t - points[i].t < 120) j++;
      if (points[j].t - points[i].t < 120 || points[j].t - points[i].t > 350)
        continue;
      const cluster = points.slice(i, j + 1);
      const center = {
        x: cluster.reduce((s, p) => s + p.x, 0) / cluster.length,
        y: cluster.reduce((s, p) => s + p.y, 0) / cluster.length,
      };
      if (cluster.every((p) => distance(p, center) <= 0.015)) {
        start = i;
        break;
      }
    }
    if (start < 0) return [];
    points = points.slice(start);
  }
  // Short causal smoothing suppresses landmark jitter before measuring turns.
  points = points.map((p, i) => {
    const cluster = points.slice(Math.max(0, i - 2), i + 1);
    return {
      ...p,
      x: cluster.reduce((s, q) => s + q.x, 0) / cluster.length,
      y: cluster.reduce((s, q) => s + q.y, 0) / cluster.length,
    };
  });
  const selected = [0];
  function simplify(first, last) {
    const a = points[first],
      b = points[last],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length2 = dx * dx + dy * dy;
    let largest = 0.02,
      index = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i];
      const t = length2
        ? Math.max(
            0,
            Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2),
          )
        : 0;
      const d = distance(p, { x: a.x + t * dx, y: a.y + t * dy });
      if (d > largest) {
        largest = d;
        index = i;
      }
    }
    if (index >= 0) {
      simplify(first, index);
      selected.push(index);
      simplify(index, last);
    }
  }
  simplify(0, points.length - 1);
  selected.push(points.length - 1);
  const end = points.at(-1);
  let start = points.length - 1;
  while (start > 0 && end.t - points[start].t < 120) start--;
  const stable =
    end.t - points[start].t >= 120 &&
    points.slice(start).every((p) => distance(p, end) <= 0.018);
  const last = stable ? points.length - 1 : selected.at(-2);
  return selected.filter((i) => i <= last).map((i) => points[i]);
}

export class PrefixDecoder {
  constructor(words, layout) {
    const keyboard = new Map(keys(layout).map((k) => [k.letter, metric(k)]));
    const prefixes = new Map();
    this.nodes = [];
    for (let rank = 0; rank < words.length; rank++) {
      const word = words[rank];
      let parent = null;
      if (![...word].every((c) => keyboard.has(c))) continue;
      for (let i = 1; i <= word.length; i++) {
        const text = word.slice(0, i),
          point = keyboard.get(word[i - 1]);
        let node = prefixes.get(text);
        if (!node) {
          node = {
            text,
            point,
            parent,
            first: parent?.first || point,
            length:
              (parent?.length || 0) +
              (parent ? distance(parent.point, point) : 0),
            prior: 0,
          };
          prefixes.set(text, node);
          this.nodes.push(node);
        }
        node.prior += 1 / Math.sqrt(rank + 1);
        parent = node;
      }
    }
  }
  predict(path, { requireStartHold = false } = {}) {
    const evidence = evidencePath(path, requireStartHold);
    if (!evidence.length) return { text: "", confidence: 0, alternatives: [] };
    const first = evidence[0],
      end = evidence.at(-1);
    const input = resample(evidence, 16);
    const length = evidence
      .slice(1)
      .reduce((sum, p, i) => sum + distance(evidence[i], p), 0);
    const candidates = [];
    for (const node of this.nodes) {
      const endpoint = distance(end, node.point),
        beginning = distance(first, node.first);
      if (
        endpoint > 0.065 ||
        beginning > 0.065 ||
        node.length > length * 1.5 + 0.05 ||
        node.length < length * 0.6 - 0.05
      )
        continue;
      const points = [];
      for (let n = node; n; n = n.parent) points.push(n.point);
      points.reverse();
      const template = resample(points, 16);
      const shape =
        input.reduce((sum, p, i) => sum + distance(p, template[i]), 0) / 16;
      const error = shape * 0.6 + endpoint * 0.25 + beginning * 0.15;
      const score = error - Math.log1p(node.prior) * 0.001;
      candidates.push({ text: node.text, error, score });
    }
    candidates.sort((a, b) => a.score - b.score);
    const best = candidates[0];
    if (!best || best.error > 0.055)
      return { text: "", confidence: 0, alternatives: [] };
    const alternatives = candidates
      .filter((c) => c.score - best.score < 0.025)
      .slice(0, 32);
    let total = 0;
    for (const c of alternatives) {
      c.weight = Math.exp((best.score - c.score) / 0.004);
      total += c.weight;
    }
    let text = "",
      confidence = 0;
    for (let i = 0; i < best.text.length; i++) {
      const prefix = best.text.slice(0, i + 1);
      const support =
        alternatives
          .filter((c) => c.text.startsWith(prefix))
          .reduce((s, c) => s + c.weight, 0) / total;
      if (support < 0.75) break;
      text = prefix;
      confidence = support;
    }
    return {
      text,
      confidence,
      alternatives: alternatives
        .slice(0, 5)
        .map((c) => ({ text: c.text, probability: c.weight / total })),
    };
  }
}

// A preview is revisable, but one noisy sample must not erase accumulated text.
export class PrefixConsensus {
  constructor() {
    this.reset();
  }
  reset() {
    this.text = "";
    this.pending = null;
  }
  update(preview, time, immediate = false) {
    const text = preview.text;
    if (!text || this.text.startsWith(text)) {
      this.pending = null;
      return this.text;
    }
    const extendsCurrent = text.startsWith(this.text);
    if (
      !this.pending ||
      !(text === this.pending.text || text.startsWith(this.pending.text))
    )
      this.pending = { text, since: time };
    else this.pending.text = text;
    const delay = extendsCurrent ? 160 : 500;
    if (
      (immediate || time - this.pending.since >= delay) &&
      (extendsCurrent || preview.confidence >= 0.9)
    ) {
      this.text = text;
      this.pending = null;
    }
    return this.text;
  }
}
