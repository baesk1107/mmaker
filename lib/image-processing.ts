import sharp from 'sharp';

// Rasterize the user's M-shape SVG into a high-resolution PNG with a faux
// 3D pre-render. Giving the model a beveled, glossy base biases it toward
// treating the silhouette as a solid object rather than a flat vector.

export interface PreprocessOptions {
  size?: number;       // output square side, default 1024 (OpenAI accepts 1024/1536/auto)
  padFrac?: number;    // background padding fraction around the M
  bevel?: boolean;     // add a soft inner highlight + outer shadow
}

export async function preprocessSvgToPng(
  svg: string,
  opts: PreprocessOptions = {},
): Promise<Buffer> {
  const size = opts.size ?? 1024;
  const bevel = opts.bevel ?? true;

  // The user's M silhouette, already padded + centered in a `size`x`size` canvas.
  const silhouette = await svgToTransparentPng(svg, size);

  if (!bevel) return silhouette;

  // 3D bevel pre-render: give the model an input that already looks like a cast
  // 3D solid (base fill + inner shadow near edges + inner highlight in center +
  // specular ring along the inside of the boundary). The model's job becomes
  // "texturize this 3D M with the requested material" rather than "invent a 3D
  // M from a flat silhouette" — which keeps the rendered content tightly aligned
  // with the input silhouette so the final clip is effectively a no-op.

  // 1. Base fill: silhouette filled with a neutral warm mid-tone.
  const base = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 140, g: 110, b: 90, alpha: 1 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 2. Inner shadow: dark gradient bleeding from outside-silhouette inward,
  //    then clipped back inside — creates a soft dark band along the inner edge.
  const innerShadow = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0.55 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-out' }])
    .blur(14)
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3. Inner highlight: bright cream glow concentrated in the silhouette's
  //    interior, fading toward the edges — domed top-surface cue.
  const creamTinted = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 240, b: 215, alpha: 1 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const innerHighlight = await sharp(creamTinted)
    .blur(55)
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 4. Specular ring: a thin bright band along the inside of the silhouette's
  //    boundary. Marks the bevel highlight that should remain visible all the
  //    way around — including flat horizontal edges.
  const ringPx = Math.max(3, Math.round(size * 0.008));
  const erodedSize = Math.max(1, size - ringPx * 2);
  const eroded = await sharp(silhouette)
    .resize(erodedSize, erodedSize, { fit: 'fill' })
    .extend({
      top: ringPx,
      bottom: ringPx,
      left: ringPx,
      right: ringPx,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const ringAlpha = await sharp(silhouette)
    .composite([{ input: eroded, blend: 'dest-out' }])
    .png()
    .toBuffer();
  const specularRing = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 248, b: 225, alpha: 1 },
    },
  })
    .composite([{ input: ringAlpha, blend: 'dest-in' }])
    .blur(0.8)
    .png()
    .toBuffer();

  return sharp(base)
    .composite([
      { input: innerShadow, blend: 'multiply' },
      { input: innerHighlight, blend: 'screen' },
      { input: specularRing, blend: 'screen' },
    ])
    .png()
    .toBuffer();
}

// Strip background to true transparency (used when we want to send a mask-like
// silhouette rather than the pre-rendered beveled base).
export async function svgToTransparentPng(svg: string, size = 1024): Promise<Buffer> {
  const padFrac = 0.22;
  const innerSide = Math.round(size * (1 - padFrac * 2));
  const raster = await sharp(Buffer.from(svg), { density: 300 })
    .resize(innerSide, innerSide, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: raster, gravity: 'center' }])
    .png()
    .toBuffer();
}

// Build a HARD BINARY edit-mask PNG from the same SVG.
// Convention: transparent (alpha=0) pixels = editable, opaque = preserved.
// Anti-aliased alpha is thresholded so the model gets a pixel-perfect boundary
// matching the user's editor-designed M exactly.
export async function maskFromSvg(svg: string, size = 1024): Promise<Buffer> {
  const silhouette = await svgToTransparentPng(svg, size);
  const soft = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-out' }])
    .raw()
    .toBuffer();
  for (let i = 3; i < soft.length; i += 4) {
    soft[i] = soft[i] > 127 ? 255 : 0;
  }
  return sharp(soft, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

// Compose a final 3D-looking image by masking a shape-free material texture
// into the user's SVG silhouette and overlaying algorithmic 3D shading.
// This pipeline GUARANTEES a pixel-exact silhouette because the AI never
// sees or renders the shape — the AI only produces a flat surface texture,
// which we mask deterministically into the silhouette.
export async function composeWithTexture(
  svg: string,
  texturePng: Buffer,
  size = 1024,
): Promise<Buffer> {
  const silhouette = await svgToTransparentPng(svg, size);

  // 1. Texture clipped to silhouette (the base material body).
  const body = await sharp(texturePng)
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 2. Inner shadow — dark gradient near the silhouette boundary.
  const innerShadow = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0.55 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-out' }])
    .blur(14)
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3. Inner highlight — soft bright glow concentrated in the silhouette's
  //    interior (a domed top-surface cue). Subtle so the texture stays visible.
  const highlightTint = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 240, g: 230, b: 205, alpha: 0.35 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();
  const innerHighlight = await sharp(highlightTint)
    .blur(60)
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 4. Specular ring along the inside of the silhouette boundary.
  const ringPx = Math.max(3, Math.round(size * 0.008));
  const erodedSize = Math.max(1, size - ringPx * 2);
  const eroded = await sharp(silhouette)
    .resize(erodedSize, erodedSize, { fit: 'fill' })
    .extend({
      top: ringPx,
      bottom: ringPx,
      left: ringPx,
      right: ringPx,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const ringAlpha = await sharp(silhouette)
    .composite([{ input: eroded, blend: 'dest-out' }])
    .png()
    .toBuffer();
  const specularRing = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 250, b: 225, alpha: 0.85 },
    },
  })
    .composite([{ input: ringAlpha, blend: 'dest-in' }])
    .blur(0.6)
    .png()
    .toBuffer();

  return sharp(body)
    .composite([
      { input: innerShadow, blend: 'multiply' },
      { input: innerHighlight, blend: 'screen' },
      { input: specularRing, blend: 'screen' },
    ])
    .png()
    .toBuffer();
}

// Post-process: clamp the model's output so its alpha never exceeds the input
// silhouette's alpha. The silhouette alpha is thresholded to binary first so
// shadowed edge pixels do not end up with partial alpha (which would otherwise
// let the page background bleed through dark regions).
export async function clipToSvgSilhouette(
  resultPng: Buffer,
  svg: string,
  size = 1024,
): Promise<Buffer> {
  const silhouette = await svgToTransparentPng(svg, size);
  const { data, info } = await sharp(silhouette).raw().toBuffer({ resolveWithObject: true });
  const hard = Buffer.from(data);
  for (let i = 3; i < hard.length; i += 4) {
    hard[i] = hard[i] > 30 ? 255 : 0;
  }
  const hardMask = await sharp(hard, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
  return sharp(resultPng)
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: hardMask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

// Fill any transparent gaps INSIDE the silhouette with the AI result's mean
// opaque color. The strict clip enforces the outer boundary, but if the model
// left translucent / transparent patches inside (interpreting "honey" as
// melt-with-gaps), those gaps would show the background through the result.
// This pass guarantees the silhouette is fully opaque material.
export async function fillSilhouetteGaps(
  aiResult: Buffer,
  svg: string,
  size = 1024,
): Promise<Buffer> {
  // Resize first so we operate on a consistent size grid.
  const resized = await sharp(aiResult)
    .resize(size, size, { fit: 'fill' })
    .ensureAlpha()
    .png()
    .toBuffer();

  // Compute mean RGB of strongly-opaque pixels — used as the fallback fill.
  const { data, info } = await sharp(resized).raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const c = info.channels;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    const idx = i * c;
    const a = c >= 4 ? data[idx + 3] : 255;
    if (a > 200) {
      rSum += data[idx];
      gSum += data[idx + 1];
      bSum += data[idx + 2];
      count++;
    }
  }
  const fallback = count > 0
    ? { r: Math.round(rSum / count), g: Math.round(gSum / count), b: Math.round(bSum / count) }
    : { r: 100, g: 70, b: 40 };

  // Build a fill layer: solid mean color masked to silhouette.
  const silhouette = await svgToTransparentPng(svg, size);
  const fillLayer = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { ...fallback, alpha: 1 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // Composite AI result over the fill — AI wins where opaque, fill shows
  // through where AI was transparent. Final pass clips to silhouette again
  // for safety (in case the AI image extended past it before resize).
  return sharp(fillLayer)
    .composite([
      { input: resized, blend: 'over' },
      { input: silhouette, blend: 'dest-in' },
    ])
    .png()
    .toBuffer();
}

// Crop a transparent PNG to the tight bbox of its opaque pixels.
// Used so the returned image's pixel dimensions match the M's logical W:H
// aspect, letting the client display it at the exact same size as edit mode.
export async function cropToOpaqueBbox(
  png: Buffer,
  alphaThreshold = 8,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, c = info.channels;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * c;
    for (let x = 0; x < w; x++) {
      const a = data[row + x * c + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return { buffer: png, width: w, height: h };
  }
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const cropped = await sharp(png)
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .png()
    .toBuffer();
  return { buffer: cropped, width: cw, height: ch };
}
