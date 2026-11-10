// Download progress panel: a strip under the player, drawn with the current skin's own pieces: the song-title font
// (TEXT.BMP), the position bar and its slider (POSBAR.BMP), the pause/play/stop buttons (CBUTTONS.BMP) and the
// playlist colours. It appears while the record button is saving a YouTube link and goes away when it is done.
const W = 275, H = 40, BAR_W = 200, THUMB_W = 29, TEXT_W = 259, PCT_CHARS = 4;

// the skin's images live in Webamp's generated style sheet; copy the ones we need onto our own classes
// the newest stylesheet wins: after a skin change the old skin's styles can still be in the page for a while
const sheetsNewestFirst = () => [...document.styleSheets].reverse();
export function skinImage(selector) {
  for (const sheet of sheetsNewestFirst()) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r.selectorText === selector && r.style && r.style.backgroundImage) return r.style.backgroundImage;
    }
  }
  return 'none';
}

// The panels' background is the player's own colour (the average of the skin's main window picture), and the skin
// font is redrawn without the little blocks behind its letters (see themeFont), so the letters sit on that colour in
// every skin. Until both are ready (and for a skin without a main picture) the playlist colour is used.
const fontBg = { src: '', col: '' };
const theme = { webamp: null, imgs: null, tone: null, fontKey: '', ready: false, style: null };
const PANELS = ['#info-tab', '#lists-tab', '#dl-panel', '#whatsnew-panel', '#playlist-picker'];
export function textBg(fallback) {
  readFontBg();
  if (theme.ready && theme.tone) return `rgb(${theme.tone.map(Math.round).join(',')})`;
  return fallback;
}
export function initTheme(webamp) {
  if (theme.webamp) return;
  theme.webamp = webamp;
  setInterval(themeTick, 1000); themeTick();
}
function themeTick() {
  if (document.hidden) return;
  // the main window's picture: from the loaded skin, or (the built-in skin) from the page's style sheet
  let src = ''; try { src = (theme.webamp.store.getState().display.skinImages || {}).MAIN_WINDOW_BACKGROUND || ''; } catch {}
  if (!src) { const m = /url\("?(.*?)"?\)$/.exec(skinImage('#webamp #main-window')); src = m ? m[1] : ''; }
  if (src && src !== theme.imgs) {
    theme.imgs = src;
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = 24; c.height = 10;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, 24, 10);
      const d = g.getImageData(0, 0, 24, 10).data, a = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) { a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; }
      theme.tone = a.map((v) => v / (d.length / 4)); theme.fontKey = ''; // redo the font: its contrast depends on the tone
    };
    im.src = src;
  }
  readFontBg();
  const key = fontBg.src + '|' + (fontBg.rgb || '') + '|' + (fontBg.ink || '') + '|' + (theme.tone || '');
  if (!theme.tone || !fontBg.rgb || !fontBg.ink || key === theme.fontKey) return;
  theme.fontKey = key;
  themeFont(key);
}
// every character of the skin font, with its background colour made see-through. Letters that would be hard to read
// on the player's colour are redrawn in white or black instead (their shape and soft edges stay).
async function themeFont(key) {
  const codes = new Map();
  for (const sheet of sheetsNewestFirst()) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) { const m = r.selectorText && /\.character-(\d+)$/.exec(r.selectorText); if (m && r.style && r.style.backgroundImage && !codes.has(m[1])) codes.set(m[1], r.style.backgroundImage); }
  }
  const b = fontBg.rgb, ink = fontBg.ink, tone = theme.tone;
  const span = Math.max(40, Math.abs(ink[0] - b[0]) + Math.abs(ink[1] - b[1]) + Math.abs(ink[2] - b[2]));
  const poor = Math.abs(lum(ink) - lum(tone)) < 80, fixed = lum(tone) < 128 ? [255, 255, 255] : [0, 0, 0];
  const load = (src) => new Promise((ok) => { const m = /url\("?(.*?)"?\)$/.exec(src); if (!m) return ok(null); const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = m[1]; });
  const rules = [];
  for (const [code, src] of codes) {
    const im = await load(src);
    if (!im || key !== theme.fontKey) { if (key !== theme.fontKey) return; continue; }
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    for (let o = 0; o < d.length; o += 4) {
      const k = Math.abs(d[o] - b[0]) + Math.abs(d[o + 1] - b[1]) + Math.abs(d[o + 2] - b[2]);
      d[o + 3] = Math.min(255, Math.round((k / span) * 1.3 * 255));
      if (poor) { d[o] = fixed[0]; d[o + 1] = fixed[1]; d[o + 2] = fixed[2]; }
    }
    g.putImageData(id, 0, 0);
    rules.push(`${PANELS.map((p) => p + ' .character-' + code).join(',')}{background-image:url(${c.toDataURL()}) !important}`);
  }
  if (!theme.style) { theme.style = document.createElement('style'); theme.style.id = 'minapp-font'; }
  theme.style.textContent = rules.join('\n');
  document.head.appendChild(theme.style); // last in the page, so it wins over the skin's own
  theme.ready = true;
}
// the colour the panel letters are drawn in (for little drawings next to them, such as the magnifier)
export function textInk(fallback) {
  const ink = fontBg.ink, t = theme.tone;
  if (!theme.ready || !ink || !t) return fallback ? rgbOf(fallback) : null;
  return Math.abs(lum(ink) - lum(t)) < 80 ? (lum(t) < 128 ? [255, 255, 255] : [0, 0, 0]) : ink;
}
function readFontBg() {
  const src = fontRule('32');
  if (src !== fontBg.src) {
    fontBg.src = src; fontBg.col = ''; fontBg.rgb = null; fontBg.ink = null;
    const m = /url\("?(.*?)"?\)$/.exec(src);
    if (m) {
      const im = new Image();
      im.onload = () => {
        if (fontBg.src !== src) return;
        const c = document.createElement('canvas'); c.width = im.width || 5; c.height = im.height || 6;
        const g = c.getContext('2d'); g.drawImage(im, 0, 0);
        const d = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
        fontBg.rgb = [d[0], d[1], d[2]];
        fontBg.col = d[3] > 200 ? `rgb(${d[0]},${d[1]},${d[2]})` : '';
      };
      im.src = m[1];
      // the letters' own colour: the pixel of "A" that stands out most from the background
      const a = /url\("?(.*?)"?\)$/.exec(fontRule('97'));
      if (a) {
        const ia = new Image();
        ia.onload = () => {
          const c = document.createElement('canvas'); c.width = ia.width || 5; c.height = ia.height || 6;
          const g = c.getContext('2d'); g.drawImage(ia, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data, b = fontBg.rgb || [d[0], d[1], d[2]];
          let far = -1;
          for (let o = 0; o < d.length; o += 4) { const k = Math.abs(d[o] - b[0]) + Math.abs(d[o + 1] - b[1]) + Math.abs(d[o + 2] - b[2]); if (k > far) { far = k; fontBg.ink = [d[o], d[o + 1], d[o + 2]]; } }
        };
        ia.src = a[1];
      }
    }
  }
}
const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
const rgbOf = (t) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(t); if (m) return [1, 2, 3].map((i) => parseInt(m[i], 16)); const r = /(\d+)\D+(\d+)\D+(\d+)/.exec(t); return r ? [1, 2, 3].map((i) => Number(r[i])) : null; };
// A highlight colour the skin font stays readable on. The letters are blended onto highlights (their background blocks
// disappear), which only works when the highlight is on the background's side of the letters: a skin whose highlight
// is brighter than its dark-background font (or darker than its light-background font) gets a toned-down highlight.
export function selBg(sel) {
  if (theme.ready) { // the letters have no blocks behind them any more: the skin's highlight works unless it is close to the letters
    const s = rgbOf(sel), ink = textInk(), t = theme.tone;
    if (!s || !ink || Math.abs(lum(s) - lum(ink)) >= 100) return sel;
    return `rgb(${s.map((v, i) => Math.round(t[i] + (v - t[i]) * 0.4)).join(',')})`;
  }
  const s = rgbOf(sel), b = fontBg.rgb, ink = fontBg.ink;
  if (!s || !b || !ink) return sel;
  const dark = lum(b) < lum(ink), gap = lum(ink) - lum(b);
  const ok = dark ? lum(s) < lum(ink) - Math.abs(gap) * 0.35 : lum(s) > lum(ink) + Math.abs(gap) * 0.35;
  if (ok) return sel;
  const t = 0.4; // keep the highlight's hue, closer to the background
  return `rgb(${s.map((v, i) => Math.round(b[i] + (v - b[i]) * t)).join(',')})`;
}
// A word painted over a skin button (INFO on repeat, LIB on PL), drawn into canvas g that already holds the button's
// image. From x0 on, each row of the face is wiped with that row's own face colour (bevels and gradients stay), then the
// word is drawn in the colour that stood out most from the face: the skin's own lettering or icon colour.
const TINY = { I: ['#', '#', '#', '#', '#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], F: ['###', '#..', '##.', '#..', '#..'], O: ['###', '#.#', '#.#', '#.#', '###'],
  L: ['#..', '#..', '#..', '#..', '###'], B: ['##.', '#.#', '##.', '#.#', '##.'], D: ['##.', '#.#', '#.#', '#.#', '##.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  E: ['###', '#..', '##.', '#..', '###'], C: ['###', '#..', '#..', '#..', '###'], P: ['###', '#.#', '###', '#..', '#..'], Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  S: ['###', '#..', '###', '..#', '###'], R: ['##.', '#.#', '##.', '#.#', '#.#'], T: ['###', '.#.', '.#.', '.#.', '.#.'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], A: ['.#.', '#.#', '###', '#.#', '#.#'], Z: ['###', '..#', '.#.', '#..', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'], '-': ['...', '...', '###', '...', '...'] };
export function paintWord(g, w, h, x0, word, centre) {
  const d = g.getImageData(0, 0, w, h).data, at = (x, y) => { const o = (y * w + x) * 4; return [d[o], d[o + 1], d[o + 2]]; };
  const x1 = w - 2, y0 = 2, y1 = h - 2, face = [];
  for (let y = y0; y < y1; y++) {
    // the face is read at the two edges of the area (icons and letters sit in the middle): the commoner colour wins
    const n = new Map(); let best = null, bn = 0;
    for (const x of [x0, x0 + 1, x1 - 2, x1 - 1]) { const k = at(x, y).join(); const v = (n.get(k) || 0) + 1; n.set(k, v); if (v > bn) { bn = v; best = k; } }
    face[y] = best.split(',').map(Number);
  }
  let ink = [255, 255, 255], far = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const p = at(x, y), f = face[y], k = Math.abs(p[0] - f[0]) + Math.abs(p[1] - f[1]) + Math.abs(p[2] - f[2]);
    if (k > far) { far = k; ink = p; }
  }
  const mid = face[Math.round(h / 2)];
  if (far < 60) ink = mid[0] + mid[1] + mid[2] > 380 ? [0, 0, 0] : [255, 255, 255]; // nothing to copy: black or white
  for (let y = y0; y < y1; y++) { g.fillStyle = `rgb(${face[y]})`; g.fillRect(x0, y, x1 - x0, 1); }
  g.fillStyle = `rgb(${ink})`;
  const width = [...word].reduce((a, ch) => a + TINY[ch][0].length + 1, -1);
  let x = centre ? x0 + Math.round((x1 - x0 - width) / 2) : x0, y = Math.round((h - 5) / 2);
  for (const ch of word) { TINY[ch].forEach((r, j) => [...r].forEach((q, i) => { if (q === '#') g.fillRect(x + i, y + j, 1, 1); })); x += TINY[ch][0].length + 1; }
}
// how letters are laid on a highlight so the blocks behind them disappear: brighter-wins on a dark font background
export function blendFor(bg) { if (theme.ready) return 'normal'; const c = rgbOf(bg); return !c || lum(c) < 128 ? 'lighten' : 'darken'; }
function fontRule(code) {
  for (const sheet of sheetsNewestFirst()) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (let i = rules.length - 1; i >= 0; i--) { const r = rules[i]; if (r.selectorText && r.selectorText.endsWith('.character-' + code) && r.style && r.style.backgroundImage) return r.style.backgroundImage; }
  }
  return 'none';
}

// Webamp's class for a character of the skin font (letters are stored lower-case, accents are dropped)
const charClass = (c) => {
  const d = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  return 'character character-' + (d ? d.charCodeAt(0) : 32);
};
export function setText(el, text) {
  if (el._text === text) return;
  el._text = text;
  el.textContent = '';
  const frag = document.createDocumentFragment();
  for (const c of text) { const s = document.createElement('span'); s.className = charClass(c); s.textContent = c; frag.appendChild(s); }
  el.appendChild(frag);
}

export function initDownloadBar(webamp, api) {
  initTheme(webamp);
  let panel = null, style = null, info = null, skinKey = null, fontKey = '', offset = 0, scrollText = '';

  function buildStyle() {
    const st = (() => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } })();
    const bg = textBg(st.normalbg || '#000'), fg = st.normal || '#00ff00', hi = st.current || '#ffffff';
    const img = (s) => skinImage(s);
    style.textContent = `
#dl-panel { position: fixed; width: ${W}px; height: ${H}px; box-sizing: border-box; z-index: 50; background: ${bg};
  border: 1px solid; border-color: rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);
  box-shadow: inset 0 0 0 1px ${bg}, inset 0 0 0 2px rgba(0,0,0,.45); user-select: none; }
#dl-panel .dl-text { position: absolute; left: 7px; top: 6px; width: ${TEXT_W}px; height: 6px; overflow: hidden; white-space: nowrap; }
#dl-panel .dl-win { position: absolute; left: 0; top: 0; height: 6px; overflow: hidden; }
#dl-panel .dl-scroll { position: absolute; left: 0; top: 0; white-space: nowrap; }
#dl-panel .dl-pct { position: absolute; right: 0; top: 0; white-space: nowrap; }
#dl-panel .dl-bar { position: absolute; left: 7px; top: 21px; width: ${BAR_W}px; height: 10px;
  background: ${img('#webamp #position')} no-repeat 0 0 / ${BAR_W}px 10px; }
#dl-panel .dl-fill { position: absolute; left: 2px; top: 3px; height: 4px; background: ${hi}; opacity: .35; }
#dl-panel .dl-thumb { position: absolute; top: 0; width: ${THUMB_W}px; height: 10px; background: ${img('#webamp #position::-webkit-slider-thumb')} no-repeat; }
#dl-panel .dl-btn { position: absolute; top: 17px; width: 23px; height: 18px; cursor: default; }
#dl-panel .dl-pause { left: 218px; background-image: ${img('#webamp .actions #pause')}; }
#dl-panel .dl-pause.down { background-image: ${img('#webamp .actions #pause.winamp-active')}; }
#dl-panel .dl-pause.paused { background-image: ${img('#webamp .actions #play')}; }
#dl-panel .dl-pause.paused.down { background-image: ${img('#webamp .actions #play.winamp-active')}; }
#dl-panel .dl-stop { left: 241px; background-image: ${img('#webamp .actions #stop')}; }
#dl-panel .dl-stop.down { background-image: ${img('#webamp .actions #stop.winamp-active')}; }
#dl-panel .dl-text .character, #dl-panel .dl-text { color: ${fg}; }
html.widget-small #dl-panel { display: none; }`;
  }

  function create() {
    const host = document.getElementById('webamp') || document.body; // inside #webamp so the skin font's rules apply
    style = document.createElement('style'); style.id = 'dl-style'; document.head.appendChild(style);
    panel = document.createElement('div'); panel.id = 'dl-panel';
    panel.innerHTML = '<div class="dl-text"><div class="dl-win"><div class="dl-scroll"></div></div><div class="dl-pct"></div></div>' +
      '<div class="dl-bar"><div class="dl-fill"></div><div class="dl-thumb"></div></div>' +
      '<div class="dl-btn dl-pause" title="Pause download"></div><div class="dl-btn dl-stop" title="Stop download"></div>';
    host.appendChild(panel);
    for (const b of panel.querySelectorAll('.dl-btn')) {
      b.addEventListener('mousedown', (e) => { e.stopPropagation(); b.classList.add('down'); });
      b.addEventListener('mouseleave', () => b.classList.remove('down'));
      b.addEventListener('mouseup', () => b.classList.remove('down'));
    }
    panel.querySelector('.dl-pause').addEventListener('click', () => {
      const paused = !!(info && info.paused);
      api.downloadCtl(paused ? 'resume' : 'pause');
      if (info) { info.paused = !paused; render(); }
    });
    panel.querySelector('.dl-stop').addEventListener('click', () => api.downloadCtl('cancel'));
    buildStyle();
  }

  // sits right under the lowest of the stacked player windows
  function place() {
    if (!panel) return;
    let left = 0, bottom = 0;
    for (const sel of ['#main-window', '#equalizer-window', '#playlist-window']) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) { bottom = Math.max(bottom, r.bottom); if (sel === '#main-window') left = r.left; }
    }
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(bottom) + 'px';
  }

  function render() {
    if (!panel || !info) return;
    const n = info.n || 0, i = info.i || 0, pct = Math.max(0, Math.min(100, info.pct || 0));
    let text, right = '';
    if (info.phase === 'waiting') text = `YouTube asked to slow down. Resuming in ${info.wait} (${info.saved || 0} saved)`;
    else if (info.paused) text = `Paused${n ? `  ${i}/${n}  ${info.title || ''}` : ''}`;
    else if (info.phase === 'preparing' || !n) text = info.title || 'Getting ready...';
    else { text = `${i}/${n}  ${info.title || ''}`; right = `${Math.round(pct)}%`; }
    const frac = n ? Math.min(1, ((i - 1) + pct / 100) / n) : 0;
    const pctEl = panel.querySelector('.dl-pct');
    setText(pctEl, right ? right.padStart(PCT_CHARS, ' ') : '');
    const room = TEXT_W - (right ? (PCT_CHARS + 1) * 5 : 0);
    const box = panel.querySelector('.dl-scroll');
    if (text !== scrollText) { scrollText = text; offset = 0; }
    // Winamp-style marquee: long titles scroll by one character at a time, then wrap around
    const long = text.length * 5 > room;
    setText(box, long ? `${text}  ***  ${text}  ***  ` : text);
    box.style.left = long ? `${-offset * 5}px` : '0px';
    box.parentElement.style.width = room + 'px';
    panel.querySelector('.dl-pause').classList.toggle('paused', !!info.paused);
    panel.querySelector('.dl-pause').title = info.paused ? 'Resume download' : 'Pause download';
    panel.querySelector('.dl-fill').style.width = Math.round(frac * (BAR_W - 4)) + 'px';
    panel.querySelector('.dl-thumb').style.left = Math.round(frac * (BAR_W - THUMB_W)) + 'px';
  }

  setInterval(() => { // marquee step, placement and skin changes
    if (!panel || !info) return;
    const key = (() => { try { return webamp.store.getState().display.skinImages; } catch { return null; } })();
    if (key !== skinKey || textBg('') !== fontKey) { skinKey = key; fontKey = textBg(''); setTimeout(buildStyle, 300); }
    if (scrollText.length * 5 > TEXT_W - (PCT_CHARS + 1) * 5) { offset = (offset + 1) % (scrollText.length + 7); render(); }
    place();
  }, 220);

  api.onDownloadProgress((s) => {
    if (!s) { info = null; if (panel) panel.style.display = 'none'; return; }
    if (!panel) create();
    info = s; panel.style.display = '';
    place(); render();
  });
}
