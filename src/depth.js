// Relative pinhole proxy: for the same palm/orientation and fixed optics,
// apparent palm size is inversely proportional to distance. No metric units.
export function palmScale(hand, aspect) {
  if (
    !Array.isArray(hand) ||
    hand.length !== 21 ||
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    hand.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return null;
  const distance = (a, b) =>
    Math.hypot(hand[a].x - hand[b].x, (hand[a].y - hand[b].y) * aspect);
  const size = Math.hypot(distance(0, 9), distance(5, 17));
  return size >= 0.008 && size <= 0.8 ? size : null;
}
export class DepthGate {
  constructor() {
    this.reference = 0.16;
    this.limit = 1.35;
    this.serial = 0;
    this.reset();
  }
  reset() {
    this.tracks = [];
    this.lastTime = -Infinity;
    this.current = [];
  }
  configure({ reference = this.reference, limit = this.limit }) {
    if (
      !Number.isFinite(reference) ||
      reference < 0.008 ||
      reference > 0.8 ||
      !Number.isFinite(limit) ||
      limit < 0.8 ||
      limit > 2.5
    )
      throw new Error("Неверная настройка рабочей глубины");
    this.reference = reference;
    this.limit = limit;
    this.tracks.forEach((t) => {
      t.allowed = false;
      t.readySince = null;
    });
  }
  calibrate(time = this.lastTime) {
    if (!Number.isFinite(time) || time - this.lastTime > 400)
      throw new Error("Нет свежих кадров ладони для калибровки.");
    const nearest = [...this.current].sort((a, b) => b.scale - a.scale)[0];
    const history = nearest?.samples.slice(-12) || [];
    if (history.length < 5)
      throw new Error(
        "Нужно минимум 5 устойчивых кадров ладони. Покажите ладонь камере и удерживайте её.",
      );
    const sizes = history.map((p) => p.scale).sort((a, b) => a - b),
      median = sizes[Math.floor(sizes.length / 2)];
    if ((sizes.at(-1) - sizes[0]) / median > 0.15)
      throw new Error(
        "Размер ладони меняется. Удерживайте её на рабочей глубине без поворота.",
      );
    this.configure({ reference: median });
    return median;
  }
  update(hands, time, aspect) {
    if (!Number.isFinite(time)) throw new Error("Неверное время кадра");
    if (time < this.lastTime) this.reset();
    this.lastTime = time;
    const valid = [],
      invalid = [];
    for (const hand of hands.slice(0, 2)) {
      const scale = palmScale(hand, aspect);
      if (scale === null)
        invalid.push({
          hand: null,
          id: "invalid",
          reason: "invalid",
          ratio: null,
        });
      else valid.push({ hand, scale, wrist: hand[0] });
    }
    const previous = this.tracks.filter((t) => time - t.time <= 400);
    const possibilities = [];
    const assign = (i, used, matches, cost) => {
      if (i === valid.length) {
        possibilities.push({ matches, cost });
        return;
      }
      assign(i + 1, used, [...matches, null], cost + 0.3);
      previous.forEach((t) => {
        if (used.has(t.id)) return;
        const d = Math.hypot(
          valid[i].wrist.x - t.wrist.x,
          (valid[i].wrist.y - t.wrist.y) * aspect,
        );
        if (d > 0.22) return;
        const next = new Set(used);
        next.add(t.id);
        assign(
          i + 1,
          next,
          [...matches, t],
          cost + d + 0.015 * Math.abs(Math.log(valid[i].scale / t.scale)),
        );
      });
    };
    assign(0, new Set(), [], 0);
    possibilities.sort((a, b) => a.cost - b.cost);
    const ambiguous =
      possibilities.length > 1 &&
      possibilities[1].cost - possibilities[0].cost < 0.025;
    const observed = valid.map((d, i) => {
      let track = ambiguous ? null : possibilities[0].matches[i];
      if (!track)
        track = {
          id: `hand${++this.serial}`,
          allowed: false,
          readySince: null,
          samples: [],
          smooth: d.scale,
        };
      track.smooth = 0.65 * d.scale + 0.35 * track.smooth;
      Object.assign(track, d, { time });
      track.samples.push({ scale: d.scale, time });
      track.samples = track.samples
        .filter((p) => time - p.time <= 1200)
        .slice(-20);
      const ratio = this.reference / track.smooth,
        rawRatio = this.reference / d.scale;
      // Exit immediately on a far raw sample; EMA never keeps a far hand in input.
      if (ambiguous || rawRatio > this.limit || ratio > this.limit) {
        track.allowed = false;
        track.readySince = null;
      } else if (!track.allowed) {
        if (rawRatio <= this.limit - 0.06 && ratio <= this.limit - 0.06) {
          track.readySince ??= time;
          if (time - track.readySince >= 200 && track.samples.length >= 3)
            track.allowed = true;
        } else track.readySince = null;
      }
      return {
        ...track,
        ratio,
        rawRatio,
        reason: ambiguous
          ? "identity"
          : rawRatio > this.limit || ratio > this.limit
            ? "far"
            : track.allowed
              ? "near"
              : "settling",
      };
    });
    this.current = observed;
    this.tracks = observed.concat(
      previous.filter(
        (t) => !observed.some((v) => v.id === t.id) && !ambiguous,
      ),
    );
    // Do not carry obsolete tracks after failed association or an ambiguous overlap.
    if (ambiguous) this.tracks = observed;
    return {
      accepted: observed.filter((t) => t.allowed),
      excluded: [...observed.filter((t) => !t.allowed), ...invalid],
      ambiguous,
    };
  }
}
