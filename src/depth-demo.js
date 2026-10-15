// Deliberately artificial landmarks. They exercise the same gate as the camera.
export function depthDemoHands(
  elapsed,
  aspect,
  reference = 0.16,
  limit = 1.35,
) {
  function hand(x, y, scale) {
    const length = scale / Math.sqrt(2) / aspect,
      width = scale / Math.sqrt(2);
    const points = Array.from({ length: 21 }, () => ({ x, y, z: 0 }));
    for (let f = 0; f < 5; f++)
      for (let j = 1; j <= 4; j++) {
        const index = f * 4 + j;
        points[index] = {
          x: x + ((f - 2) * width) / 4,
          y: y - length * (0.75 + j * 0.25),
          z: -0.005 * j,
        };
      }
    points[9] = { x, y: y - length, z: 0 };
    points[5] = { x: x - width / 2, y: y - length, z: 0 };
    points[17] = { x: x + width / 2, y: y - length, z: 0 };
    // Keep each MCP/PIP/DIP/TIP chain straight and anatomically ordered.
    for (const f of [1, 2, 3, 4]) {
      const base = 1 + f * 4;
      for (let j = 1; j <= 3; j++)
        points[base + j] = {
          x: points[base].x,
          y: y - length * (1 + j * 0.22),
          z: -0.005 * j,
        };
    }
    return points;
  }
  const progress = Math.min(1, Math.max(0, (elapsed - 800) / 1800));
  const near = hand(
    0.3 + 0.08 * progress,
    0.76,
    elapsed < 2400
      ? reference / Math.min(1, limit - 0.15)
      : reference / (limit + 0.65),
  );
  // The wrist moves, so the active hand has a partial swipe when it leaves range.
  const far = hand(0.72, 0.75, reference / (limit + 0.85));
  return [near, far];
}
