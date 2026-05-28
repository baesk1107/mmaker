import { NextResponse } from 'next/server';
import { cropToOpaqueBbox, maskFromSvg, preprocessSvgToPng } from '@/lib/image-processing';
import { editImageWithPrompt } from '@/lib/openai';
import { buildEditPrompt } from '@/lib/prompts';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface GenerateBody {
  svg?: string;
  prompt?: string;
  color?: string;
  bg?: string;
  size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto';
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export async function POST(req: Request) {
  let body: GenerateBody;
  try {
    body = (await req.json()) as GenerateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.svg || typeof body.svg !== 'string') {
    return NextResponse.json({ error: 'svg is required' }, { status: 400 });
  }
  if (body.svg.length > 2_000_000) {
    return NextResponse.json({ error: 'svg too large' }, { status: 413 });
  }

  const color = body.color && HEX_COLOR.test(body.color) ? body.color : undefined;

  try {
    // gpt-image-1 edit: the silhouette mask locks the editable region and the
    // shape-lock prompt keeps the contour; the free-text prompt drives the look.
    const [imagePng, maskPng] = await Promise.all([
      preprocessSvgToPng(body.svg, { size: 1024, bevel: true }),
      maskFromSvg(body.svg, 1024),
    ]);
    const { b64 } = await editImageWithPrompt({
      imagePng,
      maskPng,
      prompt: buildEditPrompt(body.prompt, color),
      size: body.size ?? '1024x1024',
    });
    const { buffer: cropped, width, height } = await cropToOpaqueBbox(Buffer.from(b64, 'base64'));
    const dataUrl = `data:image/png;base64,${cropped.toString('base64')}`;
    return NextResponse.json({ imageUrl: dataUrl, width, height, backend: 'openai' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/generate] failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
