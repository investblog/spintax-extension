// WCAG contrast of text over a translucent wash on a background — for picking highlight colours.
//   node scripts/contrast.mjs '#E7E9EE' '#181A1F' '#4DA3FF' 0.22   → ratio of text over (wash blended on bg)
const [text, bg, wash, alphaArg] = process.argv.slice(2);
const alpha = Number(alphaArg ?? 0);
const hex = (h) => {
  const s = h.replace('#', '');
  const n = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16));
};
const blend = (over, under, a) => over.map((c, i) => Math.round(c * a + under[i] * (1 - a)));
const lum = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const surface = wash ? blend(hex(wash), hex(bg), alpha) : hex(bg);
const r = ratio(hex(text), surface);
console.log(`text ${text} on ${wash ? `${wash}@${alpha} over ${bg}` : bg} = #${surface.map((c) => c.toString(16).padStart(2, '0')).join('')} → ${r.toFixed(2)}:1 ${r >= 4.5 ? 'AA ✓' : r >= 3 ? 'AA large only' : '✗'}`);
