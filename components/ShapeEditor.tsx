'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildMPath,
  buildSvg,
  computeMAnchors,
  computeMaxR,
  DEFAULT_SHAPE,
  H_LOGICAL,
  PCT_MAX,
  PCT_MIN,
  STAGE_FILL_H,
  STAGE_FILL_W,
  STEM_LIFT_MAX,
  STEM_POS_MAX,
  type MParams,
  type ShapeState,
} from '@/lib/m-path';
import { ANIM_KEYS, ANIM_CFG, lerp, type AnimKey } from '@/lib/animation';
import { randomColors } from '@/lib/colors';

function stepLabel(elapsed: number): string {
  if (elapsed < 1.5) return 'Preparing your shape…';
  if (elapsed < 4) return 'Rasterizing & beveling…';
  if (elapsed < 12) return 'Sending to OpenAI…';
  if (elapsed < 28) return 'AI is painting textures…';
  return 'Finalizing the image…';
}

function sliderToPct(s: number) {
  return PCT_MIN * Math.pow(PCT_MAX / PCT_MIN, s / 100);
}
function pctToSlider(p: number) {
  return 100 * Math.log(p / PCT_MIN) / Math.log(PCT_MAX / PCT_MIN);
}
function pctToW(p: number) { return (p / 100) * H_LOGICAL; }
function wToPct(w: number) { return (w / H_LOGICAL) * 100; }

type AnimSlot = { active: boolean; from: number; to: number; start: number };

// On-canvas drag handles — one per editable param, drawn at its anchor point.
const HANDLE_KEYS = ['w', 'r', 'v1', 's1', 'v2', 's2', 'v3', 's3', 'lenL', 'lenR', 'posR'] as const;
type HandleKey = (typeof HANDLE_KEYS)[number];
const HANDLE_LABEL: Record<HandleKey, string> = {
  w: 'W', r: 'R', v1: 'V1', s1: 'S1', v2: 'V2', s2: 'S2', v3: 'V3', s3: 'S3',
  lenL: 'LL', lenR: 'LR', posR: 'RP',
};
// Cursor hint by dominant drag axis.
const HANDLE_AXIS: Record<HandleKey, 'x' | 'y' | 'd'> = {
  w: 'x', r: 'd', v1: 'x', s1: 'x', v2: 'x', s2: 'x', v3: 'x', s3: 'x',
  lenL: 'y', lenR: 'y', posR: 'y',
};

function paramsFromShape(s: ShapeState): MParams {
  return {
    W: Math.max(16, s.w), H: H_LOGICAL, R: s.r,
    V1: s.v1, V2: s.v2, V3: s.v3, S1: s.s1, S2: s.s2, S3: s.s3,
    LenL: s.lenL, LenR: s.lenR, PosR: s.posR,
  };
}

// Local anchor sensitivity (Δ viewBox position per unit param) via central
// difference, so drag deltas map back to the right param without hand-derived
// formulas. The projection onto this vector naturally constrains each handle to
// the axis its param actually moves along.
function handleSens(s: ShapeState, key: HandleKey): [number, number] {
  const d = key === 'w' ? 4 : 1;
  const a1 = computeMAnchors(paramsFromShape({ ...s, [key]: (s[key] as number) + d }))[key];
  const a0 = computeMAnchors(paramsFromShape({ ...s, [key]: (s[key] as number) - d }))[key];
  return [(a1[0] - a0[0]) / (2 * d), (a1[1] - a0[1]) / (2 * d)];
}

export function ShapeEditor() {
  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const handleRefs = useRef<Record<HandleKey, SVGGElement | null>>(
    Object.fromEntries(HANDLE_KEYS.map((k) => [k, null])) as Record<HandleKey, SVGGElement | null>,
  );
  const vbRef = useRef({ x: 0, y: 0, w: H_LOGICAL, h: H_LOGICAL });
  const draggingRef = useRef<
    { key: HandleKey; start: ShapeState; p0: [number, number]; sens: [number, number] } | null
  >(null);

  // Target = where state should land. Display = where it is right now (animated).
  const targetRef = useRef<ShapeState>({ ...DEFAULT_SHAPE });
  const displayRef = useRef<ShapeState>({ ...DEFAULT_SHAPE });
  const animRef = useRef<Record<AnimKey, AnimSlot>>(
    Object.fromEntries(
      ANIM_KEYS.map((k) => [k, { active: false, from: 0, to: 0, start: 0 }]),
    ) as Record<AnimKey, AnimSlot>,
  );
  const loopRunning = useRef(false);

  const [fg, setFg] = useState('#111111');
  const [bg, setBg] = useState('#ffffff');
  const [, forceTick] = useState(0); // for control input echo
  const [stageMode, setStageMode] = useState<'edit' | 'result'>('edit');
  const [showHandles, setShowHandles] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultShape, setResultShape] = useState<ShapeState | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');

  const render = useCallback(() => {
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!stage || !frame) return;

    // In result mode, size the frame to the shape captured at generation time
    // so it matches the cropped PNG's aspect; in edit mode, follow live state.
    const isResult = stageMode === 'result' && !!resultShape;
    const s = isResult ? resultShape! : displayRef.current;
    const W = Math.max(16, s.w);
    const H = H_LOGICAL;
    const R = Math.max(0, s.r);

    // PosR / stem length can push the right stem above the top edge or below the
    // baseline. Expand the vertical view to include that excursion so it isn't
    // clipped by the viewBox; the M scales down to stay fully visible.
    let vbY = 0;
    let vbH = H;
    if (!isResult) {
      const dyR = ((50 - s.posR) / 50) * STEM_POS_MAX * H;
      const botR = H - (1 - s.lenR / 100) * STEM_LIFT_MAX * H;
      vbY = Math.min(0, dyR);
      vbH = Math.max(H, botR + dyR) - vbY;
    }

    const stageW = stage.clientWidth;
    const stageH = stage.clientHeight;
    const scaleH = (stageH * STAGE_FILL_H) / vbH;
    const scaleW = (stageW * STAGE_FILL_W) / W;
    const scale = Math.max(0.01, Math.min(scaleH, scaleW));

    frame.style.width = `${W * scale}px`;
    frame.style.height = `${vbH * scale}px`;
    vbRef.current = { x: 0, y: vbY, w: W, h: vbH };

    const svg = svgRef.current;
    const path = pathRef.current;
    if (svg && path) {
      svg.setAttribute('viewBox', `0 ${vbY} ${W} ${vbH}`);
      path.setAttribute(
        'd',
        buildMPath({ W, H, R, V1: s.v1, V2: s.v2, V3: s.v3, S1: s.s1, S2: s.s2, S3: s.s3, LenL: s.lenL, LenR: s.lenR, PosR: s.posR }),
      );
      path.setAttribute('fill', fg);
    }

    // Position drag handles on the live shape (screen-constant size via 1/scale).
    if (!isResult && showHandles) {
      const anchors = computeMAnchors(paramsFromShape(s));
      const inv = 1 / scale;
      for (const key of HANDLE_KEYS) {
        const el = handleRefs.current[key];
        if (!el) continue;
        const a = anchors[key];
        el.setAttribute('transform', `translate(${a[0]} ${a[1]}) scale(${inv})`);
      }
    }
  }, [fg, stageMode, resultShape, showHandles]);

  const tick = useCallback((now: number) => {
    let anyActive = false;
    const display = displayRef.current;
    for (const key of ANIM_KEYS) {
      const slot = animRef.current[key];
      if (!slot.active) continue;
      const cfg = ANIM_CFG[key];
      const t = Math.min(1, (now - slot.start) / cfg.duration);
      display[key] = lerp(slot.from, slot.to, cfg.ease(t));
      if (t < 1) anyActive = true;
      else { slot.active = false; display[key] = slot.to; }
    }
    display.w = Math.max(16, display.w);
    display.r = Math.max(0, display.r);
    render();
    if (anyActive) requestAnimationFrame(tick);
    else loopRunning.current = false;
  }, [render]);

  const animateProp = useCallback((prop: AnimKey) => {
    const slot = animRef.current[prop];
    slot.from = displayRef.current[prop];
    slot.to = targetRef.current[prop];
    slot.start = performance.now();
    slot.active = true;
    if (!loopRunning.current) {
      loopRunning.current = true;
      requestAnimationFrame(tick);
    }
  }, [tick]);

  // Init colors and first render — mount only
  useEffect(() => {
    const { fg: f, bg: b } = randomColors();
    setFg(f);
    setBg(b);
    targetRef.current = { ...DEFAULT_SHAPE };
    displayRef.current = { ...DEFAULT_SHAPE };
    requestAnimationFrame(() => render());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onResize = () => render();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [render]);

  // Update stage background when bg changes
  useEffect(() => {
    if (stageRef.current) stageRef.current.style.background = bg;
  }, [bg]);

  // Re-render path when fg changes
  useEffect(() => { render(); }, [fg, render]);

  // When toggling back to edit, the <svg> is freshly mounted and has no path
  // attributes yet — re-apply on next frame.
  useEffect(() => {
    if (stageMode === 'edit') {
      requestAnimationFrame(() => render());
    }
  }, [stageMode, render]);

  const setVTarget = (key: AnimKey, val: number) => {
    val = Math.max(0, Math.min(100, val));
    targetRef.current[key] = val;
    animateProp(key);
    forceTick((x) => x + 1);
  };

  const setRTarget = (val: number) => {
    const maxR = computeMaxR(targetRef.current.w, H_LOGICAL);
    targetRef.current.r = Math.max(0, Math.min(maxR, val));
    animateProp('r');
    forceTick((x) => x + 1);
  };

  const commitW = (pct: number) => {
    pct = Math.max(PCT_MIN, Math.min(PCT_MAX * 2, pct));
    targetRef.current.w = pctToW(pct);
    const maxR = computeMaxR(targetRef.current.w, H_LOGICAL);
    if (targetRef.current.r > maxR) targetRef.current.r = maxR;
    animateProp('w');
    animateProp('r');
    forceTick((x) => x + 1);
  };

  const resetShape = () => {
    for (const key of ['w', 'r', 'v1', 'v2', 'v3', 's1', 's2', 's3', 'lenL', 'lenR', 'posR'] as AnimKey[]) {
      targetRef.current[key] = DEFAULT_SHAPE[key];
      animateProp(key);
    }
    forceTick((x) => x + 1);
  };

  // --- On-canvas drag handles ---
  const viewBoxPoint = (clientX: number, clientY: number): [number, number] => {
    const frame = frameRef.current;
    const vb = vbRef.current;
    if (!frame) return [0, 0];
    const rect = frame.getBoundingClientRect();
    return [
      vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    ];
  };

  // Drag commits land directly (no spring) so the shape tracks the pointer 1:1.
  const dragSet = (key: HandleKey, value: number) => {
    const t = targetRef.current;
    const d = displayRef.current;
    if (key === 'w') {
      const w = Math.max(pctToW(PCT_MIN), Math.min(pctToW(PCT_MAX * 2), value));
      t.w = w; d.w = w;
      const maxRw = computeMaxR(w, H_LOGICAL);
      if (t.r > maxRw) { t.r = maxRw; d.r = maxRw; }
    } else if (key === 'r') {
      const maxRw = computeMaxR(t.w, H_LOGICAL);
      const r = Math.max(0, Math.min(maxRw, value));
      t.r = r; d.r = r;
    } else {
      const v = Math.max(0, Math.min(100, value));
      t[key] = v; d[key] = v;
    }
    render();
    forceTick((x) => x + 1);
  };

  const onHandleDown = (key: HandleKey) => (e: React.PointerEvent<SVGGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = {
      key,
      start: { ...targetRef.current },
      p0: viewBoxPoint(e.clientX, e.clientY),
      sens: handleSens(targetRef.current, key),
    };
  };

  const onHandleMove = (e: React.PointerEvent<SVGGElement>) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const [px, py] = viewBoxPoint(e.clientX, e.clientY);
    const [sx, sy] = drag.sens;
    const denom = sx * sx + sy * sy;
    if (denom < 1e-9) return;
    const dParam = (sx * (px - drag.p0[0]) + sy * (py - drag.p0[1])) / denom;
    dragSet(drag.key, (drag.start[drag.key] as number) + dParam);
  };

  const onHandleUp = (e: React.PointerEvent<SVGGElement>) => {
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    draggingRef.current = null;
  };

  const currentTargets = targetRef.current;
  const pct = wToPct(currentTargets.w);
  const maxR = computeMaxR(currentTargets.w, H_LOGICAL);
  const ratioText = `${pct.toFixed(0)}%  ·  ${Math.round(currentTargets.w)} × ${H_LOGICAL}`;

  const exportPng = useCallback(async () => {
    const svgString = buildSvg(targetRef.current, fg);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      const W = Math.round(targetRef.current.w) + 40;
      const H = H_LOGICAL + 40;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, W, H);
      canvas.toBlob((b) => {
        if (!b) return;
        const dl = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = dl;
        a.download = `m-maker_${W}x${H}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(dl), 1000);
      }, 'image/png');
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }, [fg]);

  const exportSvg = useCallback(() => {
    const svgString = buildSvg(targetRef.current, fg);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `m-maker_${Math.round(targetRef.current.w)}x${H_LOGICAL}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [fg]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setErrorMsg(null);
    setElapsed(0);
    setStageMode('result');
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setElapsed((performance.now() - startedAt) / 1000);
    }, 100);
    const snapshot: ShapeState = { ...targetRef.current };
    try {
      const svgString = buildSvg(snapshot, '#111111');
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ svg: svgString, prompt, color: fg, bg }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResultShape(snapshot);
      setResultUrl(json.imageUrl as string);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStageMode('edit');
    } finally {
      window.clearInterval(timer);
      setGenerating(false);
    }
  }, [prompt, fg, bg]);

  const rSliderMax = useMemo(() => (Math.floor(maxR * 10) / 10).toFixed(1), [maxR]);

  return (
    <div className="app">
      <main className="stage" ref={stageRef}>
        <div className="stage-toggle" role="tablist">
          <button
            type="button"
            className={stageMode === 'edit' ? 'active' : ''}
            onClick={() => setStageMode('edit')}
          >
            edit
          </button>
          <button
            type="button"
            className={stageMode === 'result' ? 'active' : ''}
            onClick={() => setStageMode('result')}
            disabled={!resultUrl}
          >
            result
          </button>
        </div>

        {stageMode === 'edit' && (
          <button
            type="button"
            className={`handles-toggle ${showHandles ? 'active' : ''}`}
            onClick={() => setShowHandles((v) => !v)}
            title="Toggle on-canvas drag handles"
          >
            {showHandles ? '⊹ handles' : '⊹ handles off'}
          </button>
        )}

        <div className="frame" ref={frameRef}>
          {stageMode === 'edit' ? (
            <svg
              ref={svgRef}
              className="m-svg"
              xmlns="http://www.w3.org/2000/svg"
              preserveAspectRatio="none"
            >
              <path ref={pathRef} fill={fg} />
              {showHandles && (
                <g className="m-handles">
                  {HANDLE_KEYS.map((key) => (
                    <g
                      key={key}
                      ref={(el) => { handleRefs.current[key] = el; }}
                      className="m-handle"
                      data-axis={HANDLE_AXIS[key]}
                      onPointerDown={onHandleDown(key)}
                      onPointerMove={onHandleMove}
                      onPointerUp={onHandleUp}
                    >
                      <circle r={14} />
                      <text textAnchor="middle" dominantBaseline="central">{HANDLE_LABEL[key]}</text>
                    </g>
                  ))}
                </g>
              )}
            </svg>
          ) : resultUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resultUrl} alt="Generated M typography" className="result-img" />
          ) : null}
        </div>

        {generating && (
          <div className="gen-overlay" role="status" aria-live="polite">
            <div className="gen-card">
              <div className="gen-spinner" aria-hidden="true" />
              <div className="gen-title">Generating your <b>M</b></div>
              <div className="gen-step">{stepLabel(elapsed)}</div>
              <div className="gen-time">{elapsed.toFixed(1)}s</div>
              <div className="gen-bar"><div className="gen-bar-fill" style={{ width: `${Math.min(95, (elapsed / 35) * 100)}%` }} /></div>
              <div className="gen-hint">first calls usually take 20–35s</div>
            </div>
          </div>
        )}
      </main>

      <aside className="panel">
        <div className="brand">
          <h1>M-maker</h1>
          <span className="muted">parametric · AI</span>
        </div>

        <section className="group">
          <label className="ctl">
            <span className="lbl">W</span>
            <input
              type="range"
              min={0}
              max={100}
              step={0.1}
              value={pctToSlider(pct)}
              onChange={(e) => commitW(sliderToPct(Number(e.target.value)))}
            />
            <input
              type="number"
              min={10}
              max={800}
              step={1}
              value={Math.round(pct)}
              className="num"
              onChange={(e) => commitW(Number(e.target.value) || PCT_MIN)}
            />
            <span className="unit">%</span>
          </label>
        </section>

        <section className="group bordered" data-label="shape">
          <Slider label="R" min={0} max={Number(rSliderMax)} step={0.5}
            value={currentTargets.r}
            onChange={(v) => setRTarget(v)}
          />
          {(['v1', 'v2', 'v3'] as const).map((k, i) => (
            <Slider
              key={k}
              label={`V${i + 1}`}
              min={0} max={100} step={1}
              value={currentTargets[k]}
              onChange={(v) => setVTarget(k, v)}
            />
          ))}
          {(['s1', 's2', 's3'] as const).map((k, i) => (
            <Slider
              key={k}
              label={`V${i + 1}↕`}
              min={0} max={100} step={1}
              value={currentTargets[k]}
              onChange={(v) => setVTarget(k, v)}
            />
          ))}
          <Slider label="L len" min={0} max={100} step={1}
            value={currentTargets.lenL}
            onChange={(v) => setVTarget('lenL', v)}
          />
          <Slider label="R len" min={0} max={100} step={1}
            value={currentTargets.lenR}
            onChange={(v) => setVTarget('lenR', v)}
          />
          <Slider label="R pos" min={0} max={100} step={1}
            value={currentTargets.posR}
            onChange={(v) => setVTarget('posR', v)}
          />
          <button className="ghost reset-shape" onClick={resetShape}>reset shape</button>
        </section>

        <section className="group">
          <label className="ctl">
            <span className="lbl">FG</span>
            <input type="color" value={fg} onChange={(e) => setFg(e.target.value)} />
          </label>
          <label className="ctl">
            <span className="lbl">BG</span>
            <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
          </label>
        </section>

        <section className="ai-section">
          <h2 className="group-title">AI render (gpt-image)</h2>
          <textarea
            className="ai-prompt"
            rows={3}
            placeholder="describe the look (e.g. 'glossy dark chocolate with caramel highlights'). the shape is always preserved."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            className="primary ai-gen"
            onClick={generate}
            disabled={generating}
          >
            {generating ? `generating · ${elapsed.toFixed(1)}s` : 'generate'}
          </button>
          {errorMsg && <div className="ai-error">{errorMsg}</div>}
        </section>

        <div className="ratio-readout">{ratioText}</div>

        <section className="actions">
          <button className="ghost" onClick={exportSvg}>export SVG</button>
          <button className="primary" onClick={exportPng}>export PNG</button>
        </section>
      </aside>
    </div>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const display = Math.round(props.value * (props.step < 1 ? 10 : 1)) / (props.step < 1 ? 10 : 1);
  return (
    <label className="ctl">
      <span className="lbl">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <input
        type="number"
        min={props.min}
        max={props.max}
        step={props.step}
        value={display}
        className="num"
        onChange={(e) => props.onChange(Number(e.target.value) || 0)}
      />
    </label>
  );
}
