import { glyphMask, fontStamp } from './download-bar.js';
// The small pixel font of the album panel (5 px tall, letters of different widths), shared with the playlist window.
export const FONT = {
    A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
    D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
    G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
    J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
    P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
    S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
    V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
    Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
    0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
    3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
    6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
    9: ['###', '#.#', '###', '..#', '##.'], ' ': ['..', '..', '..', '..', '..'], '.': ['.', '.', '.', '.', '#'],
    ',': ['.', '.', '.', '#', '#'], "'": ['#', '#', '.', '.', '.'], '!': ['#', '#', '#', '.', '#'], ':': ['.', '#', '.', '#', '.'],
    '?': ['##.', '..#', '.#.', '...', '.#.'], '-': ['...', '...', '###', '...', '...'], '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
    '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'], '/': ['..#', '..#', '.#.', '#..', '#..'],
    '+': ['...', '.#.', '###', '.#.', '...'], '"': ['#.#', '#.#', '...', '...', '...'], '#': ['#.#', '###', '#.#', '###', '#.#'],
    '$': ['.##', '##.', '.#.', '.##', '##.'], '*': ['#.#', '.#.', '#.#', '...', '...'], '_': ['...', '...', '...', '...', '###'],
  };

// a few more signs the playlist needs
Object.assign(FONT, {
  '[': ['##', '#.', '#.', '#.', '##'], ']': ['##', '.#', '.#', '.#', '##'], '<': ['..#', '.#.', '#..', '.#.', '..#'], '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '=': ['...', '###', '...', '###', '...'], ';': ['.', '#', '.', '#', '#'], '|': ['#', '#', '#', '#', '#'], '%': ['#.#', '..#', '.#.', '#..', '#.#'],
  '@': ['.##.', '#.##', '#.##', '#...', '.##.'], '·': ['.', '.', '#', '.', '.'], '•': ['...', '.#.', '###', '.#.', '...'],
  '▸': ['#..', '##.', '###', '##.', '#..'], '▾': ['.....', '#####', '.###.', '..#..', '.....'], '▴': ['.....', '..#..', '.###.', '#####', '.....'],
});

// ---------- the playlist's letters: a thin pixel font (the classic 5 x 7 one, strokes one pixel wide) ----------
// The album font above is 3 x 5 capitals, which had to be doubled to be readable in a list and came out chunky. This
// one has small letters too and reads well at its own size. Each sign is its columns as hex bytes, top pixel = bit 0.
const THIN_HEX = '0000000000 00005F0000 0007000700 147F147F14 242A7F2A12 2313086462 3649562050 0008070300 001C224100 0041221C00 2A1C7F1C2A 08083E0808 0080703000 0808080808 0000606000 2010080402 ' +
  '3E5149453E 00427F4000 7249494946 2141494D33 1814127F10 2745454539 3C4A494931 4121110907 3649494936 464949291E 0000140000 0040340000 0008142241 1414141414 0041221408 0201590906 ' +
  '3E415D594E 7C1211127C 7F49494936 3E41414122 7F4141413E 7F49494941 7F09090901 3E41415173 7F0808087F 00417F4100 2040413F01 7F08142241 7F40404040 7F021C027F 7F0408107F 3E4141413E ' +
  '7F09090906 3E4151215E 7F09192946 2649494932 03017F0103 3F4040403F 1F2040201F 3F4038403F 6314081463 0304780403 6159494D43 007F414141 0204081020 004141417F 0402010204 4040404040 ' +
  '0003070800 2054547840 7F28444438 3844444428 384444287F 3854545418 00087E0902 18A4A49C78 7F08040478 00447D4000 2040403D00 7F10284400 00417F4000 7C04780478 7C08040478 3844444438 ' +
  'FC18242418 18242418FC 7C08040408 4854545424 04043F4424 3C4040207C 1C2040201C 3C4030403C 4428102844 4C9090907C 4464544C44 0008364100 0000770000 0041360800 0201020402';
const THIN = {};
THIN_HEX.split(' ').forEach((h, k) => {
  let cols = h.match(/../g).map((x) => parseInt(x, 16));
  while (cols.length > 1 && !cols[0]) cols.shift();           // letters keep their own width
  while (cols.length > 1 && !cols[cols.length - 1]) cols.pop();
  THIN[String.fromCharCode(32 + k)] = k ? cols : [0, 0, 0];   // the space is three pixels
});
Object.assign(THIN, { '▸': [0x7F, 0x3E, 0x1C, 0x08], '▾': [0x04, 0x0C, 0x1C, 0x0C, 0x04], '▴': [0x10, 0x18, 0x1C, 0x18, 0x10], '•': [0x18, 0x3C, 0x3C, 0x18], '·': [0x08] });

// `pixelText` gives a small canvas with the text in one colour. Accents are dropped (the font has none). It returns
// null for text the font cannot write (other alphabets), so the caller can fall back to ordinary letters.
const cache = new Map();
export function pixelClean(text) {
  return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/\t/g, ' ');
}
// The playlist is written with the skin's own font, the one the player's song title uses (5 x 6 capitals), in the
// colour asked for. Until the skin's font is ready (or if a skin has none) the thin font above stands in.
function skinLine(clean, colour) {
  if (!glyphMask(32) && !glyphMask(97)) return undefined;
  const chars = [...clean.toLowerCase()];
  let letters = 0, missing = 0;
  const gl = chars.map((ch) => {
    const m = glyphMask(ch.charCodeAt(0)), word = /[\p{L}\p{N}]/u.test(ch);
    if (word) { letters++; if (!m) missing++; }
    return m || (word ? glyphMask(63) : (ch === ' ' ? glyphMask(32) : null));
  }).filter(Boolean);
  if (letters && missing / letters > 0.3) return null;
  const w = Math.max(1, gl.reduce((n, m) => n + m.w, 0)), h = Math.max(1, ...gl.map((m) => m.h));
  const src = document.createElement('canvas'); src.width = w; src.height = h;
  const g = src.getContext('2d');
  g.fillStyle = colour; g.fillRect(0, 0, 1, 1);
  const rgb = g.getImageData(0, 0, 1, 1).data; g.clearRect(0, 0, 1, 1);
  const id = g.createImageData(w, h);
  let x = 0;
  for (const m of gl) {
    for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) { const o = ((j * w) + x + i) * 4; id.data[o] = rgb[0]; id.data[o + 1] = rgb[1]; id.data[o + 2] = rgb[2]; id.data[o + 3] = m.a[j * m.w + i]; }
    x += m.w;
  }
  g.putImageData(id, 0, 0);
  return src;
}
function thinLine(clean, colour) {
  const chars = [...clean];
  let letters = 0, missing = 0;
  for (const ch of chars) { if (/[\p{L}\p{N}]/u.test(ch)) { letters++; if (!THIN[ch]) missing++; } }
  if (letters && missing / letters > 0.3) return null;
  const gl = chars.map((ch) => THIN[ch] || (/[\p{L}\p{N}]/u.test(ch) ? THIN['?'] : null)).filter(Boolean); // signs it does not know (emoji) are left out
  const w = Math.max(1, gl.reduce((n, g) => n + g.length + 1, 0) - 1);
  const src = document.createElement('canvas'); src.width = w; src.height = 8;
  const g = src.getContext('2d'); g.fillStyle = colour;
  let x = 0;
  for (const cols of gl) { cols.forEach((b, i) => { for (let j = 0; j < 8; j++) if (b & (1 << j)) g.fillRect(x + i, j, 1, 1); }); x += cols.length + 1; }
  return src;
}
export function pixelText(text, colour) {
  const clean = pixelClean(text).replace(/[\u25b8\u2022]/g, '*').replace(/\u00b7/g, '-').replace(/\u25be/g, '-').replace(/\u25b4/g, '+'); // signs the skin font has
  const key = fontStamp() + '|' + clean + '|' + colour;
  let src = cache.get(key);
  if (src === undefined) {
    src = skinLine(clean, colour);
    if (src === undefined) src = thinLine(pixelClean(text), colour);
    if (cache.size > 600) cache.clear();
    cache.set(key, src);
  }
  if (!src) return null;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  c.style.cssText = `display:inline-block;vertical-align:middle;width:${src.width}px;height:${src.height}px;image-rendering:pixelated;`;
  return c;
}
export { fontStamp };
// put `text` into `el` in the pixel font (or as ordinary text when the font cannot write it)
export function setPixel(el, text, colour) {
  const c = pixelText(text, colour);
  el.textContent = '';
  if (c) el.appendChild(c); else el.textContent = String(text == null ? '' : text);
  return c;
}
