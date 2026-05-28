import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

// Server-only OpenAI client. Importing this module on the client will fail
// because OPENAI_API_KEY is unavailable there.
let _client: OpenAI | null = null;
function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set. Add it to .env.local or your Vercel project.');
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export interface EditImageInput {
  imagePng: Buffer;
  maskPng?: Buffer;
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  transparent?: boolean;
}

export interface EditImageResult {
  // Base64-encoded PNG returned by the API (gpt-image-1 always returns b64).
  b64: string;
}

export interface GenerateTextureInput {
  prompt: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
}

// Generate a shape-free material texture from a text prompt.
// Used by the texture-fill pipeline: the model produces a square texture sheet
// that we then mask into the user's exact SVG silhouette.
export async function generateTexture(input: GenerateTextureInput): Promise<EditImageResult> {
  const res = await client().images.generate({
    model: 'gpt-image-1',
    prompt: input.prompt,
    size: input.size ?? '1024x1024',
    n: 1,
    quality: input.quality ?? 'medium',
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI image generate returned no image data');
  }
  return { b64 };
}

export async function editImageWithPrompt(input: EditImageInput): Promise<EditImageResult> {
  const imageFile = await toFile(input.imagePng, 'shape.png', { type: 'image/png' });
  const maskFile = input.maskPng
    ? await toFile(input.maskPng, 'mask.png', { type: 'image/png' })
    : undefined;
  const transparent = input.transparent ?? true;
  const res = await client().images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    ...(maskFile ? { mask: maskFile } : {}),
    prompt: input.prompt,
    size: input.size ?? '1024x1024',
    n: 1,
    background: transparent ? 'transparent' : 'auto',
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('OpenAI image edit returned no image data');
  }
  return { b64 };
}
