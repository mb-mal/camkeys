import { keys, project } from "./core.js";
import { sceneProject, sceneTip } from "./scene.js";
import { layoutKey, layoutKeyOutline } from "./stage-control.js";
const colors = ["#97edb5", "#64dac9", "#f0cb77", "#c4bdf0", "#e7a5be"];
export function drawWorkspace(canvas, scene, state) {
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (state.source !== "camera") {
    ctx.fillStyle = "#142522";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#213b34";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }
  const screen = (x, y) => {
    const p = project(state.forward, x, y);
    return [p.x * w, p.y * h];
  };
  for (const k of keys(state.lang)) {
    const corners = [
      screen(k.x - 0.033, k.y - 0.115),
      screen(k.x + 0.033, k.y - 0.115),
      screen(k.x + 0.033, k.y + 0.115),
      screen(k.x - 0.033, k.y + 0.115),
    ];
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    const target = state.calibrationTarget?.letter === k.letter;
    const near = state.tips.some(
      (p) =>
        (state.source !== "camera" || p.id === state.active) &&
        Math.hypot(p.x - k.x, p.y - k.y) < 0.055,
    );
    ctx.fillStyle = target ? "#f5ce68" : near ? "#9ddcafb0" : "#cedbd51a";
    ctx.fill();
    ctx.strokeStyle = near ? "#a5efc4" : "#abc7ba55";
    ctx.stroke();
    const [x, y] = screen(k.x, k.y);
    ctx.fillStyle = target || near ? "#142522" : "#d1ded7";
    ctx.font = "16px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(k.letter.toUpperCase(), x, y);
  }
  const control = state.layoutControl || {};
  const outline = layoutKeyOutline(state.forward);
  ctx.beginPath();
  outline.forEach((p, i) =>
    i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h),
  );
  ctx.closePath();
  ctx.fillStyle = control.busy ? "#9ddcafb0" : "#cedbd51a";
  ctx.fill();
  ctx.strokeStyle = control.busy ? "#a5efc4" : "#abc7ba55";
  ctx.stroke();
  if (control.progress > 0) {
    ctx.beginPath();
    outline
      .slice(0, Math.max(2, Math.ceil(control.progress * 48) + 1))
      .forEach((p, i) =>
        i ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h),
      );
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#a5efc4";
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  const [controlX, controlY] = screen(layoutKey.x, layoutKey.y);
  ctx.fillStyle = control.busy ? "#142522" : "#d1ded7";
  ctx.font = "13px Segoe UI";
  ctx.fillText(state.lang.toUpperCase(), controlX, controlY - 3);
  ctx.font = "8px Segoe UI";
  ctx.fillText("2 с", controlX, controlY + 9);
  state.visualCorners.forEach(([x, y]) => {
    ctx.strokeStyle = "#79b992";
    ctx.strokeRect(x * w - 5, y * h - 5, 10, 10);
  });
  if (state.calibrationPoint) {
    const p = state.calibrationPoint;
    ctx.strokeStyle = "#f5ce68";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#f5ce68";
    ctx.font = "12px Segoe UI";
    ctx.fillText("СЫРАЯ ПОЗИЦИЯ ПАЛЬЦА", p.x * w, p.y * h - 20);
  }
  for (const hand of state.hands || []) {
    ctx.strokeStyle = "#d1e7d480";
    ctx.lineWidth = 2;
    for (const finger of [
      [0, 1, 2, 3, 4],
      [0, 5, 6, 7, 8],
      [5, 9, 10, 11, 12],
      [9, 13, 14, 15, 16],
      [13, 17, 18, 19, 20],
      [0, 17],
    ]) {
      ctx.beginPath();
      finger.forEach((i, j) => {
        const p = hand[i];
        j ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h);
      });
      ctx.stroke();
    }
  }
  for (const excluded of state.excludedHands || []) {
    if (!excluded.hand) continue;
    ctx.strokeStyle = "#c1aaa0";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 5]);
    for (const indices of [
      [0, 5, 9, 13, 17, 0],
      [0, 4],
      [5, 8],
      [9, 12],
      [13, 16],
      [17, 20],
    ]) {
      ctx.beginPath();
      indices.forEach((i, j) => {
        const p = excluded.hand[i];
        j ? ctx.lineTo(p.x * w, p.y * h) : ctx.moveTo(p.x * w, p.y * h);
      });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const p = excluded.hand[0];
    ctx.fillStyle = "#eed6bf";
    ctx.font = "12px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(
      `${excluded.reason === "far" ? "ДАЛЕКО" : "НЕ ДОПУЩЕНА"} · ${excluded.ratio.toFixed(2)}×`,
      p.x * w,
      p.y * h + 18,
    );
  }
  for (const [id, trail] of state.trails) {
    if (trail.length < 2) continue;
    const color = colors[Number(id.split("-").at(-1)) % 5] || colors[0];
    ctx.strokeStyle = color + "80";
    ctx.lineWidth = id === state.active ? 3 : 1.5;
    ctx.beginPath();
    trail.forEach((p, i) => {
      const [x, y] = screen(p.x, p.y);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    const a = trail.at(-Math.min(4, trail.length)),
      b = trail.at(-1),
      [ax, ay] = screen(a.x, a.y),
      [bx, by] = screen(b.x, b.y);
    const d = Math.hypot(bx - ax, by - ay);
    if (d > 3) {
      const angle = Math.atan2(by - ay, bx - ax);
      ctx.beginPath();
      ctx.moveTo(
        bx - 9 * Math.cos(angle - 0.5),
        by - 9 * Math.sin(angle - 0.5),
      );
      ctx.lineTo(bx, by);
      ctx.lineTo(
        bx - 9 * Math.cos(angle + 0.5),
        by - 9 * Math.sin(angle + 0.5),
      );
      ctx.stroke();
    }
  }
  for (const p of state.tips) {
    const [x, y] = screen(p.x, p.y);
    ctx.fillStyle = colors[Number(p.id.split("-").at(-1)) % 5] || colors[0];
    ctx.beginPath();
    ctx.arc(x, y, p.id === state.active ? 7 : 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "#142522";
    ctx.stroke();
  }
  if (state.source === "camera" && state.activityTip) {
    const p = state.activityTip;
    const sx = p.cameraX * w,
      sy = p.cameraY * h;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx, sy, 12, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.font = "bold 12px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(
      p.depthReason !== "near"
        ? "ВНЕ ЗОНЫ"
        : state.active &&
            !["paused", "needs-calibration"].includes(state.inputPhase)
          ? "ВВОД"
          : "ПАУЗА",
      sx,
      sy - 20,
    );
  }
  drawScene(scene, state);
}
function drawScene(canvas, state) {
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const xyz = (x, y) => {
    const p = sceneProject(x, y, 1, w, h);
    return [p.x, p.y];
  };
  ctx.fillStyle = "#58745f";
  ctx.font = "11px Segoe UI";
  ctx.textAlign = "left";
  ctx.fillText("ДАЛЬШЕ ↑ · меньше", 14, 20);
  ctx.fillText("БЛИЖЕ ↓ · больше", 14, h - 12);
  ctx.textAlign = "right";
  ctx.fillText("Плоскость 1×", w - 14, h - 12);
  ctx.strokeStyle = "#9fb8a7";
  ctx.fillStyle = "#dce8db";
  ctx.beginPath();
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].forEach(([x, y], i) => {
    const p = xyz(x, y);
    i ? ctx.lineTo(...p) : ctx.moveTo(...p);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const k of keys(state.lang)) {
    const [x, y] = xyz(k.x, k.y),
      corners = [
        [k.x - 0.032, k.y - 0.105],
        [k.x + 0.032, k.y - 0.105],
        [k.x + 0.032, k.y + 0.105],
        [k.x - 0.032, k.y + 0.105],
      ];
    ctx.fillStyle =
      state.calibrationTarget?.letter === k.letter ? "#f5ce68" : "#f8fbf6";
    ctx.beginPath();
    corners.forEach(([u, v], i) => {
      const [cx, cy] = xyz(u, v);
      i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy);
    });
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#58745f";
    ctx.font = `${28 / sceneProject(k.x, k.y, 1, w, h).depth}px Segoe UI`;
    ctx.textAlign = "center";
    ctx.fillText(k.letter, x, y + 4);
  }
  for (const p of state.tips) {
    const { x, y, radius } = sceneTip(p, w, h),
      [bx, by] = xyz(p.x, p.y);
    ctx.strokeStyle = "#5e977e";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#245d46";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const excluded of state.excludedHands || []) {
    if (state.calibrating) break;
    if (!excluded.hand || !Number.isFinite(excluded.ratio)) continue;
    ctx.strokeStyle = "#997d6a";
    ctx.fillStyle = "#997d6a";
    ctx.setLineDash([2, 2]);
    for (const index of [4, 8, 12, 16, 20]) {
      const p = excluded.hand[index],
        mapped = project(state.inverse, p.x, p.y),
        q = sceneTip({ ...mapped, distanceRatio: excluded.ratio }, w, h);
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const palm = project(state.inverse, excluded.hand[0].x, excluded.hand[0].y),
      label = sceneTip({ ...palm, distanceRatio: excluded.ratio }, w, h);
    ctx.font = "10px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(
      `${excluded.ratio.toFixed(2)}× · исключена`,
      label.x,
      label.y - 12,
    );
  }
}
