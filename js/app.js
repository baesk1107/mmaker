// M-maker — parametric M with V-position controls and auto-fit display

const stage = document.getElementById("stage");
const frame = document.getElementById("frame");
const mSvg = document.getElementById("mSvg");
const mPath = document.getElementById("mPath");
const wSlider = document.getElementById("wSlider");
const wNum = document.getElementById("wNum");
const rSlider = document.getElementById("rSlider");
const rNum = document.getElementById("rNum");
const v1Slider = document.getElementById("v1Slider");
const v1Num = document.getElementById("v1Num");
const v2Slider = document.getElementById("v2Slider");
const v2Num = document.getElementById("v2Num");
const v3Slider = document.getElementById("v3Slider");
const v3Num = document.getElementById("v3Num");
const s1Slider = document.getElementById("s1Slider");
const s1Num = document.getElementById("s1Num");
const s2Slider = document.getElementById("s2Slider");
const s2Num = document.getElementById("s2Num");
const s3Slider = document.getElementById("s3Slider");
const s3Num = document.getElementById("s3Num");
const fgPicker = document.getElementById("fgPicker");
const bgPicker = document.getElementById("bgPicker");
const ratioOut = document.getElementById("ratioOut");
const resetBtn = document.getElementById("reset");
const exportBtn = document.getElementById("exportPng");

// ---- Constants --------------------------------------------------------------

const KAPPA = 0.5523;
const M_ORIG = { W: 239.89, H: 263.79, R: 5.98 };
const H_LOGICAL = 800;
const STAGE_FILL_H = 0.8;          // fit 80% of stage height
const STAGE_FILL_W = 0.92;         // never exceed 92% of stage width
const PCT_MIN = 25;
const PCT_MAX = 400;
// Per-V max horizontal shift (as fraction of W).
const V1_SHIFT_MAX  = 0.43;        // top V mirror
// Outer-shift caps so that at extreme (V2=0 / V3=100), the leg sits
// at 10% of W from the corresponding edge of the M. The two values differ
// because the original M's LegL (78.53) and LegR (186.11) aren't symmetric
// about the center.
const V2_OUTER_MAX  = 78.53 / 239.89 - 0.10;   // ≈ 0.2274
const V3_OUTER_MAX  = 0.90 - 186.11 / 239.89;  // ≈ 0.1242
const V_INNER_MAX   = 0.30;        // V2 going right, V3 going left (clamped via gap)
const V_GAP_MARGIN  = 0.05;        // clearance (frac of W) on top of R

const P_DESIGN = {
  TL:    [129.475, 0],
  apex:  [171.31,  90.47],
  TR:    [214.628, 0],
  LegR:  [186.11,  159.55],
  BVR:   [145.77,  263.79],
  BVL:   [118.87,  263.79],
  LegL:  [78.53,   159.55],
};
const DIST = {
  TLshoulder:  { in: 5.755, out: 5.751 },
  Tapex:       { in: 30.79, out: 30.62 },
  TRshoulder:  { in: 5.666, out: 5.672 },
  LegTopR:     { in: 56.73, out: 56.51 },
  BVshoulderR: { in: 4.10,  out: 4.10  },
  BVshoulderL: { in: 4.10,  out: 4.10  },
  LegTopL:     { in: 56.48, out: 56.73 },
};
const RATIO = {
  TLshoulder:  { in: 0.362, out: 0.361 },
  Tapex:       { in: 0.529, out: 0.512 },
  TRshoulder:  { in: 0.360, out: 0.360 },
  LegTopR:     { in: 0.625, out: 0.577 },
  BVshoulderR: { in: 0.365, out: 0.365 },
  BVshoulderL: { in: 0.365, out: 0.365 },
  LegTopL:     { in: 0.577, out: 0.625 },
};

// ---- Path generator ---------------------------------------------------------

function computeMaxR(W, H) {
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

function norm(v) {
  const len = Math.hypot(v[0], v[1]);
  return len > 0 ? [v[0] / len, v[1] / len] : [0, 0];
}
function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }

function buildMPath(W, H, R, V1, V2, V3, S1, S2, S3) {
  R = Math.max(0, Math.min(R, computeMaxR(W, H)));
  const sx = W / M_ORIG.W;
  const sy = H / M_ORIG.H;
  const rs = R / M_ORIG.R;
  const f = (v) => +v.toFixed(3);

  const sP = {};
  for (const k in P_DESIGN) sP[k] = [P_DESIGN[k][0] * sx, P_DESIGN[k][1] * sy];

  // V1: slider 0..100, default 100 (current = rightmost). 100→0 = leftward.
  // V2/V3: slider 0..100, default 50. <50 = outward, >50 = inward.
  const v1px = (V1 - 100) / 100 * V1_SHIFT_MAX * W;
  const v2norm = (V2 - 50) / 50;
  const v3norm = (V3 - 50) / 50;
  let v2px = v2norm > 0 ? v2norm * V_INNER_MAX * W : v2norm * V2_OUTER_MAX * W;
  let v3px = v3norm > 0 ? v3norm * V3_OUTER_MAX * W : v3norm * V_INNER_MAX * W;

  // Maintain ≥ R gap between BVL and BVR (otherwise the bottom-V flat inverts
  // and the path crosses into an X).
  const naturalGap = (P_DESIGN.BVR[0] - P_DESIGN.BVL[0]) * sx;
  const allowedDiff = naturalGap - R - V_GAP_MARGIN * W;
  const diff = v2px - v3px;
  if (diff > allowedDiff) {
    const excess = diff - allowedDiff;
    v2px -= excess / 2;
    v3px += excess / 2;
  }

  sP.TL[0]   += v1px;
  sP.apex[0] += v1px;
  sP.TR[0]   += v1px;
  sP.LegL[0] += v2px;
  sP.BVL[0]  += v2px;
  sP.LegR[0] += v3px;
  sP.BVR[0]  += v3px;

  // Apply size scales (0..100 → 1.0..1.3). V1 scales around its (shifted)
  // midpoint horizontally and around the top edge vertically. V2/V3 scale
  // the slope length around BVL/BVR (which sit on the bottom edge).
  const v1Scale = 1 + (S1 / 100) * 0.3;
  const v2Scale = 1 + (S2 / 100) * 0.3;
  const v3Scale = 1 + (S3 / 100) * 0.3;
  const v1Mid = (sP.TL[0] + sP.TR[0]) / 2;
  sP.TL[0]   = v1Mid + (sP.TL[0]   - v1Mid) * v1Scale;
  sP.TR[0]   = v1Mid + (sP.TR[0]   - v1Mid) * v1Scale;
  sP.apex[0] = v1Mid + (sP.apex[0] - v1Mid) * v1Scale;
  sP.apex[1] *= v1Scale;
  sP.LegL[0] = sP.BVL[0] + (sP.LegL[0] - sP.BVL[0]) * v2Scale;
  sP.LegL[1] = sP.BVL[1] + (sP.LegL[1] - sP.BVL[1]) * v2Scale;
  sP.LegR[0] = sP.BVR[0] + (sP.LegR[0] - sP.BVR[0]) * v3Scale;
  sP.LegR[1] = sP.BVR[1] + (sP.LegR[1] - sP.BVR[1]) * v3Scale;

  const T_R = [1, 0], T_L = [-1, 0], T_U = [0, -1], T_D = [0, 1];
  const T_TLslope = norm(sub(sP.apex, sP.TL));
  const T_TRslope = norm(sub(sP.TR, sP.apex));
  const T_BRslope = norm(sub(sP.BVR, sP.LegR));
  const T_BLslope = norm(sub(sP.LegL, sP.BVL));

  const pIn  = (P, t, d) => [P[0] - t[0] * d * rs, P[1] - t[1] * d * rs];
  const pOut = (P, t, d) => [P[0] + t[0] * d * rs, P[1] + t[1] * d * rs];

  const L1  = pIn (sP.TL,   T_R,        DIST.TLshoulder.in);
  const L2  = pOut(sP.TL,   T_TLslope,  DIST.TLshoulder.out);
  const L3  = pIn (sP.apex, T_TLslope,  DIST.Tapex.in);
  const L4  = pOut(sP.apex, T_TRslope,  DIST.Tapex.out);
  const L5  = pIn (sP.TR,   T_TRslope,  DIST.TRshoulder.in);
  const L6  = pOut(sP.TR,   T_R,        DIST.TRshoulder.out);
  const L13 = pIn (sP.LegR, T_U,        DIST.LegTopR.in);
  const L14 = pOut(sP.LegR, T_BRslope,  DIST.LegTopR.out);
  const L15 = pIn (sP.BVR,  T_BRslope,  DIST.BVshoulderR.in);
  const L16 = pOut(sP.BVR,  T_L,        DIST.BVshoulderR.out);
  const L17 = pIn (sP.BVL,  T_L,        DIST.BVshoulderL.in);
  const L18 = pOut(sP.BVL,  T_BLslope,  DIST.BVshoulderL.out);
  const L19 = pIn (sP.LegL, T_BLslope,  DIST.LegTopL.in);
  const L20 = pOut(sP.LegL, T_D,        DIST.LegTopL.out);

  const TLafter = [R, 0];
  const L7  = [W - R, 0];
  const L8  = [W, R];
  const L9  = [W, H - R];
  const L10 = [W - R, H];
  const xLegR = sP.LegR[0];
  const xLegL = sP.LegL[0];
  const L11 = [xLegR + R, H];
  const L12 = [xLegR, H - R];
  const L21 = [xLegL, H - R];
  const L22 = [xLegL - R, H];
  const L23 = [R, H];
  const L24 = [0, H - R];
  const L25 = [0, R];

  const Rk = R * KAPPA;
  const cubic = (p0, p3, tIn, tOut, mIn, mOut) => {
    const c1x = p0[0] + tIn[0] * mIn;
    const c1y = p0[1] + tIn[1] * mIn;
    const c2x = p3[0] - tOut[0] * mOut;
    const c2y = p3[1] - tOut[1] * mOut;
    return `C${f(c1x)},${f(c1y)} ${f(c2x)},${f(c2y)} ${f(p3[0])},${f(p3[1])}`;
  };
  const smooth = (p0, p3, tIn, tOut, ratio) => {
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    return cubic(p0, p3, tIn, tOut, chord * ratio.in, chord * ratio.out);
  };
  const line = (p) => `L${f(p[0])},${f(p[1])}`;

  const out = [];
  out.push(`M${f(TLafter[0])},${f(TLafter[1])}`);
  out.push(line(L1));
  out.push(smooth(L1, L2, T_R, T_TLslope, RATIO.TLshoulder));
  out.push(line(L3));
  out.push(smooth(L3, L4, T_TLslope, T_TRslope, RATIO.Tapex));
  out.push(line(L5));
  out.push(smooth(L5, L6, T_TRslope, T_R, RATIO.TRshoulder));
  out.push(line(L7));
  out.push(cubic(L7,  L8,  T_R, T_D, Rk, Rk));
  out.push(line(L9));
  out.push(cubic(L9,  L10, T_D, T_L, Rk, Rk));
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

// ---- State & animation -----------------------------------------------------

const state = {
  target:  { w: H_LOGICAL, r: 20, v1: 100, v2: 50, v3: 50, s1: 0, s2: 0, s3: 0 },
  display: { w: H_LOGICAL, r: 20, v1: 100, v2: 50, v3: 50, s1: 0, s2: 0, s3: 0 },
  fg: "#111111",
  bg: "#ffffff",
  initial: null,
};

// Ease-out (fast-start, slow-end) with a subtle elastic overshoot near the end.
// Reaches target near t=0.4, peaks ~5% around t=0.7, settles smoothly to 1.
function easeOutSpring(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
const easeLinear = (t) => t;
const lerp = (a, b, t) => a + (b - a) * t;

const ANIM_KEYS = ["w", "r", "v1", "v2", "v3", "s1", "s2", "s3"];
const ANIM_CFG = {
  w:  { duration: 586, ease: easeOutSpring },
  r:  { duration: 286, ease: easeLinear },
  v1: { duration: 520, ease: easeOutSpring },
  v2: { duration: 520, ease: easeOutSpring },
  v3: { duration: 520, ease: easeOutSpring },
  s1: { duration: 520, ease: easeOutSpring },
  s2: { duration: 520, ease: easeOutSpring },
  s3: { duration: 520, ease: easeOutSpring },
};
const animState = {};
for (const k of ANIM_KEYS) animState[k] = { active: false, from: 0, to: 0, start: 0 };
let animLoopRunning = false;

function animateProp(prop) {
  const s = animState[prop];
  s.from = state.display[prop];
  s.to = state.target[prop];
  s.start = performance.now();
  s.active = true;
  if (!animLoopRunning) {
    animLoopRunning = true;
    requestAnimationFrame(tick);
  }
}

function tick(now) {
  let anyActive = false;
  for (const key of ANIM_KEYS) {
    const s = animState[key];
    if (!s.active) continue;
    const cfg = ANIM_CFG[key];
    const t = Math.min(1, (now - s.start) / cfg.duration);
    state.display[key] = lerp(s.from, s.to, cfg.ease(t));
    if (t < 1) anyActive = true;
    else { s.active = false; state.display[key] = s.to; }
  }
  state.display.w = Math.max(16, state.display.w);
  state.display.r = Math.max(0, state.display.r);
  render();
  if (anyActive) requestAnimationFrame(tick);
  else animLoopRunning = false;
}

// ---- Display ----------------------------------------------------------------

function getDisplayScale() {
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  const scaleH = (stageH * STAGE_FILL_H) / H_LOGICAL;
  const scaleW = (stageW * STAGE_FILL_W) / state.display.w;
  return Math.max(0.01, Math.min(scaleH, scaleW));
}

function render() {
  const W = state.display.w;
  const H = H_LOGICAL;
  const R = state.display.r;
  const V1 = state.display.v1;
  const V2 = state.display.v2;
  const V3 = state.display.v3;
  const S1 = state.display.s1;
  const S2 = state.display.s2;
  const S3 = state.display.s3;
  const scale = getDisplayScale();

  frame.style.width  = (W * scale) + "px";
  frame.style.height = (H * scale) + "px";

  mSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  mPath.setAttribute("d", buildMPath(W, H, R, V1, V2, V3, S1, S2, S3));
  mPath.setAttribute("fill", state.fg);
  stage.style.background = state.bg;

  const pct = (state.target.w / H_LOGICAL) * 100;
  ratioOut.textContent = `${pct.toFixed(0)}%  ·  ${Math.round(state.target.w)} × ${H_LOGICAL}`;

  const maxR = computeMaxR(state.target.w, H_LOGICAL);
  const maxRFmt = (Math.floor(maxR * 10) / 10).toFixed(1);
  if (rSlider.max !== maxRFmt) {
    rSlider.max = maxRFmt;
    rNum.max = maxRFmt;
  }
}

// ---- Mapping helpers --------------------------------------------------------

function sliderToPct(s) {
  return PCT_MIN * Math.pow(PCT_MAX / PCT_MIN, s / 100);
}
function pctToSlider(p) {
  return 100 * Math.log(p / PCT_MIN) / Math.log(PCT_MAX / PCT_MIN);
}
function pctToW(p) { return (p / 100) * H_LOGICAL; }
function wToPct(w) { return (w / H_LOGICAL) * 100; }

function syncControls() {
  const pct = wToPct(state.target.w);
  wSlider.value = pctToSlider(pct);
  if (document.activeElement !== wNum) wNum.value = Math.round(pct);
  rSlider.value = state.target.r;
  if (document.activeElement !== rNum) rNum.value = Math.round(state.target.r * 10) / 10;
  const vPairs = [
    [v1Slider, v1Num, "v1"], [v2Slider, v2Num, "v2"], [v3Slider, v3Num, "v3"],
    [s1Slider, s1Num, "s1"], [s2Slider, s2Num, "s2"], [s3Slider, s3Num, "s3"],
  ];
  for (const [s, n, key] of vPairs) {
    s.value = Math.round(state.target[key]);
    if (document.activeElement !== n) n.value = Math.round(state.target[key]);
  }
}

function clampTargetR() {
  const maxR = computeMaxR(state.target.w, H_LOGICAL);
  if (state.target.r > maxR) state.target.r = maxR;
}

// ---- Controls --------------------------------------------------------------

function commitW(pct) {
  pct = Math.max(PCT_MIN, Math.min(PCT_MAX * 2, pct));
  state.target.w = pctToW(pct);
  clampTargetR();
  animateProp("w");
  animateProp("r");
  syncControls();
}
function setRTarget(v) {
  const maxR = computeMaxR(state.target.w, H_LOGICAL);
  v = Math.max(0, Math.min(maxR, v));
  state.target.r = v;
  animateProp("r");
  syncControls();
}
function setVTarget(key, val) {
  val = Math.max(0, Math.min(100, val));
  state.target[key] = val;
  animateProp(key);
  syncControls();
}

wSlider.addEventListener("input", (e) => { wNum.value = Math.round(sliderToPct(Number(e.target.value))); });
wSlider.addEventListener("change", (e) => { commitW(sliderToPct(Number(e.target.value))); });
wNum.addEventListener("change", (e) => { commitW(Number(e.target.value) || PCT_MIN); });

rSlider.addEventListener("input", (e) => { setRTarget(Number(e.target.value)); });
rNum.addEventListener("change", (e) => { setRTarget(Number(e.target.value)); });
rNum.addEventListener("input", (e) => {
  const v = Number(e.target.value);
  if (!Number.isNaN(v)) setRTarget(v);
});

function bindVSlider(slider, num, key) {
  slider.addEventListener("input", (e) => { num.value = e.target.value; });
  slider.addEventListener("change", (e) => { setVTarget(key, Number(e.target.value)); });
  num.addEventListener("change", (e) => { setVTarget(key, Number(e.target.value) || 0); });
}
bindVSlider(v1Slider, v1Num, "v1");
bindVSlider(v2Slider, v2Num, "v2");
bindVSlider(v3Slider, v3Num, "v3");
bindVSlider(s1Slider, s1Num, "s1");
bindVSlider(s2Slider, s2Num, "s2");
bindVSlider(s3Slider, s3Num, "s3");

// Flavor presets fill the prompt textarea (generation is a future step)
document.querySelectorAll("#flavorPresets button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const t = document.getElementById("aiPrompt");
    if (t) t.value = btn.dataset.flavor || "";
  });
});

fgPicker.addEventListener("input", (e) => {
  state.fg = e.target.value;
  mPath.setAttribute("fill", state.fg);
});
bgPicker.addEventListener("input", (e) => {
  state.bg = e.target.value;
  stage.style.background = state.bg;
});

// Reset is scoped to the bordered "shape" section: R, V1, V2, V3.
// W and colors are intentionally preserved.
resetBtn.addEventListener("click", () => {
  if (!state.initial) return;
  for (const key of ["r", "v1", "v2", "v3", "s1", "s2", "s3"]) {
    state.target[key] = state.initial.target[key];
    animateProp(key);
  }
  syncControls();
});

// ---- Random colors ---------------------------------------------------------

function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function randomColors() {
  const h = Math.floor(Math.random() * 360);
  const compl = (h + 180 + Math.floor(Math.random() * 80) - 40 + 360) % 360;
  const fg = hslHex(h,     55 + Math.random() * 30, 18 + Math.random() * 22);
  const bg = hslHex(compl, 25 + Math.random() * 35, 78 + Math.random() * 14);
  return { fg, bg };
}

// ---- Export ----------------------------------------------------------------

const EXPORT_PAD = 20;
exportBtn.addEventListener("click", async () => {
  const W = Math.round(state.target.w);
  const H = H_LOGICAL;
  const R = state.target.r;
  const d = buildMPath(W, H, R,
                       state.target.v1, state.target.v2, state.target.v3,
                       state.target.s1, state.target.s2, state.target.s3);
  const pad = EXPORT_PAD;
  const outW = W + pad * 2;
  const outH = H + pad * 2;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}"><g transform="translate(${pad},${pad})"><path d="${d}" fill="${state.fg}"/></g></svg>`;
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImageEl(url);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    // transparent background (no fill)
    ctx.drawImage(img, 0, 0, outW, outH);
    canvas.toBlob((b) => {
      if (!b) return;
      const dl = URL.createObjectURL(b);
      const a = document.createElement("a");
      a.href = dl;
      a.download = `m-maker_${outW}x${outH}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(dl), 1000);
    }, "image/png");
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});
function loadImageEl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ---- Init ------------------------------------------------------------------

function init() {
  const { fg, bg } = randomColors();
  state.fg = fg;
  state.bg = bg;
  fgPicker.value = fg;
  bgPicker.value = bg;

  state.target = { w: H_LOGICAL, r: 20, v1: 100, v2: 50, v3: 50, s1: 0, s2: 0, s3: 0 };
  state.display = { ...state.target };
  state.initial = { target: { ...state.target }, fg, bg };

  syncControls();
  render();
}

window.addEventListener("load", () => requestAnimationFrame(init));
window.addEventListener("resize", () => render());
