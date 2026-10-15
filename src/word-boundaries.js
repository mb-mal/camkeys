import { nearestKey } from "./core.js";
// A word begins/ends at a short spatially stable cluster, not when the hand
// first enters/leaves the image. No letter or expected-word input is used.
export function trimApproach(path, lang = "ru") {
  if (path.length < 4 || !path.every((p) => Number.isFinite(p.t))) return path;
  const stable = [];
  for (let i = 0; i < path.length; i++) {
    let j = i;
    while (j + 1 < path.length && path[j].t - path[i].t < 150) j++;
    if (path[j].t - path[i].t < 150 || path[j].t - path[i].t > 400) continue;
    const window = path.slice(i, j + 1);
    const key = nearestKey(path[i], lang);
    if (
      !key ||
      window.some(
        (p) =>
          p.pointing === false || nearestKey(p, lang)?.letter !== key.letter,
      )
    )
      continue;
    const x = window.reduce((s, p) => s + p.x, 0) / window.length;
    const y = window.reduce((s, p) => s + p.y, 0) / window.length;
    if (window.every((p) => Math.hypot(p.x - x, (p.y - y) * 0.4) <= 0.025))
      stable.push({ i, j });
  }
  if (stable.length < 2) return path;
  const edge = Math.min(1000, (path.at(-1).t - path[0].t) * 0.25);
  const first = path[stable[0].i].t - path[0].t <= edge ? stable[0].i : 0;
  const last =
    path.at(-1).t - path[stable.at(-1).j].t <= edge
      ? stable.at(-1).j
      : path.length - 1;
  if (path[last].t - path[first].t < 500) return path;
  return path.slice(first, last + 1);
}
