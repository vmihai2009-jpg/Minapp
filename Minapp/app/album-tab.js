// Album panel: what is playing (Spotify album cover, YouTube thumbnail) shown as a physical object, in a panel attached
// to the left of the player like Milkdrop is attached to the right. The panel is framed and coloured like Minapp's
// other panels (the skin's playlist colours and bevel). The album name is written in a small pixel font drawn here.
// Three looks, drawn as 1-pixel pixel art like the skin, with the cover itself on a 32 x 32 grid:
//  - case: a see-through plastic case with the source's logo, tinted with a gradient in the cover's colours, name in white
//  - tape: a cassette filling the panel, the cover as its label, the name in black on a paper strip; the reels turn
//  - cd:   a disc with the cover printed on it; it can turn slowly, in pixel steps, while music plays
// Click the song title or the timer to show or hide it; click the panel to go to the next look. The menu has the same
// choices under Album picture, plus "Spin the CD" (off by default: the CD then stays still and upright).
const W = 96, H = 116;          // the panel: as tall as the player
const ART_H = 90;               // the drawing; the name goes underneath
const COVER = 32, LEVELS = 8;   // the cover's pixel grid and palette
const LOOK_ORDER = ['case', 'tape', 'cd'];

export function initAlbumTab(webamp, api, getWidgetMode) {
  let open = false, tab = null, canvas = null, url = null, token = 0, img = null, look = 'case';
  let spin = false, spinStep = 0, loading = false, dots = 0, dotTimer = null, stripe = 0, noCover = false, giveUp = null, stopped = true;
  let playing = false, frame = 0, lastSrc = '', timer = null, albumName = '', grid = null, skinKey = '';
  try {
    open = localStorage.getItem('minapp.albumTab') === '1';
    const l = localStorage.getItem('minapp.albumStyle'); if (LOOK_ORDER.includes(l)) look = l;
    spin = localStorage.getItem('minapp.albumSpin') === '1';
  } catch {}
  const source = () => document.documentElement.dataset.source || 'spotify';
  const skin = () => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } };

  function frameStyle() {
    const st = skin(), bg = st.normalbg || '#000';
    tab.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;box-sizing:border-box;z-index:40;background:${bg};` +
      'border:1px solid;border-color:rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);' +
      `box-shadow:inset 0 0 0 1px ${bg},inset 0 0 0 2px rgba(0,0,0,.45);user-select:none;cursor:pointer;` + (open ? '' : 'display:none;');
    skinKey = bg;
  }
  function ensure() {
    if (tab) return;
    tab = document.createElement('div');
    tab.id = 'album-tab';
    canvas = document.createElement('canvas');
    canvas.width = W - 2; canvas.height = H - 2;
    canvas.style.cssText = `position:absolute;left:0;top:0;width:${W - 2}px;height:${H - 2}px;image-rendering:pixelated;`;
    tab.append(canvas);
    tab.title = 'Click to change the look: case, cassette, CD (click the song title to hide it)';
    tab.addEventListener('mousedown', (e) => e.stopPropagation());
    tab.addEventListener('click', () => {
      look = LOOK_ORDER[(LOOK_ORDER.indexOf(look) + 1) % LOOK_ORDER.length];
      try { localStorage.setItem('minapp.albumStyle', look); } catch {}
      if (timer) { clearInterval(timer); timer = null; }
      draw(); animate(); api.albumState({ look, spin, open });
    });
    (document.getElementById('webamp') || document.body).appendChild(tab);
    frameStyle(); draw();
    setInterval(() => { if (open && skin().normalbg && skin().normalbg !== skinKey) { frameStyle(); draw(); } }, 2000); // skin changed
  }

  // ---------- drawing helpers ----------
  let g = null;
  const P = (x, y, c, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const bitmap = (rows, x, y, map) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (map[ch]) P(x + i, y + j, map[ch]); }));
  const box = (x, y, w, h, c) => { P(x, y, c, w, 1); P(x, y + h - 1, c, w, 1); P(x, y, c, 1, h); P(x + w - 1, y, c, 1, h); };
  // the cover reduced to a small pixel grid with a slightly smaller palette (cached per picture and shape)
  function coverGrid(w, h) {
    const key = w + 'x' + h;
    if (!img) { // no picture (yet): dark, with faint diagonal stripes that slide while loading (words go on top per look)
      const c = document.createElement('canvas'); c.width = w; c.height = h; const cg = c.getContext('2d');
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { cg.fillStyle = (((x - stripe + y) % 6) + 6) % 6 < 1 ? '#2a2a3a' : (y < h / 2 ? '#1f1f2c' : '#1a1a25'); cg.fillRect(x, y, 1, 1); }
      return c;
    }
    if (grid && grid.key === key && grid.img === img) return grid.c;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cg = c.getContext('2d', { willReadFrequently: true });
    {
      const s = Math.min(img.naturalWidth, img.naturalHeight * w / h), sh = s * h / w; // centre crop to the wanted shape
      cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = 'high';
      cg.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - sh) / 2, s, sh, 0, 0, w, h);
      const d = cg.getImageData(0, 0, w, h), p = d.data, q = 255 / (LEVELS - 1);
      for (let i = 0; i < p.length; i += 4) for (let k = 0; k < 3; k++) p[i + k] = Math.round(p[i + k] / q) * q;
      cg.putImageData(d, 0, 0);
    }
    grid = { key, img, c };
    return c;
  }
  // the cover grid drawn with every grid pixel as a 2 x 2 block
  function cover(x, y, w, h) { g.imageSmoothingEnabled = false; g.drawImage(coverGrid(w / 2, h / 2), x, y, w, h); }

  // ---------- a small pixel font (5 px tall, letters of different widths), so the name can be any colour ----------
  const FONT = {
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
  const glyph = (ch) => FONT[ch] || FONT['?'];
  const textW = (t) => [...t].reduce((n, ch) => n + glyph(ch)[0].length + 1, 0) - 1;
  let textLift = null; // optional: how far up letters move at a given x (the turned box)
  function text(t, cx, y, c, shadow, sc = 1) { // centred on cx; sc = 2 draws every font pixel as 2 x 2
    let x = Math.round(cx - textW(t) * sc / 2);
    const put = (gl, ox, oy, col) => gl.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') P(ox + i * sc, oy + j * sc, col, sc, sc); }));
    for (const ch of t) {
      const gl = glyph(ch), gy = y + (textLift ? textLift(x + gl[0].length * sc / 2) : 0); // whole letters follow a slope
      if (shadow) put(gl, x, gy + 1, shadow); put(gl, x, gy, c); x += (gl[0].length + 1) * sc;
    }
  }
  // the album name split into up to `max` lines that fit `width` pixels; shortened with ".." when it is too long
  function nameLines(width, max, full) {
    const clean = String(albumName || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').filter(Boolean), ls = [];
    const cut = (w) => { while (w.length > 1 && textW(w + '..') > width) w = w.slice(0, -1); return w.trimEnd() + '..'; };
    let cur = '';
    for (let i = 0; i < words.length; i++) {
      const wd = textW(words[i]) > width ? cut(words[i]) : words[i];
      const next = cur ? cur + ' ' + wd : wd;
      if (textW(next) <= width) { cur = next; continue; }
      ls.push(cur); cur = wd;
      if (ls.length === max) { cur = ''; const rest = ls[max - 1] + ' ' + words.slice(i).join(' '); ls[max - 1] = textW(rest) <= width ? rest : cut(rest); break; }
    }
    if (cur && ls.length < max) ls.push(cur);
    if (full) return { ls, fits: !ls.some((l) => l.endsWith('..')) && ls.join(' ').length >= clean.length };
    return ls;
  }
  function writeName(cx, top, width, max, c, shadow, lh = 7) {
    const ls = nameLines(width, max);
    ls.forEach((t, j) => text(t, cx, top + j * lh, c, shadow));
  }

  // "LOADING..." with the dots counting up while the picture is on its way
  function loadingText(cx, y, c, shadow) {
    if (img) return false;
    if (!loading) { if (!noCover) return false; text('NO COVER', cx, y, c, shadow); return true; }
    const base = 'LOADING', dw = textW('...'), x0 = Math.round(cx - (textW(base) + 1 + dw) / 2);
    text(base, x0 + textW(base) / 2, y, c, shadow);
    for (let k = 0; k < 3; k++) if (k < dots) text('.', x0 + textW(base) + 1 + k * 2, y, c, shadow);
    return true;
  }

  // ---------- a stepped, dithered gradient in the cover's own colours (pixel-art style, no smooth blend) ----------
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  function coverColours() { // average colour of the cover's top and bottom thirds
    const c = coverGrid(COVER, COVER), d = c.getContext('2d').getImageData(0, 0, COVER, COVER).data;
    const avg = (y0, y1) => { const a = [0, 0, 0]; let n = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < COVER; x++) { const o = (y * COVER + x) * 4; a[0] += d[o]; a[1] += d[o + 1]; a[2] += d[o + 2]; n++; } return a.map((v) => v / n); };
    return [avg(0, 11), avg(21, 32)];
  }
  function gradient(x, y, w, h, top, bottom) {
    const steps = 6, mix = (t) => `rgb(${top.map((v, k) => Math.round(v + (bottom[k] - v) * t)).join(',')})`;
    const cols = Array.from({ length: steps }, (_, k) => mix(k / (steps - 1)));
    for (let j = 0; j < h; j++) {
      const s = (j / Math.max(1, h - 1)) * (steps - 1), b = Math.floor(s), f = s - b;
      for (let i = 0; i < w; i++) P(x + i, y + j, cols[Math.min(steps - 1, b + (f * 16 > BAYER[j & 3][i & 3] ? 1 : 0))]);
    }
  }
  const shade = (c, k) => c.map((v) => v * k);
  const mixc = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  // the main window's own colour (average of the skin's main bitmap), so the panel's background matches the player
  let tone = [44, 44, 62], toneKey = null;
  function skinTone() {
    let imgs = null; try { imgs = webamp.store.getState().display.skinImages; } catch {}
    if (!imgs || imgs === toneKey) return tone;
    toneKey = imgs;
    const src = imgs.MAIN_WINDOW_BACKGROUND; if (!src) return tone;
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = 24; c.height = 10;
      const cg = c.getContext('2d', { willReadFrequently: true }); cg.drawImage(im, 0, 0, 24, 10);
      const d = cg.getImageData(0, 0, 24, 10).data, a = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; }
      tone = a.map((v) => v / (d.length / 4)); if (open) draw();
    };
    im.src = src;
    return tone;
  }

  const LOGO = {
    spotify: ['..#####..', '.#######.', '#ddddddd#', '#d#####d#', '##ddddd##', '##d###d##', '###ddd###', '.#######.', '..#####..'],
    youtube: ['.rrrrrrrrr.', 'rrrrwrrrrrr', 'rrrrwwrrrrr', 'rrrrwwwrrrr', 'rrrrwwrrrrr', 'rrrrwrrrrrr', '.rrrrrrrrr.'],
    note: ['...####', '...#..#', '...#..#', '...#..#', '.###.##', '####.##', '.##....'],
  };
  function logo(x, y) {
    const src = source();
    if (src === 'youtube') bitmap(LOGO.youtube, x, y + 1, { r: '#e5322d', w: '#ffffff' });
    else if (src === 'spotify') bitmap(LOGO.spotify, x, y, { '#': '#f4f4f4', d: '#15151c' });
    else bitmap(LOGO.note, x, y, { '#': '#e8e8e8' });
  }

  // ---------- case: the clear cassette box from Mihai's reference picture. Its plastic frame is that picture, traced at
  // 74 x 110 (white edges, see-through elsewhere so the panel shows through); the card inside is drawn here ----------
  const CASE = { x: 10, y: 2, w: 74, h: 110 };
  // the card's place inside the traced frame. The box is turned a little, so the card is not a plain rectangle: its
  // right side sits RISE px higher and SHRINK px shorter than its left side, measured on the reference picture
  const CARD = { x: 9, y: 11, w: 61, h: 89, rise: 2, shrink: 1 };
  const FRAME_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEoAAABuCAYAAACA7YVRAAAEHElEQVR4nO2dS3LrOAxFb7pSHnvg/QS9slZW1vB+PPDYox5EjGEEIKGXWE/qd0+Viz+QhK6p/4cAKfHiM66X2z8ApvVdAQDoHMoC+yW2llE9PZ4Of7fEg1CBSL5x30lWntVp9orY0SXtRe1nVNsVF58AvB9PB7y2XCOSukpZJ+LKes5MxkZNPOPcIsfTAdfLrWMKAHhL2hMTz/prfdk2xIRyvdymFwC4Xm7WKGrQ500mP3PAIrgLW7H/CSTIq/YtLvwU6l9npM5QXXnUeZaf1fsOlba1U7akDwEwvQYFUee9zrIyn+/bz8p6dj+JLDFuQqnJs3EZ5Gf1RnjbMz62EVtA8LizUQDyGtveDRBvVwTfw9ZXfIhUabP5IS79k0ymD0UglO1UsBxbR5N4j6qd3SOee4bVdiKul9uDP70R1ZA5VNz3Xi2NIG7T5+PpUOhiMd8RaAnaIpFQ4o3MEer7szzaIGoTfwUG4oynp7myIyKhSEAklK7txB7giCpCoYpQqCIUqgiFKkKhimRC6ZpO7AF/CrPWOdTu4KpXhEIVoVBFKFQRClVDR0IJfvY2027pCSVrObEHvFBbuWW0NSQbUbKmFxvnDPRXvWkdP/ZBdnNBUHvq5E/gDcjv6+l6fmyedNWTOdS1PNkDvAsz5g14FEpMXNf0ZA80oXQOBRQppPcgGTG0ESW/04k9wKsHRShUH2kRCtVHW4RC5YhNUKgiFCpHbcILxRugCRxRRXgpuAhHVBEKVYRCFaFQRXj1oAhHVBEecBbxt6t4HPWItAhXvT7aIhRqjALj9/XIDEdUEQpVY/hoIpmhUDXSJ+6IoyKUPNuJHVB6fJrg69MsPk5mRiNKQeEAcBtVhqcwRbgxL9J72FXWc2P78BWPGuGRubhQ1/Bk6/RGlKznxvYZfQyQzPAVjyL8kkaR6BUPdSFBfEtdQZG+YEeU/i4n9gCvcBahUEUoVBE+zVKETwUX4apXJHunmHwgLdL7QAQx8Jp5jtgEt1FF+IGIIrzMMkYAjqgy/MbdGAVq0538L+jMqNY7GxH8aUKhdnomJhQk88LYQsVOmKe86yEmVNRuntgyAeJJvmzj1pmHyQGfjVtVvBgSVNGkKR2UZ0ww2+jeqhc5AwBv80KMLsm0hcvaGaELyqI+Iv/8rIztN+pD7YyNUYXJVNLERoO8qHzCfV7NJfWB/p9ifZfcLKXS//sr8DGr2DxKpkJl64wm8ZFTiq8LlY0AwaO4vh/fTsWPT9vqjGovNjFPmNo6VtwnT20/wXj+zygPqA/z71Be8KU8bKOOp8P7PK+cIF+oKSkTF1bRQvkZyGeYXWPn8hJlmm3WNGepM5Egr4cm8RHPmp9vMaFQwOfu2U7wrIGZung47NtI2MpC/wqpUA1zQLeZf5dsmP8As9wA9R3SdwMAAAAASUVORK5CYII=';
  let frameImg = null;
  function caseFrame() {
    if (frameImg) return frameImg.complete ? frameImg : null;
    frameImg = new Image(); frameImg.onload = () => { if (open) draw(); }; frameImg.src = FRAME_SRC;
    return null;
  }
  function drawCase() {
    const { x, y } = CASE, { w: kw, h: kh, rise, shrink } = CARD, [ct, cb] = coverColours();
    const kx = x + CARD.x, ky = y + CARD.y;
    // 1. the card drawn flat on its own canvas
    const off = document.createElement('canvas'); off.width = kw; off.height = kh;
    const main = g; g = off.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false;
    // the cover fills the whole card (cropped to its tall shape); the bottom darkens in dithered steps for the title
    cover(0, 0, kw - (kw % 2), kh - (kh % 2)); if (kw % 2) cover(kw - 2, 0, 2, kh - (kh % 2)); P(0, kh - 1, '#000', kw, 1);
    const fadeTop = kh - 34;
    for (let j = fadeTop; j < kh; j++) {
      const t = (j - fadeTop) / (kh - fadeTop), lvl = Math.min(4, Math.floor(t * 5));
      for (let i = 0; i < kw; i++) { const a = [0.15, 0.3, 0.45, 0.6, 0.72][lvl] + ((BAYER[j & 3][i & 3] / 16) < (t * 5 % 1) ? 0.08 : 0); P(i, j, `rgba(8,6,14,${a})`); }
    }
    logo(5, 4);
    const cw = kw, ch = kh - 32, cx = 0, cy = 0;                       // (where LOADING goes: the middle of the picture)
    g = main; g.imageSmoothingEnabled = false;
    // 2. laid onto the box column by column, following the turn
    const lift = (i) => Math.round(rise * i / (kw - 1)), colH = (i) => kh - Math.round(shrink * i / (kw - 1));
    for (let i = 0; i < kw; i++) g.drawImage(off, i, 0, 1, kh, kx + i, ky - lift(i), 1, colH(i));
    // 3. the words (title, or LOADING) drawn flat on a see-through layer, then laid on with the same slope as the card,
    //    column by column without stretching, so they follow the turn and every letter keeps its pixels
    const tl = document.createElement('canvas'); tl.width = kw; tl.height = kh;
    g = tl.getContext('2d'); g.imageSmoothingEnabled = false;
    loadingText(cx + cw / 2, cy + ch / 2 - 3, '#e8e6f2', 'rgba(0,0,0,.6)');
    const room = kw - 6, ty = kh - 20;
    { const two = nameLines(room, 2, true); if (two.fits) writeName(kw / 2, ty + 1, room, 2, '#ffffff', 'rgba(0,0,0,.55)'); else writeName(kw / 2, ty - 4, room, 3, '#ffffff', 'rgba(0,0,0,.55)', 6); }
    g = main; g.imageSmoothingEnabled = false;
    for (let i = 0; i < kw; i++) g.drawImage(tl, i, 0, 1, kh, kx + i, ky - lift(i), 1, kh);
    // 4. the shine across the plastic, then the traced frame on top
    g.fillStyle = 'rgba(255,255,255,.07)';
    for (let j = 0; j < kh; j++) for (let i = 0; i < kw; i++) { const k = i - j * 0.6; if (k > 32 && k < 46) g.fillRect(kx + i, ky - lift(i) + j, 1, 1); }
    const f = caseFrame(); if (f) g.drawImage(f, x, y);
  }

  // ---------- tape: a cassette drawn after Mihai's reference picture, stretched to fill the whole panel ----------
  const T_LINE = '#3b3530', T_SHELL = '#e6dccb', T_HI = '#f6efe2', T_LO = '#cfc4b1', T_BAND = '#efe6d6', T_GROOVE = '#9b9183';
  function round(x, y, w, h, fill, line) { // rounded rectangle with a 1 px outline and 2 px corners
    P(x + 2, y, line, w - 4, 1); P(x + 2, y + h - 1, line, w - 4, 1); P(x, y + 2, line, 1, h - 4); P(x + w - 1, y + 2, line, 1, h - 4);
    P(x + 1, y + 1, line); P(x + w - 2, y + 1, line); P(x + 1, y + h - 2, line); P(x + w - 2, y + h - 2, line);
    if (fill) { P(x + 2, y + 1, fill, w - 4, h - 2); P(x + 1, y + 2, fill, w - 2, h - 4); }
  }
  function reel(cx, cy) { // white ring, dark inside, eight white teeth around the hub that turn while playing
    for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) {
      const r = Math.hypot(i + 0.5, j + 0.5) - 0.5;
      if (r <= 6.3 && r > 5.0) P(cx + i, cy + j, '#f7f2e8');
      else if (r <= 5.0) P(cx + i, cy + j, '#1c1a20');
      else if (r <= 7.0) P(cx + i, cy + j, '#b9ae9c');
    }
    for (let k = 0; k < 8; k++) {
      const a = frame * Math.PI / 12 + k * Math.PI / 4;
      P(Math.round(cx + Math.cos(a) * 4 - 0.5), Math.round(cy + Math.sin(a) * 4 - 0.5), '#f7f2e8');
    }
  }
  function screw(a, b) { P(a, b, '#6d6a6c', 3, 3); P(a + 1, b, '#45424a'); P(a + 1, b + 1, '#9c98a0'); }
  function drawTape() {
    const w = 92, h = 64, x = 1, y = Math.round((H - 2 - h) / 2);     // a real cassette's proportions, on the gradient
    P(x + 2, y + h, 'rgba(0,0,0,.35)', w - 2, 1);                    // shadow
    round(x, y, w, h, T_SHELL, T_LINE);                                 // shell
    P(x + 2, y + 1, T_HI, w - 4, 1); P(x + 1, y + 2, T_HI, 1, h - 4);
    P(x + 2, y + h - 2, T_LO, w - 4, 1); P(x + w - 2, y + 2, T_LO, 1, h - 4);
    screw(x + 2, y + 2); screw(x + w - 5, y + 2); screw(x + 2, y + h - 5); screw(x + w - 5, y + h - 5);
    // label: the cover across the top, with the title strip under it
    const lx = x + 6, ly = y + 5, lw = 80, lh = 30;
    cover(lx, ly, lw, lh);
    logo(lx + 2, ly + 2);
    bitmap(['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], lx + lw - 8, ly + 2, { '#': '#f4efe6' }); // side A
    // the window band: two reels and the tape window between them
    const bx = x + 18, by = ly + 6, bw = 56, bh = 18;
    round(bx, by, bw, bh, T_BAND, T_LINE);
    P(bx + 2, by + 1, '#fbf7ef', bw - 4, 1);
    reel(bx + 8, by + 9); reel(bx + bw - 9, by + 9);
    const wx = bx + 19, wy = by + 3, ww = bw - 38, wh = bh - 6;     // tape window
    P(wx, wy, '#56535c', ww, wh); P(wx + 1, wy + 1, '#2c2a31', ww - 2, wh - 2);
    const sx = wx + Math.floor(ww / 2) - 1;                          // the brown tape spool in it
    P(sx - 1, wy + 2, '#7d5640', 6, 1); P(sx, wy + 3, '#9a6c50', 4, wh - 6); P(sx - 1, wy + wh - 3, '#7d5640', 6, 1);
    P(sx + 1, wy + 3, '#b9876a', 1, wh - 6);
    // the title strip: paper, a red line, the album name in black. The size adapts to the length: big letters for a
    // normal letters on up to two lines, then three tighter lines (big letters were too big); only past that is it shortened with ".."
    const px = lx, py = ly + lh, ph = 19;
    P(px, py, '#fbf8f1', lw, ph);
    P(px, py, '#d84a3a', lw, 1);
    const ink = '#1a1714', room = lw - 4;
    if (loadingText(px + lw / 2, py + 7, ink)) { /* the name follows once the picture is here */ }
    else {
      const two = nameLines(room, 2, true), ls = two.fits ? two.ls : nameLines(room, 3), lh2 = ls.length === 3 ? 6 : 7;
      const top = py + 2 + Math.round((ph - 2 - (ls.length * lh2 - (lh2 - 5))) / 2);
      ls.forEach((t, j) => text(t, px + lw / 2, top + j * lh2, ink));
    }
    round(lx - 1, ly - 1, lw + 2, lh + ph + 2, null, '#4a4038');
    [[lx, ly], [lx + lw - 1, ly], [lx, ly + lh + ph - 1], [lx + lw - 1, ly + lh + ph - 1]].forEach(([a, b]) => P(a, b, '#4a4038'));
    // bottom: the raised part with its grooves and four holes
    const ty = py + ph + 1, rows = y + h - 1 - ty;
    P(x + 19, ty, T_GROOVE, w - 38, 1);
    for (let j = 1; j < rows; j++) { const d = Math.round(j * 0.6); P(x + 19 - d, ty + j, T_GROOVE); P(x + w - 20 + d, ty + j, T_GROOVE); P(x + 20 - d, ty + j, '#ece3d4', w - 40 + 2 * d, 1); }
    P(x + 2, y + h - 2, T_LO, w - 4, 1);
    [[x + 24, ty + 4, 4, 3], [x + 34, ty + 3, 3, 3], [x + w - 37, ty + 3, 3, 3], [x + w - 28, ty + 4, 4, 3]].forEach(([a, b, c, d]) => P(a, b, '#2b2622', c, d));
  }

  // ---------- cd: an 83 px disc ----------
  function drawCd() {
    const cx = 47, cy = 45, R = 41, D = 2 * R + 1;
    // the disc: the cover printed on it upright, a silver rim, a clear centre ring and the hole. When "spin" is on it
    // turns in steps of 1/16 of a circle, rotated on the cover's own pixel grid so it stays pixel art.
    const G = Math.ceil(D / 2), small = document.createElement('canvas'); small.width = small.height = G;
    const sg = small.getContext('2d', { willReadFrequently: true });
    sg.imageSmoothingEnabled = false;
    sg.save(); sg.translate(G / 2, G / 2); if (spin) sg.rotate(spinStep * Math.PI / 8);
    sg.drawImage(coverGrid(COVER, COVER), -G / 2, -G / 2, G, G); sg.restore();
    const disc = document.createElement('canvas'); disc.width = disc.height = D;
    const dg = disc.getContext('2d', { willReadFrequently: true });
    dg.imageSmoothingEnabled = false;
    dg.drawImage(small, 0, 0, G * 2, G * 2);
    const d = dg.getImageData(0, 0, D, D), p = d.data;
    for (let j = 0; j < D; j++) for (let i = 0; i < D; i++) {
      const r = Math.hypot(i - R, j - R), o = (j * D + i) * 4;
      if (r > R + 0.3 || r < 4) { p[o + 3] = 0; continue; }   // outside, and the hole
      let c = null;
      if (r > R - 1.2) c = [110, 114, 128];                  // outer edge
      else if (r > R - 2.4) c = [214, 218, 228];             // silver rim
      else if (r < 5.2) c = [110, 114, 128];
      else if (r < 11) c = [190, 196, 210];                  // clear plastic ring
      else if (r < 12.2) c = [140, 144, 158];
      if (c) { p[o] = c[0]; p[o + 1] = c[1]; p[o + 2] = c[2]; p[o + 3] = 255; }
    }
    dg.putImageData(d, 0, 0);
    g.drawImage(disc, cx - R, cy - R);
    // a rainbow glint on the plastic ring and a white highlight on the rim
    [[-7, -6, '#ffd6f2'], [-8, -4, '#c9e8ff'], [-6, -8, '#fff4c4'], [6, 7, '#d6ffe0'], [7, 6, '#ffd6f2']].forEach(([dx, dy, c]) => P(cx + dx, cy + dy, c));
    for (let a = 3.6; a < 4.4; a += 0.04) P(Math.round(cx + Math.cos(a) * (R - 2)), Math.round(cy + Math.sin(a) * (R - 2)), '#ffffff');
    logo(cx - 4, cy - 30);
    loadingText(cx, cy + 17, '#e8e6f2', 'rgba(0,0,0,.6)');
    writeName(W / 2 - 1, ART_H + 4, W - 10, 2, '#ffffff', 'rgba(0,0,0,.6)');
  }

  function draw() {
    if (!canvas) return;
    g = canvas.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    { const [ct, cb] = coverColours(), t = skinTone(); gradient(0, 0, canvas.width, canvas.height, mixc(shade(t, 1.1), ct, 0.15), mixc(shade(t, 0.8), cb, 0.1)); } // backdrop: the player's colour, a hint of the cover
    if (look === 'tape') drawTape(); else if (look === 'cd') drawCd(); else drawCase();
  }
  // the reels and the disc move while something plays (nothing runs when paused, hidden, or showing the case)
  function animate() {
    const want = open && (look === 'tape' || (look === 'cd' && spin)) && playing && !document.hidden;
    if (want && !timer) timer = setInterval(() => { frame++; spinStep = (spinStep + 1) % 16; draw(); }, look === 'cd' ? 450 : 180);
    if (!want && timer) { clearInterval(timer); timer = null; }
  }

  function setLoading(on) {
    loading = on;
    if (on && !dotTimer) dotTimer = setInterval(() => { stripe = (stripe + 1) % 6; if (stripe % 3 === 0) dots = (dots + 1) % 4; if (open) draw(); }, 120); // stripes slide right, dots count
    if (!on && dotTimer) { clearInterval(dotTimer); dotTimer = null; dots = 0; stripe = 0; }
  }
  function paint(dataUrl) {
    const im = new Image();
    const mine = ++token;
    im.onload = () => { if (mine === token) { img = im; setLoading(false); draw(); } };
    im.onerror = () => { api.log('album tab: picture could not be decoded'); img = null; setLoading(false); noCover = true; draw(); };
    im.src = dataUrl;
  }

  function set(on) {
    open = on;
    try { localStorage.setItem('minapp.albumTab', on ? '1' : '0'); } catch {}
    if (on) { ensure(); tab.style.display = ''; load(url); }
    else if (tab) tab.style.display = 'none';
    animate();
    api.albumState({ look, spin, open });
  }

  async function load(u) {
    if (!open || !canvas) return;
    if (!u) { // no picture address: still on its way if something is playing (Spotify / Windows send it a bit later)
      token++; img = null; clearTimeout(giveUp);
      if (url === '' && albumName && !stopped) { noCover = false; setLoading(true); giveUp = setTimeout(() => { if (url === '') { setLoading(false); noCover = true; draw(); } }, 10000); }
      else { setLoading(false); noCover = false; }
      draw(); return;
    }
    clearTimeout(giveUp); noCover = false;
    const mine = token, wait = setTimeout(() => { if (token === mine && url === u) { img = null; setLoading(true); draw(); } }, 150); // no flash when it is quick
    try {
      const d = await api.artGet(u);
      if (u !== url) return;
      clearTimeout(wait);
      if (d) paint(d); else { api.log('album tab: no picture for ' + u); img = null; setLoading(false); noCover = true; draw(); }
    } catch (e) { clearTimeout(wait); api.log('album tab error: ' + (e && e.message)); img = null; setLoading(false); noCover = true; draw(); }
  }

  // u: picture address ('' = none, null = nothing playing); song: title; isPlaying: moves the reels / disc; album: its name
  function setArt(u, song, isPlaying, album) {
    const next = u === null ? '' : u;
    const wasStopped = stopped; stopped = u === null;
    if (isPlaying !== undefined && !!isPlaying !== playing) { playing = !!isPlaying; animate(); }
    const name = album || song || ''; // YouTube and local files have no album: the song title instead
    const src = source();
    const changed = name !== albumName || src !== lastSrc;
    if (changed) { albumName = name; lastSrc = src; if (open && canvas) draw(); }
    if (next === url) { if (!next && open && canvas && (changed || wasStopped !== stopped)) load(''); return; } // new song, picture not here yet

    url = next;
    if (open) load(url);
  }

  // click on the song title or the timer
  document.addEventListener('click', (e) => {
    if (!(e.target.closest && e.target.closest('#marquee, #time'))) return;
    if (getWidgetMode() !== 'off') return;
    // the timer would also flip between elapsed and remaining time: keep the clock as it is
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    set(!open);
  }, true);

  // from the menu: choose the look, or turn the CD's spinning on / off
  function setOptions(o) {
    if (o.look && LOOK_ORDER.includes(o.look)) look = o.look;
    if (o.spin !== undefined) { spin = !!o.spin; if (!spin) spinStep = 0; }
    try { localStorage.setItem('minapp.albumStyle', look); localStorage.setItem('minapp.albumSpin', spin ? '1' : '0'); } catch {}
    if (timer) { clearInterval(timer); timer = null; }
    if (!open) set(true); else { draw(); animate(); }
    api.albumState({ look, spin, open });
  }
  window.__albumTab = {
    setArt, setOptions,
    // how far the player is pushed right to make room for the panel
    offset: () => (open && tab && getWidgetMode() === 'off' ? W : 0),
  };
  document.addEventListener('visibilitychange', animate);
  api.onAlbumOptions((o) => setOptions(o || {}));
  api.albumState({ look, spin, open });
  if (open) ensure();
}
