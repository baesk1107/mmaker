function hslHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function randomColors(): { fg: string; bg: string } {
  const h = Math.floor(Math.random() * 360);
  const compl = (h + 180 + Math.floor(Math.random() * 80) - 40 + 360) % 360;
  const fg = hslHex(h, 55 + Math.random() * 30, 18 + Math.random() * 22);
  const bg = hslHex(compl, 25 + Math.random() * 35, 78 + Math.random() * 14);
  return { fg, bg };
}
