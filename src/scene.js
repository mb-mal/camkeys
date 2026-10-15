// A fixed 45 degree display tilt; it does not constrain the physical hand plane.
export const VIEW_ANGLE_DEG = 45;
export function sceneCameraCoordinates(x, y, abovePlane = 0) {
  const angle = (VIEW_ANGLE_DEG * Math.PI) / 180,
    t = (y - 0.5) * 0.8;
  return {
    x: (x - 0.5) * 2.6,
    y: 0.7 + t * Math.cos(angle) - abovePlane * Math.sin(angle),
    z: 2.8 - t * Math.sin(angle) - abovePlane * Math.cos(angle),
  };
}
export function sceneProject(
  x,
  y,
  distanceRatio = 1,
  width = 600,
  height = 220,
  abovePlane = 0,
  originY = 18,
) {
  if (
    ![x, y, distanceRatio, width, height, abovePlane, originY].every(
      Number.isFinite,
    ) ||
    distanceRatio <= 0 ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Неверные координаты 3D-схемы");
  const camera = sceneCameraCoordinates(x, y, abovePlane),
    focal = Math.min(width * 0.8, height * 1.4);
  const depth = Math.max(0.2, camera.z) * distanceRatio;
  return {
    x: width / 2 + (focal * camera.x) / depth,
    y: originY + (focal * camera.y) / depth,
    depth,
  };
}
export function displayCorners() {
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([x, y]) => {
    const p = sceneProject(x, y, 1, 960, 540, 0, 540 * 0.28);
    return [p.x / 960, p.y / 540];
  });
  // Translate the same tilted plane; camera calibration remains independent.
  const dx = 0.985 - Math.max(...corners.map(([x]) => x));
  // Leave room below the lowest key for the palm/wrist: a visible fingertip
  // alone at the frame edge is not enough for the hand landmarker.
  const dy = 0.8 - Math.max(...corners.map(([, y]) => y));
  return corners.map(([x, y]) => [x + dx, y + dy]);
}
export function sceneTip(tip, width, height) {
  const ratio = tip.distanceRatio ?? 1;
  // z stays a flexion signal, not camera distance or measured height.
  return {
    ...sceneProject(tip.x, tip.y, ratio, width, height, 0.1),
    radius: 5 / ratio,
  };
}
