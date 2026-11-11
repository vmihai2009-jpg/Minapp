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

// The same letters for the playlist window: `pixelText` gives a small canvas with the text in one colour, every font
// pixel drawn `sc` x `sc`. Accents are dropped and letters are capitals (the font has no small letters). It returns
// null for text the font cannot write (other alphabets), so the caller can fall back to ordinary letters.
const cache = new Map();
export function pixelClean(text) {
  return String(text == null ? '' : text).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[‘’´`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '..').replace(/\t/g, ' ');
}
export function pixelText(text, colour, sc = 2) {
  const clean = pixelClean(text);
  const key = clean + '|' + colour + '|' + sc;
  let src = cache.get(key);
  if (src === undefined) {
    const chars = [...clean];
    let letters = 0, missing = 0;
    for (const ch of chars) { if (/\s/.test(ch)) continue; if (/[\p{L}\p{N}]/u.test(ch)) { letters++; if (!FONT[ch]) missing++; } }
    if (letters && missing / letters > 0.3) src = null;
    else {
      const gl = chars.map((ch) => FONT[ch] || (/[\p{L}\p{N}]/u.test(ch) ? FONT['?'] : null)).filter(Boolean); // signs it does not know (emoji) are left out
      const w = Math.max(1, gl.reduce((n, g) => n + g[0].length + 1, 0) - 1);
      src = document.createElement('canvas'); src.width = w * sc; src.height = 5 * sc;
      const g = src.getContext('2d'); g.fillStyle = colour;
      let x = 0;
      for (const one of gl) { one.forEach((row, j) => [...row].forEach((c, i) => { if (c === '#') g.fillRect((x + i) * sc, j * sc, sc, sc); })); x += one[0].length + 1; }
    }
    if (cache.size > 600) cache.clear();
    cache.set(key, src);
  }
  if (!src) return null;
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  c.style.cssText = `display:inline-block;vertical-align:middle;width:${src.width}px;height:${src.height}px;image-rendering:pixelated;`;
  return c;
}
// put `text` into `el` in the pixel font (or as ordinary text when the font cannot write it)
export function setPixel(el, text, colour, sc = 2) {
  const c = pixelText(text, colour, sc);
  el.textContent = '';
  if (c) el.appendChild(c); else el.textContent = String(text == null ? '' : text);
  return c;
}
