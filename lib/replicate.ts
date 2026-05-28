import Replicate from 'replicate';
import sharp from 'sharp';
import { svgToTransparentPng } from './image-processing';

// Server-only Replicate client. Used as the PRIMARY image generator —
// ControlNet conditioning enforces pixel-precise silhouette matching that
// gpt-image-1 (the fallback) cannot reliably deliver.

let _client: Replicate | null = null;
function client(): Replicate {
  if (_client) return _client;
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error('REPLICATE_API_TOKEN is not set. Add it to .env.local.');
  }
  _client = new Replicate({ auth: token });
  return _client;
}

export function isReplicateConfigured(): boolean {
  return !!process.env.REPLICATE_API_TOKEN;
}

// Some Replicate models are *image edit* models (Flux Kontext family) rather
// than ControlNet conditioning models. For those we need to feed a real
// pre-rendered photo of the M (with bevel hints) instead of a flat silhouette
// control map, and use natural-language instructional prompts.
export function getReplicateModelKind(): 'kontext' | 'inpainting' | 'controlnet' {
  const model = process.env.REPLICATE_MODEL ?? '';
  const baseName = model.split(':')[0];
  if (
    baseName === 'black-forest-labs/flux-kontext-pro' ||
    baseName === 'black-forest-labs/flux-kontext-max' ||
    baseName === 'black-forest-labs/flux-kontext-dev'
  ) {
    return 'kontext';
  }
  if (
    baseName === 'black-forest-labs/flux-fill-pro' ||
    baseName === 'black-forest-labs/flux-fill-dev' ||
    baseName === 'zsxkib/flux-dev-inpainting' ||
    baseName === 'lucataco/sdxl-inpainting' ||
    baseName === 'stability-ai/stable-diffusion-inpainting'
  ) {
    return 'inpainting';
  }
  return 'controlnet';
}

// Convert the user's SVG silhouette to a ControlNet-friendly control image.
// `mode`:
//   - 'filled'  → white-filled silhouette on black background. Used by models
//     that accept filled shape (e.g. lucataco/sdxl-controlnet).
//   - 'edge'    → thin white outline (canny-like edge map) on black background.
//     Used by HED / Canny / lineart ControlNet types that expect detected edges.
export async function svgToControlImage(
  svg: string,
  size = 1024,
  mode: 'filled' | 'edge' = 'filled',
): Promise<Buffer> {
  const silhouette = await svgToTransparentPng(svg, size);

  if (mode === 'edge') {
    // Produce a thin outline by subtracting an eroded copy from the silhouette.
    const ringPx = Math.max(2, Math.round(size * 0.003));
    const erodedSide = Math.max(1, size - ringPx * 2);
    const eroded = await sharp(silhouette)
      .resize(erodedSide, erodedSide, { fit: 'fill' })
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
    return await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite([{ input: ringAlpha, blend: 'dest-in' }])
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .png()
      .toBuffer();
  }

  return await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([{ input: silhouette, blend: 'dest-in' }])
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer();
}

// Kontext input image: flat user-color silhouette flattened onto a clean white
// background. Avoids feeding Kontext a heavy pre-rendered bevel (which it
// tends to reinterpret), while still giving it an unambiguous photo-like
// subject to edit.
export async function svgToKontextInput(svg: string, size = 1024): Promise<Buffer> {
  const silhouette = await svgToTransparentPng(svg, size);
  return await sharp(silhouette)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();
}

// Solid white PNG used as the "base image" for inpainting calls. The mask
// covers the entire M area so this base only shows through outside the
// silhouette — which we clip away in post-processing anyway.
export async function whiteBaseImage(size = 1024): Promise<Buffer> {
  return await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

export interface ControlNetInput {
  controlImagePng: Buffer;
  prompt: string;
  negativePrompt?: string;
  controlnetScale?: number; // 0.5–1.5; higher = silhouette enforced more strictly
  guidanceScale?: number;   // CFG; 5–10 typical
  steps?: number;           // diffusion steps; 25–40 typical
  width?: number;
  height?: number;
  // For inpainting models: white-on-black mask, white = region to fill.
  maskPng?: Buffer;
  // Bypass REPLICATE_MODEL env var. Used by the SDF→Kontext detail pass which
  // requires Kontext regardless of how the project's primary model is set.
  modelOverride?: string;
}

// Run SDXL ControlNet on Replicate. Returns the generated PNG as a Buffer.
// Model is overridable via REPLICATE_MODEL env var; the default is a stable
// SDXL+ControlNet model on Replicate.
export async function generateWithControlNet(
  input: ControlNetInput,
): Promise<Buffer> {
  const model = (input.modelOverride ??
    process.env.REPLICATE_MODEL ??
    'lucataco/sdxl-controlnet') as `${string}/${string}` | `${string}/${string}:${string}`;

  const dataUrl = `data:image/png;base64,${input.controlImagePng.toString('base64')}`;
  const maskDataUrl = input.maskPng
    ? `data:image/png;base64,${input.maskPng.toString('base64')}`
    : undefined;

  const modelInput = buildModelInput(model, dataUrl, input, maskDataUrl);
  let output: unknown;
  try {
    output = await client().run(model, { input: modelInput });
  } catch (err) {
    // Strip the Authorization header out of the error object before it bubbles
    // up — the Replicate SDK attaches the raw request (including Bearer token)
    // to ApiError, which would otherwise leak into server logs.
    throw sanitizeReplicateError(err);
  }

  return await fetchOutputAsBuffer(output);
}

// Different SDXL+ControlNet models on Replicate expect different input schemas.
// Branch on the model identifier so the user can swap models via env var
// without code changes for the common cases.
function buildModelInput(
  modelId: string,
  controlImageDataUrl: string,
  input: ControlNetInput,
  maskDataUrl?: string,
): Record<string, unknown> {
  const baseName = modelId.split(':')[0];
  const negative =
    input.negativePrompt ??
    'low quality, blurry, distorted shape, watermark, text, signature, frame, border, multiple objects, plastic toy, matte balloon, cgi render look, smooth featureless surface';
  const scale = input.controlnetScale ?? 1.0;
  const guidance = input.guidanceScale ?? 7.5;
  const steps = input.steps ?? 30;
  const width = input.width ?? 1024;
  const height = input.height ?? 1024;

  // black-forest-labs/flux-fill-* — official BFL inpainting model. The mask
  // enforces shape 100% (only the masked region is filled). Output keeps the
  // unmasked region of the input image untouched (we use a white-bg base).
  if (
    baseName === 'black-forest-labs/flux-fill-pro' ||
    baseName === 'black-forest-labs/flux-fill-dev'
  ) {
    if (!maskDataUrl) throw new Error('flux-fill requires a mask');
    return {
      prompt: input.prompt,
      image: controlImageDataUrl,
      mask: maskDataUrl,
      steps: input.steps ?? 50,
      guidance: input.guidanceScale ?? 60,
      output_format: 'png',
      // 6 = most permissive. BFL has aggressive NSFW filters that
      // false-positive on food terms like 'wet', 'sticky', 'poured', etc.
      safety_tolerance: 6,
      prompt_upsampling: false,
    };
  }

  // Community / SDXL inpainting models. Schema: image + mask + prompt; the
  // model only paints where the mask is white.
  if (
    baseName === 'zsxkib/flux-dev-inpainting' ||
    baseName === 'lucataco/sdxl-inpainting' ||
    baseName === 'stability-ai/stable-diffusion-inpainting'
  ) {
    if (!maskDataUrl) throw new Error('inpainting model requires a mask');
    return {
      prompt: input.prompt,
      image: controlImageDataUrl,
      mask: maskDataUrl,
      negative_prompt: negative,
      num_inference_steps: input.steps ?? 30,
      guidance_scale: input.guidanceScale ?? 7.5,
      strength: 1.0,
      width,
      height,
    };
  }

  // black-forest-labs/flux-kontext-* — instructional image-edit models.
  // The input image is treated as a real photo to edit, and `prompt` is a
  // natural-language instruction. No ControlNet / scale concept.
  if (
    baseName === 'black-forest-labs/flux-kontext-pro' ||
    baseName === 'black-forest-labs/flux-kontext-max' ||
    baseName === 'black-forest-labs/flux-kontext-dev'
  ) {
    return {
      prompt: input.prompt,
      input_image: controlImageDataUrl,
      aspect_ratio: 'match_input_image',
      output_format: 'png',
      safety_tolerance: 2,
      prompt_upsampling: false,
    };
  }

  // fofr/sdxl-multi-controlnet-lora and its photorealism sibling
  // fofr/realvisxl-v3-multi-controlnet-lora share the same API schema
  // (multi-channel ControlNet + LoRA slot, controlnet_N_image inputs).
  if (
    baseName === 'fofr/sdxl-multi-controlnet-lora' ||
    baseName === 'fofr/realvisxl-v3-multi-controlnet-lora'
  ) {
    return {
      prompt: input.prompt,
      negative_prompt: negative,
      // 'illusion' uses the input image's brightness as a creative shape guide
      // (the silhouette is "embedded" into the generated image). Works with a
      // filled silhouette on a contrasting background — best fit for our case
      // because we want chocolate texture INSIDE the shape, not an outline.
      controlnet_1: 'illusion',
      controlnet_1_image: controlImageDataUrl,
      controlnet_1_conditioning_scale: Math.min(scale, 0.9),
      controlnet_1_start: 0,
      controlnet_1_end: 1,
      guidance_scale: guidance,
      num_inference_steps: steps,
      width,
      height,
      sizing_strategy: 'width_height',
      lora_scale: 0.8,
      num_outputs: 1,
      scheduler: 'K_EULER',
    };
  }

  // jagilley/controlnet-canny — SD 1.5 ControlNet canny. Runs canny detector
  // internally on the input image, then generates via prompt. Native 512.
  if (baseName === 'jagilley/controlnet-canny') {
    return {
      image: controlImageDataUrl,
      prompt: input.prompt,
      n_prompt: negative,
      scale: guidance,
      ddim_steps: steps,
      image_resolution: '768',
      low_threshold: 100,
      high_threshold: 200,
      num_samples: '1',
      eta: 0,
    };
  }

  // Default: lucataco/sdxl-controlnet schema (image + condition_scale).
  return {
    image: controlImageDataUrl,
    prompt: input.prompt,
    negative_prompt: negative,
    condition_scale: Math.min(scale, 1.0),
    guidance_scale: guidance,
    num_inference_steps: steps,
    width,
    height,
  };
}

function sanitizeReplicateError(err: unknown): Error {
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    delete obj.request;
    delete obj.response;
  }
  return err instanceof Error ? err : new Error(String(err));
}

// Replicate SDK varies — output may be a URL string, array of strings, or a
// FileOutput object with .url() / .arrayBuffer(). Handle all cases.
async function fetchOutputAsBuffer(output: unknown): Promise<Buffer> {
  if (typeof output === 'string') {
    const res = await fetch(output);
    if (!res.ok) throw new Error(`Failed to fetch Replicate output: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (Array.isArray(output) && output.length > 0) {
    return fetchOutputAsBuffer(output[0]);
  }
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (typeof obj.arrayBuffer === 'function') {
      const ab = await (obj.arrayBuffer as () => Promise<ArrayBuffer>)();
      return Buffer.from(ab);
    }
    if (typeof obj.url === 'function') {
      const urlResult = (obj.url as () => unknown)();
      const urlString = urlResult instanceof URL ? urlResult.toString() : String(urlResult);
      const res = await fetch(urlString);
      if (!res.ok) throw new Error(`Failed to fetch Replicate output: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
    if (typeof obj.url === 'string') {
      const res = await fetch(obj.url);
      if (!res.ok) throw new Error(`Failed to fetch Replicate output: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    }
  }
  throw new Error('Unknown Replicate output format');
}
