import sharp from 'sharp';
import type { StyleKey } from './prompts';

export interface ShadeOptions {
  size?: number;
  bevelPx?: number;
  bevelHeight?: number;
  domeWeight?: number;        // 0..1, share of overall cross-section dome vs local bevel
  outFalloff?: number;        // pixels — how far outside the silhouette the height drops to floor
  outDepth?: number;          // depth (0..1) the height reaches just outside the silhouette
  heightBlurPx?: number;      // box-blur radius for the height field (smooths medial-axis ridges)
  domeBlurPx?: number;        // radius for the mask-blur that produces the medial-axis-free dome
  wetSheen?: number;          // sky-reflection-style top sheen (0..0.6)
  lightDir?: [number, number, number];
  ambient?: number;
  diffuse?: number;
  shininess?: number;
  specStrength?: number;
  edgeRing?: number;
  edgeRingWidth?: number;
  // Body-color darkening band tracking the silhouette boundary. Emulates the
  // side-wall shadow of a real 3D molded piece so the result reads as
  // "chocolate carved into the M" rather than "texture clipped to M".
  edgeDarken?: number;        // 0..0.6 — strength
  edgeDarkenPx?: number;      // how far in from the edge the band extends
  fillStrength?: number;      // bounce/reflected-light specular from the opposite direction
  fillShininessMul?: number;  // multiplier on shininess for the fill lobe (broader = lower)
  // Parallax-style texture shift: where the surface normal tilts (i.e. on the
  // bevel), shift the texture sample by this many pixels along the tilt
  // direction so the swatch reads as wrapping over a 3D form rather than as a
  // flat decal cropped to the silhouette.
  parallaxPx?: number;
  // Separate (heavier) blur for the parallax normal field. A larger value
  // means the texture starts warping further inside the silhouette instead
  // of snapping at the bevel — smooth wrap instead of an abrupt bend.
  parallaxBlurPx?: number;
  translucent?: boolean;
  sssStrength?: number;
}

const DEFAULTS: Required<ShadeOptions> = {
  size: 1024,
  bevelPx: 12,
  bevelHeight: 1.0,
  // Subtle bulge from a blurred-mask dome — no EDT medial-axis creases
  // because the dome source is a Gaussian-smoothed binary mask, not an EDT.
  domeWeight: 0.18,
  domeBlurPx: 55,
  outFalloff: 4,
  outDepth: 0.25,
  heightBlurPx: 4,
  lightDir: [-0.45, -0.6, 1.0],
  // High ambient + low diffuse ⇒ no Lambertian "dark side". Body color stays
  // uniform across the silhouette; the top-left light only contributes the
  // specular highlight + edge ring + wet sheen along the bevel rim.
  // Soft directional shading — ambient sets the dark side floor, diffuse
  // provides the smooth top-to-bottom falloff, so the M reads as a 3D form
  // with a visibly lit upper half and a dim (not hard-shadowed) lower half.
  ambient: 0.18,
  diffuse: 0.8,
  // Medium-broad specular — defined enough to read as a clear highlight
  // patch (not a pinpoint dot, not a wash). Higher shininess concentrates
  // the spec so most of the body stays at its true material color.
  shininess: 30,
  specStrength: 0.55,
  edgeRing: 0.18,
  edgeRingWidth: 1,
  edgeDarken: 0.5,
  edgeDarkenPx: 18,
  fillStrength: 0.1,
  fillShininessMul: 0.5,
  parallaxPx: 70,
  parallaxBlurPx: 110,
  wetSheen: 0.12,
  translucent: false,
  sssStrength: 0.5,
};

export const STYLE_SHADE_DEFAULTS: Record<StyleKey, ShadeOptions> = {
  // Chocolate — wet softbox look: broad soft glow across the upper half (high
  // wetSheen with gentle falloff), gentle specular lobe, restrained edge rim.
  chocolate: { shininess: 34, specStrength: 0.75, edgeRing: 0.22, edgeRingWidth: 1, wetSheen: 0.18, domeWeight: 0.22, edgeDarken: 0.6, edgeDarkenPx: 22, fillStrength: 0.12 },
  jelly:     { shininess: 22, specStrength: 1.0, edgeRing: 0.3, wetSheen: 0.25, translucent: true, sssStrength: 0.6, domeWeight: 0.25 },
  caramel:   { shininess: 28, specStrength: 1.15, edgeRing: 0.28, wetSheen: 0.26, domeWeight: 0.2 },
  milk:      { shininess: 18, specStrength: 0.85, edgeRing: 0.22, wetSheen: 0.2 },
  honey:     { shininess: 26, specStrength: 1.05, edgeRing: 0.3, wetSheen: 0.28, translucent: true, sssStrength: 0.55, domeWeight: 0.25 },
  cream:     { shininess: 14, specStrength: 0.6, edgeRing: 0.14, wetSheen: 0.12 },
};

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

// Exact Euclidean distance transform via Felzenszwalb–Huttenlocher (2-pass,
// O(N) per dimension). For interior pixels, returns the distance in pixels
// to the nearest exterior pixel. Exterior pixels get 0.
export function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = (w + h) * (w + h);
  const g = new Float32Array(w * h);

  for (let x = 0; x < w; x++) {
    g[x] = mask[x] ? INF : 0;
    for (let y = 1; y < h; y++) {
      const i = y * w + x;
      g[i] = mask[i] ? g[i - w] + 1 : 0;
    }
    for (let y = h - 2; y >= 0; y--) {
      const i = y * w + x;
      const below = g[i + w] + 1;
      if (below < g[i]) g[i] = below;
    }
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      g[i] = g[i] * g[i];
    }
  }

  const dt = new Float32Array(w * h);
  const v = new Int32Array(w);
  const z = new Float64Array(w + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < w; q++) {
      let s = 0;
      while (true) {
        const fq = g[row + q] + q * q;
        const fk = g[row + v[k]] + v[k] * v[k];
        s = (fq - fk) / (2 * (q - v[k]));
        if (k > 0 && s <= z[k]) k--;
        else break;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < w; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      dt[row + q] = dq * dq + g[row + v[k]];
    }
  }

  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.sqrt(dt[i]);
  return out;
}

function heightFromDistance(d: number, bevelPx: number): number {
  if (d <= 0) return 0;
  if (d >= bevelPx) return 1;
  return Math.sin((d / bevelPx) * Math.PI * 0.5);
}

// Two-pass separable box blur. Smooths medial-axis ridges in the height field
// so the bevel does not show diagonal facets where multiple boundary segments
// happen to be equidistant.
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      for (let xx = x0; xx <= x1; xx++) { sum += src[row + xx]; cnt++; }
      tmp[row + x] = sum / cnt;
    }
  }
  const out = new Float32Array(src.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0, cnt = 0;
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) { sum += tmp[yy * w + x]; cnt++; }
      out[y * w + x] = sum / cnt;
    }
  }
  return out;
}

// Minimal shape + bevel guide. Used as the input image for an img2img model
// that handles all material and lighting. The SDF render's only job here is
// to lock the silhouette and hint at the 3D bevel — every other look choice
// is delegated to the AI pass.
export async function shapeGuideRender(
  svg: string,
  fgHex: string,
  size = 1024,
  bevelPx = 14,
  bevelDarken = 0.4,
): Promise<Buffer> {
  const { mask } = await svgToBinaryMask(svg, size);
  const distIn = distanceTransform(mask, size, size);
  const fg = (() => {
    const m = /^#([0-9a-f]{6})$/i.exec(fgHex);
    if (!m) return { r: 90, g: 55, b: 30 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  })();

  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    if (!mask[i]) continue;
    const d = distIn[i];
    let darken = 1;
    if (d < bevelPx) {
      const t = 1 - d / bevelPx;
      darken = 1 - t * t * bevelDarken;
    }
    out[i * 4]     = Math.round(fg.r * darken);
    out[i * 4 + 1] = Math.round(fg.g * darken);
    out[i * 4 + 2] = Math.round(fg.b * darken);
    out[i * 4 + 3] = 255;
  }
  return sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

export async function svgSilhouetteBbox(
  svg: string,
  size: number,
): Promise<{ left: number; top: number; width: number; height: number }> {
  const { mask } = await svgToBinaryMask(svg, size);
  let minX = size, minY = size, maxX = -1, maxY = -1;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width: size, height: size };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export async function svgToBinaryMask(
  svg: string,
  size: number,
): Promise<{ mask: Uint8Array; alpha: Uint8Array }> {
  const padFrac = 0.22;
  const innerSide = Math.round(size * (1 - padFrac * 2));
  const raster = await sharp(Buffer.from(svg), { density: 300 })
    .resize(innerSide, innerSide, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const { data } = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: raster, gravity: 'center' }])
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mask = new Uint8Array(size * size);
  const alpha = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const a = data[i * 4 + 3];
    alpha[i] = a;
    mask[i] = a > 127 ? 1 : 0;
  }
  return { mask, alpha };
}

export async function shadedRender(
  svg: string,
  materialPng: Buffer,
  userOpts: ShadeOptions = {},
): Promise<Buffer> {
  const opts: Required<ShadeOptions> = { ...DEFAULTS, ...userOpts };
  const size = opts.size;
  const { mask, alpha } = await svgToBinaryMask(svg, size);

  // Two-direction signed distance — inside positive, outside negative.
  // The outside field is what makes the edge read as a real 3D bevel: adjacent
  // outside pixels have negative height so the normal at the boundary tilts
  // sharply outward, catching side light like a cast solid would.
  const distIn = distanceTransform(mask, size, size);
  const inv = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) inv[i] = mask[i] ? 0 : 1;
  const distOut = distanceTransform(inv, size, size);

  let maxD = 0;
  for (let i = 0; i < distIn.length; i++) if (distIn[i] > maxD) maxD = distIn[i];
  const effectiveBevel = Math.max(8, Math.min(opts.bevelPx, maxD * 0.55));
  const domeWeight = opts.domeWeight;
  const bevelWeight = 1 - domeWeight;

  // Dome source: Gaussian-smoothed binary mask. Free of EDT medial-axis
  // ridges (those only appear when you take the gradient of a true distance
  // field), so combining it with the bevel gives a soft melted bulge with no
  // X-shaped creases across the surface.
  const maskFloat = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) maskFloat[i] = mask[i] ? 1 : 0;
  const domeField = opts.domeBlurPx > 0
    ? boxBlur(maskFloat, size, size, opts.domeBlurPx)
    : maskFloat;

  const rawHeight = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (mask[i]) {
      const d = distIn[i];
      const bevelH = heightFromDistance(d, effectiveBevel);
      rawHeight[i] = bevelH * bevelWeight + domeField[i] * domeWeight;
    } else {
      const t = Math.min(1, distOut[i] / opts.outFalloff);
      rawHeight[i] = -t * opts.outDepth;
    }
  }
  const height = boxBlur(rawHeight, size, size, opts.heightBlurPx);
  // Heavier blur for the parallax-only height field — its gradient extends
  // smoothly inward from the silhouette boundary so the texture starts to
  // warp well before the actual bevel and reaches its full bend at the rim.
  const parallaxHeight = opts.parallaxBlurPx > 0
    ? boxBlur(rawHeight, size, size, opts.parallaxBlurPx)
    : height;

  const normalStrength = 3.0 * opts.bevelHeight;
  const Nx = new Float32Array(size * size);
  const Ny = new Float32Array(size * size);
  const Nz = new Float32Array(size * size);
  // Parallax normal — same algorithm, fed by the smoother parallaxHeight.
  const pNx = new Float32Array(size * size);
  const pNy = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (!mask[i]) {
        Nx[i] = 0; Ny[i] = 0; Nz[i] = 1;
        pNx[i] = 0; pNy[i] = 0;
        continue;
      }
      const hL = x > 0 ? height[i - 1] : height[i];
      const hR = x < size - 1 ? height[i + 1] : height[i];
      const hU = y > 0 ? height[i - size] : height[i];
      const hD = y < size - 1 ? height[i + size] : height[i];
      const dx = (hR - hL) * normalStrength;
      const dy = (hD - hU) * normalStrength;
      const len = Math.hypot(-dx, -dy, 1) || 1;
      Nx[i] = -dx / len;
      Ny[i] = -dy / len;
      Nz[i] = 1 / len;

      const phL = x > 0 ? parallaxHeight[i - 1] : parallaxHeight[i];
      const phR = x < size - 1 ? parallaxHeight[i + 1] : parallaxHeight[i];
      const phU = y > 0 ? parallaxHeight[i - size] : parallaxHeight[i];
      const phD = y < size - 1 ? parallaxHeight[i + size] : parallaxHeight[i];
      // Scale up the gradient: a heavily blurred height has tiny per-pixel
      // deltas, but we want the tilt direction to drive a meaningful shift.
      const pdx = (phR - phL) * 60;
      const pdy = (phD - phU) * 60;
      const plen = Math.hypot(-pdx, -pdy, 1) || 1;
      pNx[i] = -pdx / plen;
      pNy[i] = -pdy / plen;
    }
  }

  const material = await sharp(materialPng)
    .resize(size, size, { fit: 'cover' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const [Lx, Ly, Lz] = normalize3(opts.lightDir[0], opts.lightDir[1], opts.lightDir[2]);
  const [Hx, Hy, Hz] = normalize3(Lx, Ly, Lz + 1);
  // Fill light: mirror of the main light across the view axis (i.e. from the
  // opposite side, slightly more frontal). Simulates bounce/reflected light so
  // the dark side of the bevel does not read as a hard shadow.
  const [Fx, Fy, Fz] = normalize3(-Lx, -Ly, Lz + 0.3);
  const [Hfx, Hfy, Hfz] = normalize3(Fx, Fy, Fz + 1);
  const fillShininess = Math.max(2, opts.shininess * opts.fillShininessMul);
  const out = Buffer.alloc(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    if (!mask[i]) {
      out[i * 4 + 3] = 0;
      continue;
    }
    const nx = Nx[i], ny = Ny[i], nz = Nz[i];
    const ndotl = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
    const ndoth = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
    const spec = Math.pow(ndoth, opts.shininess) * opts.specStrength;
    const ndothFill = Math.max(0, nx * Hfx + ny * Hfy + nz * Hfz);
    const fillSpec = Math.pow(ndothFill, fillShininess) * opts.fillStrength;

    const d = distIn[i];
    let ring = 0;
    if (d < opts.edgeRingWidth) {
      const t = d / opts.edgeRingWidth;
      ring = (1 - t) * opts.edgeRing;
    }

    // Body color from the material swatch, darkened in a band along the
    // silhouette boundary so the M reads as a 3D molded piece (the side wall
    // is in shadow, not just a flat clip of the texture). Texture sample is
    // also shifted in the negative-normal direction so the swatch appears to
    // wrap around the bevel rather than sit flat under it.
    let edgeMult = 1;
    if (d < opts.edgeDarkenPx) {
      const t = 1 - d / opts.edgeDarkenPx;       // 1 at edge, 0 at full width
      edgeMult = 1 - t * t * opts.edgeDarken;    // squared falloff
    }
    const x = i % size;
    const y = (i - x) / size;
    const sx = Math.max(0, Math.min(size - 1, Math.round(x - pNx[i] * opts.parallaxPx)));
    const sy = Math.max(0, Math.min(size - 1, Math.round(y - pNy[i] * opts.parallaxPx)));
    const sampleIdx = (sy * size + sx) * 4;
    const mR = (material[sampleIdx] / 255) * edgeMult;
    const mG = (material[sampleIdx + 1] / 255) * edgeMult;
    const mB = (material[sampleIdx + 2] / 255) * edgeMult;

    const lit = opts.ambient + opts.diffuse * ndotl;
    // Wet sheen — fake sky reflection on surfaces whose normal points upward
    // (image -Y). Concentrated band near horizontal-facing tops, gives the
    // "wet melted" read without adding a hard shadow on the opposite side.
    // Broad softbox-style top reflection. Power 3 keeps the sheen wider than
    // a hard specular but still concentrates it on the upward-facing surfaces
    // so it does not wash out the entire body.
    const upDot = Math.max(0, -ny * 0.8 + nz * 0.4);
    const sheen = Math.pow(upDot, 3) * opts.wetSheen;
    let r = mR * lit + spec + ring + sheen + fillSpec;
    let g = mG * lit + spec + ring + sheen + fillSpec;
    let b = mB * lit + spec + ring + sheen + fillSpec;

    if (opts.translucent) {
      const sss = (1 - height[i]) * opts.sssStrength;
      r += mR * sss * 1.08;
      g += mG * sss * 1.04;
      b += mB * sss * 0.96;
    }

    // Reinhard-style soft clip with whitepoint=1.6.
    const W2 = 1.6 * 1.6;
    r = (r * (1 + r / W2)) / (1 + r);
    g = (g * (1 + g / W2)) / (1 + g);
    b = (b * (1 + b / W2)) / (1 + b);

    out[i * 4]     = Math.max(0, Math.min(255, Math.round(r * 255)));
    out[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
    out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    // Full opacity inside — partial alpha at the AA boundary would let the page
    // background bleed through shadowed pixels. Outside stays alpha=0 from the
    // early-out branch above.
    out[i * 4 + 3] = 255;
  }

  return await sharp(out, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}
