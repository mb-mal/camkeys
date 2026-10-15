export const ACTIVITY_WINDOW_MS = 5000;
export class TipActivity {
  constructor() {
    this.reset();
  }
  reset() {
    this.tracks = new Map();
    this.active = null;
    this.lastTime = -Infinity;
    this.result = {
      id: null,
      score: 0,
      method: "движение",
      planarScore: 0,
      scores: [],
    };
  }
  update(tips, time, eligibleIds = null) {
    if (!Number.isFinite(time) || time <= this.lastTime) return this.result;
    this.lastTime = time;
    const visible = tips.filter((p) =>
      [p.x, p.y, p.z ?? 0, time].every(Number.isFinite),
    );
    const ids = new Set(visible.map((p) => p.id));
    for (const id of this.tracks.keys())
      if (!ids.has(id)) this.tracks.delete(id);
    const scores = [];
    for (const tip of visible) {
      const p = {
        x: tip.cameraX ?? tip.x,
        y: tip.cameraY ?? tip.y,
        z: (tip.z ?? 0) * 0.2,
      };
      let track = this.tracks.get(tip.id);
      const usable = tip.pointing !== false;
      if (!track || time <= track.time || !usable || track.usable === false)
        track = {
          anchor: { ...p },
          smooth: { ...p },
          time,
          steps: [],
          flexion: [],
          usable,
        };
      else if (time - track.time > 400) {
        track.anchor = { ...p };
        track.smooth = { ...p };
      }
      const alpha = 1 - Math.exp(-(time - track.time) / 80);
      track.smooth.x += alpha * (p.x - track.smooth.x);
      track.smooth.y += alpha * (p.y - track.smooth.y);
      const distance = Math.hypot(
        track.smooth.x - track.anchor.x,
        track.smooth.y - track.anchor.y,
      );
      // Accumulate slow movement from an anchor; small tracker jitter does not score.
      if (distance >= 0.004) {
        track.steps.push({ t: time, distance });
        track.anchor.x = track.smooth.x;
        track.anchor.y = track.smooth.y;
      }
      const flexion = Math.abs(p.z - track.anchor.z);
      if (flexion >= 0.004) {
        track.flexion.push({ t: time, distance: flexion });
        track.anchor.z = p.z;
      }
      track.time = time;
      track.usable = usable;
      track.steps = track.steps.filter((s) => s.t >= time - ACTIVITY_WINDOW_MS);
      track.flexion = track.flexion.filter(
        (s) => s.t >= time - ACTIVITY_WINDOW_MS,
      );
      this.tracks.set(tip.id, track);
      scores.push({
        id: tip.id,
        score: track.steps.reduce((sum, s) => sum + s.distance, 0),
        flexionScore: track.flexion.reduce((sum, s) => sum + s.distance, 0),
        handId: tip.id.split("-")[0],
        distanceRatio: tip.distanceRatio ?? 1,
        relativeZ: tip.z ?? 0,
      });
    }
    // Relative z is a tapping proxy, not physical distance: use it only
    // when no fingertip has meaningful planar movement.
    const candidates =
      eligibleIds !== null
        ? scores.filter(
            (s) => eligibleIds.has(s.id) && this.tracks.get(s.id).usable,
          )
        : scores.filter((s) => this.tracks.get(s.id).usable);
    const planar = candidates.some((s) => s.score >= 0.018);
    const planarScore = Math.max(0, ...candidates.map((s) => s.score));
    if (!planar) for (const s of candidates) s.score = s.flexionScore;
    candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    // Scores are quantized by the 0.004 deadband. Treat one quantum as a tie
    // so rigid palm movement cannot repeatedly reset the word by changing tips.
    const tied = candidates
      .filter((s) => candidates[0].score - s.score <= 0.004 + 1e-9)
      .sort(
        (a, b) =>
          (a.handId === b.handId
            ? a.relativeZ - b.relativeZ
            : a.distanceRatio - b.distanceRatio) || a.id.localeCompare(b.id),
      );
    const current = candidates.find((s) => s.id === this.active);
    // Relative-z noise cannot dislodge a still-visible selected fingertip.
    // Flexion remains a fallback for initial selection; switching uses planar activity.
    const winner =
      !planar && current
        ? current
        : candidates[0]?.score >= 0.018
          ? tied.find((s) => s.id === this.active) || tied[0]
          : current || null;
    this.active = winner?.id ?? null;
    this.result = {
      id: this.active,
      score: winner?.score ?? 0,
      method:
        winner && winner.score < 0.018
          ? "удержание"
          : planar
            ? "движение"
            : "сгибание",
      planarScore,
      scores,
    };
    return this.result;
  }
}
