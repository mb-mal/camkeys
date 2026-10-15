import { project } from "./core.js";
import { pointingFingers } from "./hand-pose.js";
// The gate controls typing admission. Diagnostics also inspect excluded hands.
export function projectTrackedHands(
  hands,
  time,
  aspect,
  inverse,
  gate,
  calibrating = false,
) {
  const depth = gate.update(hands, time, aspect),
    activityTips = [];
  for (const { hand, id, ratio, reason } of [
    ...depth.accepted,
    ...depth.excluded,
  ]
    .filter((h) => h.hand && h.reason !== "identity")
    .sort((a, b) => a.ratio - b.ratio)) {
    const pointing = pointingFingers(hand, aspect);
    const flexionScale = Math.max(
      0.08,
      Math.hypot(hand[0].x - hand[9].x, (hand[0].y - hand[9].y) * aspect),
    );
    [4, 8, 12, 16, 20].forEach((index, f) => {
      const p = hand[index],
        mapped = { x: p.x, y: p.y };
      activityTips.push({
        id: `${id}-${f}`,
        x: mapped.x,
        y: mapped.y,
        cameraX: mapped.x,
        cameraY: mapped.y,
        z: p.z / flexionScale,
        distanceRatio: ratio,
        depthReason: reason,
        pointing: pointing[f],
      });
    });
  }
  const rawTips = activityTips.filter((p) => p.depthReason === "near");
  const tips = calibrating
    ? []
    : rawTips.map((p) => ({ ...p, ...project(inverse, p.x, p.y) }));
  return {
    depth,
    tips,
    rawTips,
    calibrationTips: activityTips.filter((p) =>
      ["near", "far", "settling"].includes(p.depthReason),
    ),
    activityTips,
    commandPalms: [...depth.accepted, ...depth.excluded]
      .filter((h) => h.hand && ["near", "far", "settling"].includes(h.reason))
      .map((h) => ({
        id: h.id,
        x: h.hand[0].x,
        y: h.hand[0].y,
        scale: h.scale,
      })),
    hands: depth.accepted.map((v) => v.hand),
  };
}
