// M-maker — parametric M path generator (ported from js/app.js)

export const KAPPA = 0.5523;
export const M_ORIG = { W: 239.89, H: 263.79, R: 5.98 };
export const H_LOGICAL = 800;
export const STAGE_FILL_H = 0.8;
export const STAGE_FILL_W = 0.92;
export const PCT_MIN = 25;
export const PCT_MAX = 400;
export const V1_SHIFT_MAX = 0.43;
export const V2_OUTER_MAX = 78.53 / 239.89 - 0.10;
export const V3_OUTER_MAX = 0.90 - 186.11 / 239.89;
export const V_INNER_MAX = 0.30;
export const V_GAP_MARGIN = 0.05;
// Outer-stem controls. LenL/LenR lift each stem's bottom toward the top (top
// edge stays fixed); PosR translates the whole right stem vertically.
export const STEM_LIFT_MAX = 0.6; // fraction of H a stem bottom can rise
export const STEM_POS_MAX = 0.5; // fraction of H the right stem can shift
// Outer (convex) silhouette corners read sharper than the inner concave
// fillets at the same R, so round them a bit more.
export const OUTER_R_BOOST = 1.15;

type Pt = [number, number];

const P_DESIGN: Record<string, Pt> = {
  TL: [129.475, 0],
  apex: [171.31, 90.47],
  TR: [214.628, 0],
  LegR: [186.11, 159.55],
  BVR: [145.77, 263.79],
  BVL: [118.87, 263.79],
  LegL: [78.53, 159.55],
};
const DIST = {
  TLshoulder: { in: 5.755, out: 5.751 },
  Tapex: { in: 30.79, out: 30.62 },
  TRshoulder: { in: 5.666, out: 5.672 },
  LegTopR: { in: 56.73, out: 56.51 },
  BVshoulderR: { in: 4.10, out: 4.10 },
  BVshoulderL: { in: 4.10, out: 4.10 },
  LegTopL: { in: 56.48, out: 56.73 },
};
const RATIO = {
  TLshoulder: { in: 0.362, out: 0.361 },
  Tapex: { in: 0.529, out: 0.512 },
  TRshoulder: { in: 0.360, out: 0.360 },
  LegTopR: { in: 0.625, out: 0.577 },
  BVshoulderR: { in: 0.365, out: 0.365 },
  BVshoulderL: { in: 0.365, out: 0.365 },
  LegTopL: { in: 0.577, out: 0.625 },
};

export function computeMaxR(W: number, H: number): number {
  const sx = W / M_ORIG.W;
  const sy = H / M_ORIG.H;
  return Math.max(0, Math.min(
    (W - sx * 214.628) / 1.949,
    (H - sy * 159.55 - 12) / 10.486,
    sx * 11.02,
    (W - sx * 186.11) / 2,
    sx * 78.53 / 2,
    200,
  ));
}

function norm(v: Pt): Pt {
  const len = Math.hypot(v[0], v[1]);
  return len > 0 ? [v[0] / len, v[1] / len] : [0, 0];
}
function sub(a: Pt, b: Pt): Pt { return [a[0] - b[0], a[1] - b[1]]; }

export interface MParams {
  W: number;
  H: number;
  R: number;
  V1: number;
  V2: number;
  V3: number;
  S1: number;
  S2: number;
  S3: number;
  LenL: number; // left outer-stem length, 0-100 (100 = full height)
  LenR: number; // right outer-stem length, 0-100 (100 = full height)
  PosR: number; // right outer-stem vertical position, 0-100 (50 = neutral)
}

interface MGeom {
  W: number;
  H: number;
  R: number;
  Ro: number; // boosted radius for outer convex corners
  rs: number;
  sP: Record<string, Pt>;
  dyR: number;
  botL: number;
  botR: number;
  xLegL: number;
  xLegR: number;
  T_TLslope: Pt;
  T_TRslope: Pt;
  T_BRslope: Pt;
  T_BLslope: Pt;
}

// Shared transform stage: scales the design points and applies every parametric
// control (V1-3, S1-3, stem length/position). Both the path builder and the
// handle-anchor extractor read from this so they never drift.
function computeMGeom(p: MParams): MGeom {
  const { W, H, V1, V2, V3, S1, S2, S3, LenL, LenR, PosR } = p;
  const maxR = computeMaxR(W, H);
  const R = Math.max(0, Math.min(p.R, maxR));
  const Ro = Math.min(R * OUTER_R_BOOST, maxR);
  const sx = W / M_ORIG.W;
  const sy = H / M_ORIG.H;
  const rs = R / M_ORIG.R;

  const sP: Record<string, Pt> = {};
  for (const k of Object.keys(P_DESIGN)) {
    sP[k] = [P_DESIGN[k][0] * sx, P_DESIGN[k][1] * sy];
  }

  const v1px = (V1 - 100) / 100 * V1_SHIFT_MAX * W;
  const v2norm = (V2 - 50) / 50;
  const v3norm = (V3 - 50) / 50;
  let v2px = v2norm > 0 ? v2norm * V_INNER_MAX * W : v2norm * V2_OUTER_MAX * W;
  let v3px = v3norm > 0 ? v3norm * V3_OUTER_MAX * W : v3norm * V_INNER_MAX * W;

  const naturalGap = (P_DESIGN.BVR[0] - P_DESIGN.BVL[0]) * sx;
  const allowedDiff = naturalGap - R - V_GAP_MARGIN * W;
  const diff = v2px - v3px;
  if (diff > allowedDiff) {
    const excess = diff - allowedDiff;
    v2px -= excess / 2;
    v3px += excess / 2;
  }

  sP.TL[0] += v1px;
  sP.apex[0] += v1px;
  sP.TR[0] += v1px;
  sP.LegL[0] += v2px;
  sP.BVL[0] += v2px;
  sP.LegR[0] += v3px;
  sP.BVR[0] += v3px;

  const v1Scale = 1 + (S1 / 100) * 0.3;
  const v2Scale = 1 + (S2 / 100) * 0.3;
  const v3Scale = 1 + (S3 / 100) * 0.3;
  const v1Mid = (sP.TL[0] + sP.TR[0]) / 2;
  sP.TL[0] = v1Mid + (sP.TL[0] - v1Mid) * v1Scale;
  sP.TR[0] = v1Mid + (sP.TR[0] - v1Mid) * v1Scale;
  sP.apex[0] = v1Mid + (sP.apex[0] - v1Mid) * v1Scale;
  sP.apex[1] *= v1Scale;
  sP.LegL[0] = sP.BVL[0] + (sP.LegL[0] - sP.BVL[0]) * v2Scale;
  sP.LegL[1] = sP.BVL[1] + (sP.LegL[1] - sP.BVL[1]) * v2Scale;
  sP.LegR[0] = sP.BVR[0] + (sP.LegR[0] - sP.BVR[0]) * v3Scale;
  sP.LegR[1] = sP.BVR[1] + (sP.LegR[1] - sP.BVR[1]) * v3Scale;

  // Right stem vertical position: shift the whole right stem (PosR>50 = up).
  // Applied to TR before tangents so the right slant angle — and the shoulder
  // fillet that follows it — adapts naturally (its effective r tracks tan of
  // the slant/flat-top half-angle).
  const dyR = (50 - PosR) / 50 * STEM_POS_MAX * H;
  sP.TR[1] += dyR;

  // Stem length: lift each bottom toward the top, top edge fixed.
  const liftL = (1 - LenL / 100) * STEM_LIFT_MAX * H;
  const liftR = (1 - LenR / 100) * STEM_LIFT_MAX * H;
  const botL = H - liftL;
  const botR = H - liftR;

  // The foot + inner notch of each stem rides up rigidly with its lifted
  // bottom (and the right one with PosR too); only the central tab stays planted
  // on the baseline, so its adjacent wall stretches. Done before tangents so the
  // notch slopes recompute. Keeps the notch shape intact at any length.
  sP.LegL[1] += -liftL;
  sP.LegR[1] += dyR - liftR;

  return {
    W, H, R, Ro, rs, sP, dyR, botL, botR,
    xLegL: sP.LegL[0],
    xLegR: sP.LegR[0],
    T_TLslope: norm(sub(sP.apex, sP.TL)),
    T_TRslope: norm(sub(sP.TR, sP.apex)),
    T_BRslope: norm(sub(sP.BVR, sP.LegR)),
    T_BLslope: norm(sub(sP.LegL, sP.BVL)),
  };
}

export function buildMPath(p: MParams): string {
  const g = computeMGeom(p);
  const { W, Ro, rs, sP, dyR, botL, botR, xLegL, xLegR } = g;
  const { T_TLslope, T_TRslope, T_BRslope, T_BLslope } = g;
  const f = (v: number) => +v.toFixed(3);

  const T_R: Pt = [1, 0];
  const T_L: Pt = [-1, 0];
  const T_U: Pt = [0, -1];
  const T_D: Pt = [0, 1];

  const pIn = (P: Pt, t: Pt, d: number): Pt => [P[0] - t[0] * d * rs, P[1] - t[1] * d * rs];
  const pOut = (P: Pt, t: Pt, d: number): Pt => [P[0] + t[0] * d * rs, P[1] + t[1] * d * rs];

  const L1 = pIn(sP.TL, T_R, DIST.TLshoulder.in);
  const L2 = pOut(sP.TL, T_TLslope, DIST.TLshoulder.out);
  const L3 = pIn(sP.apex, T_TLslope, DIST.Tapex.in);
  const L4 = pOut(sP.apex, T_TRslope, DIST.Tapex.out);
  const L5 = pIn(sP.TR, T_TRslope, DIST.TRshoulder.in);
  const L6 = pOut(sP.TR, T_R, DIST.TRshoulder.out);
  const L13 = pIn(sP.LegR, T_U, DIST.LegTopR.in);
  const L14 = pOut(sP.LegR, T_BRslope, DIST.LegTopR.out);
  const L15 = pIn(sP.BVR, T_BRslope, DIST.BVshoulderR.in);
  const L16 = pOut(sP.BVR, T_L, DIST.BVshoulderR.out);
  const L17 = pIn(sP.BVL, T_L, DIST.BVshoulderL.in);
  const L18 = pOut(sP.BVL, T_BLslope, DIST.BVshoulderL.out);
  const L19 = pIn(sP.LegL, T_BLslope, DIST.LegTopL.in);
  const L20 = pOut(sP.LegL, T_D, DIST.LegTopL.out);

  // Outer convex corners use the boosted radius Ro; inner fillets above use R.
  const TLafter: Pt = [Ro, 0];
  // Right stem: top corner shifted by PosR (dyR), bottom lifted by LenR (botR).
  const L7: Pt = [W - Ro, dyR];
  const L8: Pt = [W, Ro + dyR];
  const L9: Pt = [W, botR - Ro + dyR];
  const L10: Pt = [W - Ro, botR + dyR];
  const L11: Pt = [xLegR + Ro, botR + dyR];
  const L12: Pt = [xLegR, botR - Ro + dyR];
  const L21: Pt = [xLegL, botL - Ro];
  // Left stem: bottom lifted by LenL (botL), top edge fixed.
  const L22: Pt = [xLegL - Ro, botL];
  const L23: Pt = [Ro, botL];
  const L24: Pt = [0, botL - Ro];
  const L25: Pt = [0, Ro];

  const Rk = Ro * KAPPA;
  const cubic = (p0: Pt, p3: Pt, tIn: Pt, tOut: Pt, mIn: number, mOut: number) => {
    const c1x = p0[0] + tIn[0] * mIn;
    const c1y = p0[1] + tIn[1] * mIn;
    const c2x = p3[0] - tOut[0] * mOut;
    const c2y = p3[1] - tOut[1] * mOut;
    return `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p3[0])},${f(p3[1])}`;
  };
  const smooth = (p0: Pt, p3: Pt, tIn: Pt, tOut: Pt, ratio: { in: number; out: number }) => {
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    return cubic(p0, p3, tIn, tOut, chord * ratio.in, chord * ratio.out);
  };
  const line = (p: Pt) => `L${f(p[0])},${f(p[1])}`;

  const out: string[] = [];
  out.push(`M${f(TLafter[0])},${f(TLafter[1])}`);
  out.push(line(L1));
  out.push(smooth(L1, L2, T_R, T_TLslope, RATIO.TLshoulder));
  out.push(line(L3));
  out.push(smooth(L3, L4, T_TLslope, T_TRslope, RATIO.Tapex));
  out.push(line(L5));
  out.push(smooth(L5, L6, T_TRslope, T_R, RATIO.TRshoulder));
  out.push(line(L7));
  out.push(cubic(L7, L8, T_R, T_D, Rk, Rk));
  out.push(line(L9));
  out.push(cubic(L9, L10, T_D, T_L, Rk, Rk));
  out.push(line(L11));
  out.push(cubic(L11, L12, T_L, T_U, Rk, Rk));
  out.push(line(L13));
  out.push(smooth(L13, L14, T_U, T_BRslope, RATIO.LegTopR));
  out.push(line(L15));
  out.push(smooth(L15, L16, T_BRslope, T_L, RATIO.BVshoulderR));
  out.push(line(L17));
  out.push(smooth(L17, L18, T_L, T_BLslope, RATIO.BVshoulderL));
  out.push(line(L19));
  out.push(smooth(L19, L20, T_BLslope, T_D, RATIO.LegTopL));
  out.push(line(L21));
  out.push(cubic(L21, L22, T_D, T_L, Rk, Rk));
  out.push(line(L23));
  out.push(cubic(L23, L24, T_L, T_U, Rk, Rk));
  out.push(line(L25));
  out.push(cubic(L25, TLafter, T_U, T_R, Rk, Rk));
  out.push("Z");
  return out.join(" ");
}

// On-canvas handle anchor points (viewBox coords). Keys match the editable
// shape params so a handle for key K is drawn at anchors[K].
export interface MAnchors {
  w: Pt; // right-edge midpoint (drag x → width)
  r: Pt; // top-left corner (drag out → radius)
  v1: Pt; // apex (drag x → top shift)
  s1: Pt; // top-left shoulder (drag x → top hump size)
  v2: Pt; // left foot (drag x → left leg position)
  s2: Pt; // left leg top (drag x → left leg scale)
  v3: Pt; // right foot (drag x → right leg position)
  s3: Pt; // right leg top (drag x → right leg scale)
  lenL: Pt; // left stem bottom (drag y → left length)
  lenR: Pt; // right stem bottom (drag y → right length)
  posR: Pt; // right stem top (drag y → right position)
}

export function computeMAnchors(p: MParams): MAnchors {
  const { W, R, Ro, sP, dyR, botL, botR } = computeMGeom(p);
  return {
    w: [W, botR / 2 + dyR],
    r: [R, R],
    v1: [sP.apex[0], sP.apex[1]],
    s1: [sP.TL[0], sP.TL[1]],
    v2: [sP.BVL[0], sP.BVL[1]],
    s2: [sP.LegL[0], sP.LegL[1]],
    v3: [sP.BVR[0], sP.BVR[1]],
    s3: [sP.LegR[0], sP.LegR[1]],
    lenL: [Ro, botL],
    lenR: [W - Ro, botR + dyR],
    posR: [W - Ro, dyR],
  };
}

export interface ShapeState {
  w: number;
  r: number;
  v1: number;
  v2: number;
  v3: number;
  s1: number;
  s2: number;
  s3: number;
  lenL: number;
  lenR: number;
  posR: number;
}

export const DEFAULT_SHAPE: ShapeState = {
  w: H_LOGICAL,
  r: 20,
  v1: 100,
  v2: 50,
  v3: 50,
  s1: 0,
  s2: 0,
  s3: 0,
  lenL: 100,
  lenR: 100,
  posR: 50,
};

export function buildSvg(shape: ShapeState, fg: string, padding = 20): string {
  const W = Math.round(shape.w);
  const H = H_LOGICAL;
  const d = buildMPath({
    W,
    H,
    R: shape.r,
    V1: shape.v1,
    V2: shape.v2,
    V3: shape.v3,
    S1: shape.s1,
    S2: shape.s2,
    S3: shape.s3,
    LenL: shape.lenL,
    LenR: shape.lenR,
    PosR: shape.posR,
  });
  const outW = W + padding * 2;
  const outH = H + padding * 2;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}"><g transform="translate(${padding},${padding})"><path d="${d}" fill="${fg}"/></g></svg>`;
}
