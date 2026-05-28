// Style prompt library for food typography on top of the user's M shape.
// The silhouette is treated as a HARD CONTOUR — a cast/molded 3D object
// with crisp beveled edges. Material details (gloss, bubbles, swirls) live
// strictly INSIDE the silhouette. Outside is clean knockout transparency.

export type StyleKey =
  | 'chocolate'
  | 'jelly'
  | 'caramel'
  | 'milk'
  | 'honey'
  | 'cream';

const SYSTEM_HEADER = `
ABSOLUTE PRIORITY — SHAPE FIDELITY OVER EVERYTHING ELSE.

You are texturizing a finished 3D solid object that is FULLY DRAWN in the input
image. The input image is the GROUND TRUTH for shape. Every contour, every
notch, every rounded corner, every flat segment, every leg width, every depth
of every V cut — these are ALREADY DECIDED and are NON-NEGOTIABLE. You must
reproduce the exact silhouette pixel-for-pixel.

Hard rules:
1. The silhouette outline of the OUTPUT must be IDENTICAL to the silhouette
   outline of the INPUT. Same proportions, same corner radii, same leg shapes,
   same notch positions, same widths and depths. Trace the input's outline.
2. Do NOT reinterpret the shape as a "letter M", "letter", or any standardized
   glyph. Do not "correct", "regularize", or "improve" the proportions.
   The input shape is the subject — render it as-is even if it looks unusual.
3. Fill the ENTIRE silhouette edge-to-edge with OPAQUE material. NO transparent
   pixels inside the silhouette. NO smaller centered shape. NO gaps. NO holes.
   Inside the silhouette must be 100% opaque material.
4. The bevel and specular highlight MUST run along the EXACT input silhouette
   outline — including every flat segment, every leg bottom, every V notch
   interior, every rounded corner. Wherever the silhouette has an edge, the
   bevel/highlight must follow that edge precisely. NO edge is left as a raw
   2D cut.
5. The accompanying mask defines the editable region. Do NOT paint, drip, melt,
   smear, smudge, soften, or extend beyond it. Do NOT spill material outside
   the silhouette.

Your ONLY creative latitude: choose the surface micro-texture of the requested
food material (gloss highlights, bubbles, swirls, droplets, micro-cracks) and
apply it INSIDE the locked silhouette while preserving the pre-rendered shading
structure (base color → material color, inner shadow band → darker material,
domed inner highlight → lighter material, perimeter specular ring → bright
material specular).
`.trim();

const EDGE_TREATMENT = `
EDGE_TREATMENT (critical, do not omit — applies to EVERY edge of the silhouette):
- The form is a fully cast / molded 3D solid. A rounded beveled edge wraps the
  ENTIRE perimeter without exception:
    • the top edge with its V dip
    • both vertical sides
    • the bottom flat segment of EACH leg foot (this is mandatory — flat bottoms
      must still be beveled, never left as a sliced 2D cut)
    • every inner V cut notch including its apex curve
    • every rounded outer corner
  NO edge anywhere on the input silhouette is left as a raw flat cut.
- The bright specular highlight (the input image already has a cream-colored
  ring along the inside of the silhouette boundary) traces along the bevel and
  MUST REMAIN CLEARLY VISIBLE in the output around the ENTIRE perimeter — top,
  sides, leg bottoms, V notches. The highlight follows the input outline; it
  must not migrate inward.
- A subtle darker shoulder sits just inside that highlight band, giving the
  bevel depth and thickness.
- Edges stay perfectly crisp AT the silhouette boundary itself — no fuzzy
  fall-off outside, no melted spillage, no haze. Only the bevel's gradient
  exists inside the silhouette.
- The bevel must read as a physically cast / molded 3D form, never as a 2D
  illustration or a sliced cross-section.
- If any edge of the input silhouette is straight or flat, render it as a
  3D beveled edge of a solid material (think: side of a cast chocolate bar) —
  NOT as a knife-cut flat surface.
`.trim();

const DECORATION_RULE = `
SURFACE_DETAILS (optional, restrained):
- Small in-material details may appear ON the surface or INSIDE translucent body:
  bubbles, droplets, embedded chunks, slow swirls, surface tension marks.
- They must NEVER cross or extend beyond the silhouette.
- Use 1–3 such details at most. Restraint reads as premium.
`.trim();

const MATERIAL: Record<StyleKey, string> = {
  chocolate: `
MATERIAL:
- Glossy dark Belgian chocolate body.
- Rich deep brown with warm caramel-amber highlights.
- Wet, freshly-poured chocolate sheen on the surface.
- Subtle lighter chocolate swirls visible on the upper face.
- The body itself is solid and beveled — no melt drips outside the silhouette.
`.trim(),

  jelly: `
MATERIAL:
- Translucent fruit jelly / gelatin body.
- Vibrant saturated color (lime green by default — tune via additional direction).
- Subsurface scattering: the body glows softly from within.
- Tiny air bubbles of varied size suspended inside the body.
- Wet glass-like exterior with crisp specular highlights running along the bevel.
- Light passes through the body where it is thinnest near edges.
`.trim(),

  caramel: `
MATERIAL:
- Glossy golden caramel body.
- Rich amber color, deep honey highlights, slightly darker pooling in concave areas.
- Sticky wet sheen with a thick viscous look — but the silhouette stays rigid.
- A single subtle pulled-sugar swirl line may trace across the surface.
`.trim(),

  milk: `
MATERIAL:
- Glossy whole-milk / white-chocolate body.
- Cool creamy off-white with soft satin highlights.
- A few small splash droplets may sit on the upper surface (still within silhouette).
- The body is solid and beveled, like a cast white-chocolate form.
`.trim(),

  honey: `
MATERIAL:
- Translucent golden honey body.
- Deep amber with rich light passing through the body.
- Slow internal swirl patterns visible through the translucent material.
- Tiny suspended bubbles inside.
- Crisp specular highlights along the bevel edge — sticky-glass look.
`.trim(),

  cream: `
MATERIAL:
- Soft whipped cream body with airy peaks captured as the surface micro-texture.
- Pure off-white with the faintest warm tint in shadows.
- Smooth glossy bevel highlight along the edges.
- A couple of small piped swirl marks may appear on the surface.
`.trim(),
};

const PHOTOGRAPHY = `
PHOTOGRAPHY:
- Studio macro food photography.
- Soft directional key light from upper-left, soft fill light from below-right.
- Frontal, perfectly centered, no perspective tilt.
- Hyper-realistic rendering, premium dessert advertisement aesthetic.
- Crisp specular highlights, accurate material physics.
`.trim();

const BACKGROUND_RULE = `
BACKGROUND:
- Fully transparent. The result must be a clean knockout PNG.
- No scene, no surface, no shadow plane, no surrounding spill of material.
- Anything outside the input silhouette must be empty transparency.
`.trim();

const SHAPE_LOCK = `
SHAPE_LOCK (non-negotiable):
- The exact outer contour of the input image is the final contour. Do not modify it.
- Preserve silhouette, proportions, corner radii, and bottom-V geometry exactly.
- The mask defines the editable region; outside the mask is preserved as transparent.
`.trim();

const NEGATIVE = `
NEVER:
- Distort, soften, melt, drip, smear, or extend the silhouette.
- Render any letterform, glyph, typographic character, or shape OTHER than the
  exact pre-rendered form supplied in the input image.
- Reinterpret or "correct" the input as a standardized letter — keep the input
  shape exactly as-is, even if it does not resemble a conventional letter.
- Produce a cartoon, illustration, vector, flat graphic, or 3D game asset look.
- Use a matte, plastic, ceramic, or hard-toy surface.
- Add background scenery, plates, surfaces, props, or shadow planes.
- Add melt pools, drips, or material spilling beyond the silhouette.
`.trim();

function colorDirective(hex: string): string {
  return `
COLOR_DIRECTIVE (overrides any default color named in MATERIAL):
- The body's dominant hue MUST be ${hex.toUpperCase()}.
- All highlights are brighter tints of ${hex.toUpperCase()}; all shadows are darker shades of the same hue.
- Do not shift the hue family — keep saturation high and stay within this color's family.
- Preserve the material's physical behavior (gloss, translucency, viscosity, surface texture), only the hue changes.
- If the requested color is unusual for this food, render it as a stylized/artisanal variant (e.g. green honey, blue chocolate) — keep the material believable.
`.trim();
}

function build(style: StyleKey, extra?: string, color?: string): string {
  const parts: string[] = [
    SYSTEM_HEADER,
    SHAPE_LOCK,
    EDGE_TREATMENT,
    MATERIAL[style],
  ];

  if (color) parts.push(colorDirective(color));

  parts.push(DECORATION_RULE, PHOTOGRAPHY, BACKGROUND_RULE, NEGATIVE);

  if (extra && extra.trim()) {
    parts.push(`ADDITIONAL_DIRECTION:\n${extra.trim()}`);
    parts.push(SHAPE_LOCK);
  }

  return parts.join('\n\n');
}

export const STYLE_PRESETS: Record<StyleKey, string> = Object.fromEntries(
  (Object.keys(MATERIAL) as StyleKey[]).map((k) => [k, build(k)]),
) as Record<StyleKey, string>;

export const STYLE_LABELS: Record<StyleKey, string> = {
  chocolate: 'Chocolate',
  jelly: 'Jelly',
  caramel: 'Caramel',
  milk: 'Milk',
  honey: 'Honey',
  cream: 'Cream',
};

export function buildPrompt(style: StyleKey, extra?: string, color?: string): string {
  return build(style, extra, color);
}

// ---------------------------------------------------------------------------
// gpt-image edit prompt (no style presets). The built-in prompt's entire job
// is to lock the shape; the free-text user prompt supplies all look/material.

const EDIT_SHAPE_LOCK = `
ABSOLUTE PRIORITY — PRESERVE THE EXACT SHAPE.
The input image is the GROUND TRUTH for shape. Reproduce its silhouette pixel-for-pixel:
every contour, notch, rounded corner, flat segment, leg width, and V-cut depth is already
decided and NON-NEGOTIABLE.

Hard rules:
1. The OUTPUT silhouette MUST be IDENTICAL to the INPUT silhouette — same proportions,
   corner radii, leg shapes, notch positions, widths, and depths. Trace the input outline.
2. Do NOT reinterpret the shape as a "letter M" or any standardized glyph. Do not correct,
   regularize, simplify, or "improve" the proportions. Render it exactly as-is, even if it
   looks unusual.
3. Fill the ENTIRE silhouette edge-to-edge with OPAQUE content — no transparent pixels,
   gaps, holes, or a smaller centered shape inside it.
4. The accompanying mask defines the editable region. Do NOT paint, melt, smear, soften, or
   extend beyond it. Everything outside the silhouette stays fully transparent.
5. Keep edges crisp exactly AT the silhouette boundary — no fuzzy fall-off, no spill, no halo.
`.trim();

const EDIT_NEGATIVE = `
NEVER:
- Distort, soften, melt, drip, smear, or extend the silhouette beyond the input outline.
- Render any letterform, glyph, or shape OTHER than the exact form supplied in the input.
- Reinterpret or "correct" the input into a standardized letter — keep it exactly as-is.
- Add background scenery, plates, surfaces, props, drop shadows, or shadow planes.
`.trim();

export function buildEditPrompt(extra?: string, color?: string): string {
  const direction = extra && extra.trim()
    ? extra.trim()
    : 'Render the shape as a clean, premium, photorealistic solid object with soft studio lighting.';
  const parts: string[] = [
    EDIT_SHAPE_LOCK,
    `STYLE / CONTENT DIRECTION (apply only INSIDE the locked silhouette):\n${direction}`,
  ];
  if (color) {
    parts.push(
      `COLOR: the dominant hue MUST be ${color.toUpperCase()}; highlights are brighter tints and shadows are darker shades of the same hue. Do not shift the hue family.`,
    );
  }
  parts.push(BACKGROUND_RULE, EDIT_NEGATIVE, EDIT_SHAPE_LOCK);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Texture-only prompts (no shape, no object boundary). Used by the hybrid
// pipeline that asks the model for a seamless material surface and then
// masks it into the user's SVG silhouette algorithmically.

const TEXTURE_MATERIAL: Record<StyleKey, string> = {
  chocolate: `Seamless top-down macro texture of dark Belgian chocolate surface. Rich deep brown body with visible lighter chocolate swirl patterns, fine cocoa-butter grain, scattered micro pitting and tiny bubble craters from cooled tempering, subtle marbling and color veining throughout. High micro-detail — this is a closeup of real cooled chocolate.`,
  jelly: `Seamless top-down macro texture of translucent fruit jelly. Vibrant saturated body with many tiny air bubbles of varying sizes suspended inside, faint internal color veining and slow swirl streaks, micro-detail of gelatin grain. High micro-detail throughout.`,
  caramel: `Seamless top-down macro texture of golden caramel surface. Rich amber body with slow pulled-sugar swirl lines, fine sugar-grain micro-texture, scattered tiny bubbles and viscous streak patterns. High micro-detail throughout.`,
  milk: `Seamless top-down macro texture of milk chocolate / white-chocolate surface. Creamy off-white body with subtle warm marbling, fine grain micro-texture, scattered tiny pitting and bubble craters. High micro-detail throughout.`,
  honey: `Seamless top-down macro texture of golden honey. Deep amber body with slow internal swirl streaks, many tiny suspended bubbles, faint color veining, thick viscous-looking micro-texture. High micro-detail throughout.`,
  cream: `Seamless top-down macro texture of whipped cream. Pure off-white body with airy peak micro-detail, small piped swirl marks, fine bubbly grain texture throughout. High micro-detail throughout.`,
};

const TEXTURE_SUFFIX = `
HARD CONSTRAINTS — this is a TEXTURE REFERENCE MAP, not a styled photograph:
- Surface MUST show rich intrinsic micro-detail: swirls, bubbles, pitting, grain,
  color veining, marbling. This is required — do not output a flat color sheet.
- Lighting on the texture MUST be perfectly even and diffuse, like a 3D-renderer
  albedo map. NO directional studio lighting. NO bright specular highlights,
  NO gloss reflection streaks, NO bright "hot spots" from camera flash, NO dark
  vignette in the corners, NO cast shadows from above or to the side.
- Color variation inside the material (lighter swirls, darker veins) is GOOD and
  required. What is forbidden is added light/shadow on top of that — bright spots
  from a key light or dark spots from shadow.
- The image fills the ENTIRE frame edge-to-edge with continuous material surface.
- NO letterform, NO glyph, NO text, NO logo, NO object boundary, NO border, NO frame.
- NO single subject — this is a continuous surface, not a 3D object.
- Top-down camera, no perspective tilt.
- Think: a flat-lit reference photograph of a slab of the material, OR a high-
  resolution 3D albedo / diffuse texture map.
`.trim();

function textureColorDirective(hex: string): string {
  return `
COLOR_DIRECTIVE:
- The dominant hue is ${hex.toUpperCase()}.
- All highlights are brighter tints of ${hex.toUpperCase()}; all shadows are darker shades.
- Do not shift the hue family. Keep saturation high. Stay within this color's family.
- The material's physical behavior (gloss, translucency, viscosity, micro-texture) is preserved; only the hue changes.
`.trim();
}

export function buildTexturePrompt(
  style: StyleKey,
  extra?: string,
  color?: string,
): string {
  const parts: string[] = [TEXTURE_MATERIAL[style]];
  if (color) parts.push(textureColorDirective(color));
  if (extra && extra.trim()) parts.push(`ADDITIONAL_DIRECTION:\n${extra.trim()}`);
  parts.push(TEXTURE_SUFFIX);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// ControlNet-tailored prompts. SDXL+ControlNet works best with descriptive,
// comma-separated tag-style prompts (not long structured paragraphs), because
// the model's shape fidelity comes from the control image — the text prompt
// just describes the material and rendering style.

const CONTROLNET_MATERIAL: Record<StyleKey, string> = {
  chocolate: 'glossy melted Belgian dark chocolate, rich deep brown body, warm caramel-amber specular highlights, wet freshly poured sheen, subtle lighter chocolate swirls',
  jelly: 'translucent fruit jelly gelatin body, vibrant saturated color, subsurface scattering glow, tiny air bubbles suspended inside, wet glass-like exterior, crisp light passing through edges',
  caramel: 'glossy golden caramel body, rich amber color, deep honey highlights, slightly darker pooling in concave areas, sticky thick viscous sheen, subtle pulled-sugar swirl',
  milk: 'glossy whole milk and white chocolate body, cool creamy off-white, soft satin highlights, small splash droplets on top surface',
  honey: 'translucent golden honey body, deep amber, light passing through, slow internal swirl patterns, tiny suspended bubbles, sticky glass-like surface with crisp specular highlights',
  cream: 'soft whipped cream body with airy peaks micro-texture, pure off-white with faintest warm tint in shadows, smooth glossy bevel highlight, small piped swirl marks',
};

const CONTROLNET_BASE = [
  '3D cast solid object',
  'rounded beveled edges wrapping the entire perimeter',
  'bright continuous specular highlight along the bevel',
  'hyper-realistic studio macro food photography',
  'premium dessert advertisement aesthetic',
  'soft directional key light from upper left',
  'crisp edges, no soft fall-off',
  'no melt drips outside the silhouette',
  'pure white background, isolated single subject',
  'shot on Hasselblad medium format',
  'ultra sharp focus, 8K resolution, intricate surface detail',
  'professional color grading, advertising-grade lighting',
  'glossy material with accurate physics, sub-pixel surface detail',
].join(', ');

function controlNetColorTag(hex: string): string {
  return `dominant color ${hex.toUpperCase()}, all highlights are brighter tints of ${hex.toUpperCase()}, all shadows are darker shades of the same hue`;
}

// ---------------------------------------------------------------------------
// Flux Kontext prompts. Kontext is an instructional image-edit model that
// works best with short, natural-language edit instructions (not long
// structured rule sheets like gpt-image-1 accepts). Strong shape-lock
// language still helps because the model's default behavior is to
// "regularize" letterforms.

const KONTEXT_MATERIAL: Record<StyleKey, string> = {
  chocolate: 'glossy melted Belgian dark chocolate, rich deep brown body, warm caramel-amber specular highlights, freshly poured sheen, subtle lighter chocolate swirls on the surface',
  jelly: 'translucent fruit jelly / gelatin body with subsurface glow, tiny air bubbles suspended inside, wet glass-like exterior, light passing through the edges',
  caramel: 'glossy golden caramel body, rich amber with deep honey highlights, sticky thick viscous sheen, a single subtle pulled-sugar swirl across the top',
  milk: 'glossy whole-milk and white-chocolate body, cool creamy off-white, soft satin highlights, a couple of small splash droplets on the upper surface',
  honey: 'translucent golden honey body, deep amber, light passing through, slow internal swirl patterns, tiny suspended bubbles, sticky-glass surface',
  cream: 'soft whipped cream body with airy peak micro-texture on the surface, pure off-white with the faintest warm tint in shadows, small piped swirl marks',
};

// Inpainting prompt: shape is enforced 100% by the mask, so the prompt can be
// pure material description. Bevel/edge concerns are de-prioritized — just
// describe the material truthfully and let the model render it.
export function buildInpaintingPrompt(
  style: StyleKey,
  extra?: string,
  color?: string,
): string {
  const material = KONTEXT_MATERIAL[style];
  const colorClause = color
    ? ` The dominant hue is ${color.toUpperCase()}; highlights are brighter tints and shadows are darker shades of the same hue. Material physics (gloss, translucency, viscosity, micro-texture) stays the same, only the hue changes.`
    : '';
  const extraClause = extra && extra.trim() ? ` ${extra.trim()}` : '';

  return [
    `Fill the masked area with ${material}.`,
    `Hyper-realistic studio macro food photography, premium dessert advertisement aesthetic, soft directional key light from the upper-left, crisp specular highlights, accurate material physics, sub-pixel surface detail.`,
    `Pure white background outside the masked region; no scene, no props, no shadows.${colorClause}${extraClause}`,
  ].join(' ');
}

export function buildKontextPrompt(
  style: StyleKey,
  extra?: string,
  color?: string,
): string {
  const material = KONTEXT_MATERIAL[style];
  const colorClause = color
    ? ` The dominant hue is ${color.toUpperCase()}; highlights are brighter tints of the same hue and shadows are darker shades. Keep the material's physical behavior intact, only the hue changes.`
    : '';
  const extraClause = extra && extra.trim() ? ` ${extra.trim()}` : '';

  return [
    `Render the exact silhouette shown in the input image as a 3D cast solid object made of ${material}.`,
    `CRITICAL: the outline / silhouette / proportions of the input shape are the SUBJECT and must be preserved PIXEL-FOR-PIXEL. Do NOT redraw, regularize, or replace it with a standard letter M, alphabet glyph, or any other letterform — keep every notch, leg width, flat segment, corner radius, and bottom V exactly as in the input.`,
    `Add rounded beveled edges wrapping the entire perimeter with a continuous bright specular highlight tracing the bevel. The body inside the silhouette is 100% opaque material — no gaps, no smaller centered shape.`,
    `Studio macro food photography, hyper-realistic, premium dessert advertisement, soft directional key light from upper-left, crisp specular highlights, accurate material physics, isolated single subject on a pure white background, no shadows, no scene, no props.${colorClause}${extraClause}`,
  ].join(' ');
}

export function buildControlNetPrompt(
  style: StyleKey,
  extra?: string,
  color?: string,
): string {
  const parts: string[] = [CONTROLNET_MATERIAL[style], CONTROLNET_BASE];
  if (color) parts.push(controlNetColorTag(color));
  if (extra && extra.trim()) parts.push(extra.trim());
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Stage-2 detail pass. Input is the SDF procedural render (already has the
// correct shape + lighting). Kontext should only add micro-surface realism on
// top — NOT re-light, NOT re-shape.

const DETAIL_MATERIAL: Record<StyleKey, string> = {
  chocolate: 'solid Belgian dark chocolate with a softly rounded, melted-looking glossy finish; mirror-smooth surface; internal lighter chocolate marbling and swirl color veining; thick viscous-looking body that is fully set and not moving',
  jelly: 'solid translucent fruit jelly with a smooth glass-like glossy exterior; tiny suspended air bubbles inside; internal swirl color streaks; soft subsurface glow; fully set, not moving',
  caramel: 'solid amber caramel with a softly rounded, melted-looking glossy finish; mirror-smooth surface; deep amber internal swirl streaks; thick viscous-looking body that is fully set and not moving',
  milk: 'solid white chocolate with a softly rounded, melted-looking glossy finish; mirror-smooth surface; soft milky internal swirls and color veining; thick viscous-looking body that is fully set and not moving',
  honey: 'solid translucent honey-amber body with a smooth glass-like glossy exterior; internal swirl color streaks; suspended fine bubbles; soft subsurface glow; fully set, not moving',
  cream: 'solid glossy cream-glaze finish with a smooth thick mirror-shiny surface; soft swirl ribbons inside; fully set, not moving',
};

export function buildDetailPassPrompt(
  style: StyleKey,
  extra?: string,
  color?: string,
  bg?: string,
): string {
  const material = DETAIL_MATERIAL[style];
  const colorClause = color
    ? ` Keep the dominant hue ${color.toUpperCase()} — highlights stay brighter tints and shadows stay darker shades of the same hue.`
    : '';
  const bgClause = bg
    ? ` The background is a perfectly uniform, completely flat solid color of ${bg.toUpperCase()} — exactly that hue, edge to edge, with no gradient, no vignette, no texture, no cast shadows, no drop shadows, no halo, no soft glow.`
    : ` The background is a perfectly uniform flat solid color — no gradient, no vignette, no texture, no cast shadows, no drop shadows, no halo, no soft glow.`;
  const extraClause = extra && extra.trim() ? ` ${extra.trim()}` : '';
  return [
    `Convert this 3D-rendered shape into a hyper-realistic photograph of ${material}.`,
    `CRITICAL: preserve the EXACT silhouette, outline, bevel geometry, every highlight position, and every shadow position of the SUBJECT from the input. They must remain pixel-identical. Do NOT redraw, regularize, soften, or replace the shape. The lighting structure on the subject (where it's bright, where it's dark) must stay identical to the input.`,
    `Only enhance the SUBJECT surface: add fine micro-texture, sub-pixel material detail, realistic photographic noise, and accurate material physics on top of the existing illumination. Do not introduce new light sources or new shadows on the subject.`,
    `Studio macro food photography, premium dessert advertisement aesthetic, isolated single subject.${bgClause}${colorClause}${extraClause}`,
  ].join(' ');
}

// Photoreal prompt for the SDF-as-shape-guide pipeline. The input image is a
// minimal flat-color silhouette with a thin inner shadow rim — the AI does
// everything else (material, lighting, gloss, marbling, depth). All materials
// are pushed toward a molten + glassy character regardless of style.
export function buildPhotorealPrompt(
  style: StyleKey,
  extra?: string,
  color?: string,
): string {
  const material = DETAIL_MATERIAL[style];
  const colorClause = color
    ? ` Stay in the ${color.toUpperCase()} color family — lighter tints for highlights, darker shades for shadows, never shift hue.`
    : '';
  const extraClause = extra && extra.trim() ? ` ${extra.trim()}` : '';

  return [
    `Render this shape as a hyper-realistic studio photograph of freshly-poured molten ${material}.`,

    // Shape preservation — repeated in three different framings so the model
    // cannot interpret the instruction loosely.
    `SHAPE LOCK (highest priority): the flat-color silhouette in the input image is the EXACT, FINAL outline of the subject. You MUST trace it pixel-for-pixel. Preserve every notch, every V cut, every leg, every rounded corner, every flat segment, every concave curve, every convex curve EXACTLY as shown. DO NOT redraw the silhouette. DO NOT regularize it into a standard letter M or any other glyph. DO NOT smooth, round, expand, contract, simplify, or stylize the contour. DO NOT add geometry that is not in the input. DO NOT remove geometry that is in the input. The output silhouette must overlay the input silhouette with zero pixel offset. The thin inner darkening band along the boundary in the input marks the beveled rim of the 3D molded piece — render that bevel as a real glossy chocolate-thick edge along the exact same outline.`,

    // Universal melted + glassy material direction. Avoid "wet" language —
    // models interpret it as "covered in water droplets" which we never want.
    `MATERIAL CHARACTER: the entire body is gently MELTED and slowly flowing — a thick viscous molten substance with a smooth glossy mirror-finish surface. The whole interior is uniformly molten material, NOT a solid coated in liquid. The glaze catches the light as a polished smooth highlight. Add visible pour-direction marbling and swirl flow inside the body, scattered fine internal bubbles, sub-pixel surface noise, color veining. Push the look toward "glossy melted glass" — molten, deep, reflective, viscous, smooth.`,
    `NO WATER DROPLETS anywhere. NO beads of water, NO condensation, NO splashes, NO water spots, NO liquid pooled on top. The body itself is the melted material — no separate liquid layer or droplets resting on top.`,

    // Lighting — fixed upper-left, no other sources.
    `LIGHTING: a single soft directional studio softbox from the upper-left (above-front-left of the subject). This is the ONLY light source. It produces a broad smooth highlight across the upper-left half of the form, gradually fading to gentle darker shading on the lower-right. A glossy mirror-smooth specular catches the bevel edge along the top and left contour. A subtle side-wall shadow band sits inside the silhouette where the bevel rolls down toward the boundary. NO secondary light from the right, NO backlight, NO under-light, NO rim light from any other direction. Lighting direction does not change between renders.`,

    // Camera — fixed frontal.
    `CAMERA: dead-on frontal angle, perfectly perpendicular to the front face of the subject. NO perspective foreshortening, NO three-quarter view, NO top-down tilt, NO isometric angle, NO side angle, NO rotation. The subject sits perfectly centered and upright in the frame.`,

    // Background — fixed white.
    `BACKGROUND: perfectly flat solid pure white (#FFFFFF), edge to edge, identical across the entire frame. NO gradient, NO vignette, NO drop shadow, NO cast shadow, NO halo, NO soft glow, NO scene, NO props, NO surface plane.`,

    `Studio macro food photography, premium dessert advertisement aesthetic, isolated single subject, sharp focus, high dynamic range, 4K resolution.${colorClause}${extraClause}`,
  ].join(' ');
}
