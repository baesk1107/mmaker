export const ANIM_KEYS = ['w', 'r', 'v1', 'v2', 'v3', 's1', 's2', 's3', 'lenL', 'lenR', 'posR'] as const;
export type AnimKey = (typeof ANIM_KEYS)[number];

const easeLinear = (t: number) => t;
function easeOutSpring(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c1 = 1.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const ANIM_CFG: Record<AnimKey, { duration: number; ease: (t: number) => number }> = {
  w: { duration: 586, ease: easeOutSpring },
  r: { duration: 286, ease: easeLinear },
  v1: { duration: 520, ease: easeOutSpring },
  v2: { duration: 520, ease: easeOutSpring },
  v3: { duration: 520, ease: easeOutSpring },
  s1: { duration: 520, ease: easeOutSpring },
  s2: { duration: 520, ease: easeOutSpring },
  s3: { duration: 520, ease: easeOutSpring },
  lenL: { duration: 520, ease: easeOutSpring },
  lenR: { duration: 520, ease: easeOutSpring },
  posR: { duration: 520, ease: easeOutSpring },
};
