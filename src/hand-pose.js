const joints = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
export function pointingFingers(hand, aspect) {
  if (
    !Array.isArray(hand) ||
    hand.length !== 21 ||
    !Number.isFinite(aspect) ||
    aspect <= 0 ||
    hand.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))
  )
    return Array(5).fill(false);
  const points = hand.map((p) => [p.x, p.y * aspect, p.z]);
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const length = (v) => Math.hypot(...v);
  const angle = (a, b, c) => {
    const u = sub(a, b),
      v = sub(c, b),
      n = length(u) * length(v);
    return n > 1e-8
      ? (Math.acos(
          Math.max(-1, Math.min(1, u.reduce((s, x, i) => s + x * v[i], 0) / n)),
        ) *
          180) /
          Math.PI
      : 0;
  };
  return joints.map((indices, f) => {
    const [a, b, c, d] = indices.map((i) => points[i]);
    const chain = length(sub(b, a)) + length(sub(c, b)) + length(sub(d, c));
    // Straightness is rotation invariant, including pointing towards the camera.
    // Thumb uses CMC/MCP/IP; other fingers use MCP/PIP/DIP. Zero-length chains fail closed.
    const palm = [0, 1, 2].map(
      (i) => (points[5][i] + points[9][i] + points[17][i]) / 3,
    );
    const base = f === 0 ? b : a;
    // Wrist distance is not extension: a straight finger aimed toward the
    // camera/lower row can be closer to the wrist than its MCP. Joint angles
    // and chain straightness below reject folded fingers without that veto.
    const outward = length(sub(d, palm)) > length(sub(base, palm)) * 1.15;
    return (
      outward &&
      chain > 0.01 &&
      length(sub(d, a)) / chain >= (f === 0 ? 0.68 : 0.72) &&
      angle(a, b, c) >= (f === 0 ? 125 : 145) &&
      angle(b, c, d) >= (f === 0 ? 130 : 135)
    );
  });
}
