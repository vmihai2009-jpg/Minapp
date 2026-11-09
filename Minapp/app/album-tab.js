// Album panel: what is playing (Spotify album cover, YouTube thumbnail) shown as a physical object, in a panel attached
// to the left of the player like Milkdrop is attached to the right. The panel is framed and coloured like Minapp's
// other panels (the skin's playlist colours and bevel) and the name underneath is written in the skin's own font.
// Three looks, drawn as 1-pixel pixel art like the skin, with the cover itself on a 32 x 32 grid:
//  - case: a see-through plastic case with the source's logo
//  - tape: a cassette with the cover as its label; the reels turn while music plays
//  - cd:   a disc with the cover printed on it; it can turn slowly, in pixel steps, while music plays
// Click the song title or the timer to show or hide it; click the panel to go to the next look. The menu has the same
// choices under Album picture, plus "Spin the CD" (off by default: the CD then stays still and upright).
import { setText } from './download-bar.js';

const W = 96, H = 116;          // the panel: as tall as the player
const ART_H = 90;               // the drawing; the name goes underneath
const COVER = 32, LEVELS = 8;   // the cover's pixel grid and palette
const LOOK_ORDER = ['case', 'tape', 'cd'];
const CHARS = 17;               // characters per line of the skin font (5 px each)

export function initAlbumTab(webamp, api, getWidgetMode) {
  let open = false, tab = null, canvas = null, nameEl = null, url = null, token = 0, img = null, look = 'case';
  let spin = false, spinStep = 0;
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
    nameEl = document.createElement('div');
    nameEl.style.cssText = 'position:absolute;height:20px;overflow:hidden;';
    tab.append(canvas, nameEl);
    tab.title = 'Click to change the look: case, cassette, CD (click the song title to hide it)';
    tab.addEventListener('mousedown', (e) => e.stopPropagation());
    tab.addEventListener('click', () => {
      look = LOOK_ORDER[(LOOK_ORDER.indexOf(look) + 1) % LOOK_ORDER.length];
      try { localStorage.setItem('minapp.albumStyle', look); } catch {}
      if (timer) { clearInterval(timer); timer = null; }
      draw(); animate(); api.albumState({ look, spin, open });
    });
    (document.getElementById('webamp') || document.body).appendChild(tab); // inside #webamp so the skin font applies
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
    if (grid && grid.key === key && grid.img === img) return grid.c;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cg = c.getContext('2d', { willReadFrequently: true });
    if (!img) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { cg.fillStyle = ((x >> 2) + (y >> 2)) % 2 ? '#34343e' : '#41414d'; cg.fillRect(x, y, 1, 1); }
    } else {
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

  // ---------- case: a cassette box, 70 x 108 (the tall proportions of a real one), cover 64 x 64, name inside ----------
  const CASE = { x: 11, y: 2, w: 70, h: 108 };
  function drawCase() {
    const { x, y, w, h } = CASE;
    P(x + 2, y + 2, '#1c1e2b', w, h);                               // the back of the box (depth)
    P(x + w + 1, y + 3, '#5d6176', 1, h - 2); P(x + 3, y + h + 1, '#4a4e60', w - 2, 1);
    P(x, y, '#161721', w, h);                                       // front: dark see-through plastic
    box(x, y, w, h, '#9fa3b5');
    P(x + 1, y + 1, '#d3d6e2', w - 2, 1); P(x + 1, y + 1, '#d3d6e2', 1, h - 2); // light top / left edges
    P(x + 1, y + h - 2, '#585c6f', w - 2, 1); P(x + w - 2, y + 2, '#585c6f', 1, h - 3);
    P(x + 2, y + 2, '#3a3d4e', w - 4, 1);                           // the lid's lip
    logo(x + 4, y + 5);
    const cx = x + 3, cy = y + 17;
    box(cx - 1, cy - 1, 66, 66, '#07070b');
    cover(cx, cy, 64, 64);
    // shine across the plastic
    g.fillStyle = 'rgba(255,255,255,.09)';
    for (let j = 2; j < h - 2; j++) for (let i = 2; i < w - 2; i++) { const k = i + j; if ((k > 16 && k < 30) || (k > 40 && k < 43)) g.fillRect(x + i, y + j, 1, 1); }
    P(x + 2, y + 2, '#ffffff'); P(x + 3, y + 2, 'rgba(255,255,255,.6)'); P(x + 2, y + 3, 'rgba(255,255,255,.6)');
    P(x + w - 3, y + 6, 'rgba(255,255,255,.25)', 1, h - 14);        // bright edge on the right
  }

  // ---------- tape: a cassette, 92 x 64, drawn after Mihai's reference picture ----------
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
    const x = 1, y = 13, w = 92, h = 64;
    round(x, y, w, h, T_SHELL, T_LINE);                                 // shell
    P(x + 2, y + 1, T_HI, w - 4, 1); P(x + 1, y + 2, T_HI, 1, h - 4);
    P(x + 2, y + h - 2, T_LO, w - 4, 1); P(x + w - 2, y + 2, T_LO, 1, h - 4);
    screw(x + 3, y + 3); screw(x + w - 6, y + 3); screw(x + 3, y + h - 6); screw(x + w - 6, y + h - 6);
    // label: the cover, across the upper two thirds
    const lx = x + 6, ly = y + 7, lw = 80, lh = 40;
    cover(lx, ly, lw, lh);
    round(lx - 1, ly - 1, lw + 2, lh + 2, null, '#4a4038');
    [[lx, ly], [lx + lw - 1, ly], [lx, ly + lh - 1], [lx + lw - 1, ly + lh - 1]].forEach(([a, b]) => P(a, b, '#4a4038'));
    logo(lx + 3, ly + 3);
    bitmap(['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], lx + lw - 10, ly + lh - 12, { '#': '#f4efe6' }); // side A
    // the window band: two reels and the tape window between them
    const bx = x + 17, by = y + 21, bw = 56, bh = 18;
    round(bx, by, bw, bh, T_BAND, T_LINE);
    P(bx + 2, by + 1, '#fbf7ef', bw - 4, 1);
    reel(bx + 8, by + 9); reel(bx + bw - 9, by + 9);
    const wx = bx + 19, wy = by + 3, ww = bw - 38, wh = bh - 6;     // tape window
    P(wx, wy, '#56535c', ww, wh); P(wx + 1, wy + 1, '#2c2a31', ww - 2, wh - 2);
    const sx = wx + Math.floor(ww / 2) - 1;                          // the brown tape spool in it
    P(sx - 1, wy + 2, '#7d5640', 6, 1); P(sx, wy + 3, '#9a6c50', 4, wh - 6); P(sx - 1, wy + wh - 3, '#7d5640', 6, 1);
    P(sx + 1, wy + 3, '#b9876a', 1, wh - 6);
    // bottom: the raised part under the label, with its grooves and four holes
    const ty = y + 49;
    P(x + 17, ty, T_GROOVE, w - 34, 1);
    for (let j = 1; j < h - 50; j++) { const d = Math.round(j * 0.35); P(x + 17 - d, ty + j, T_GROOVE); P(x + w - 18 + d, ty + j, T_GROOVE); P(x + 18 - d, ty + j, '#ece3d4', w - 36 + 2 * d, 1); }
    [[x + 22, y + 58, 4, 3], [x + 32, y + 56, 3, 3], [x + w - 35, y + 56, 3, 3], [x + w - 26, y + 58, 4, 3]].forEach(([a, b, c, d]) => P(a, b, '#2b2622', c, d));
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
  }

  function draw() {
    if (!canvas) return;
    g = canvas.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (look === 'tape') drawTape(); else if (look === 'cd') drawCd(); else drawCase();
    writeName();
  }
  // the album's name in the skin's own font, on up to two centred lines, shortened with ".." when it is too long
  function writeName() {
    if (!nameEl) return;
    // on the case the name sits inside the box under the cover (13 characters a line); otherwise under the drawing
    const inCase = look === 'case', per = inCase ? 13 : CHARS;
    Object.assign(nameEl.style, inCase ? { left: CASE.x + 1 + 'px', width: CASE.w - 2 + 'px', top: CASE.y + 84 + 'px' } : { left: '3px', width: W - 8 + 'px', top: ART_H + 2 + 'px' });
    const words = String(albumName || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean), ls = [];
    let cur = '';
    for (let i = 0; i < words.length; i++) {
      const wd = words[i].length > per ? words[i].slice(0, per) : words[i];
      const next = cur ? cur + ' ' + wd : wd;
      if (next.length <= per) { cur = next; continue; }
      ls.push(cur); cur = wd;
      if (ls.length === 2) { const rest = ls[1] + ' ' + words.slice(i).join(' '); ls[1] = rest.length > per ? rest.slice(0, per - 2).trimEnd() + '..' : rest; cur = ''; break; }
    }
    if (cur && ls.length < 2) ls.push(cur);
    const key = look + ls.join('\n');
    if (nameEl._key === key) return;
    nameEl._key = key; nameEl.textContent = '';
    ls.forEach((t, j) => {
      const row = document.createElement('div');
      row.style.cssText = `position:absolute;left:0;right:0;top:${(ls.length === 1 ? 5 : 1) + j * 9}px;height:6px;text-align:center;white-space:nowrap;`;
      const inner = document.createElement('span'); inner.style.cssText = 'display:inline-block;height:6px;';
      setText(inner, t); row.appendChild(inner); nameEl.appendChild(row);
    });
  }
  // the reels and the disc move while something plays (nothing runs when paused, hidden, or showing the case)
  function animate() {
    const want = open && (look === 'tape' || (look === 'cd' && spin)) && playing && !document.hidden;
    if (want && !timer) timer = setInterval(() => { frame++; spinStep = (spinStep + 1) % 16; draw(); }, look === 'cd' ? 450 : 180);
    if (!want && timer) { clearInterval(timer); timer = null; }
  }

  function paint(dataUrl) {
    const im = new Image();
    const mine = ++token;
    im.onload = () => { if (mine === token) { img = im; draw(); } };
    im.onerror = () => { api.log('album tab: picture could not be decoded'); img = null; draw(); };
    im.src = dataUrl;
  }

  function set(on) {
    open = on;
    try { localStorage.setItem('minapp.albumTab', on ? '1' : '0'); } catch {}
    if (on) { ensure(); tab.style.display = ''; if (url) load(url); else draw(); }
    else if (tab) tab.style.display = 'none';
    animate();
    api.albumState({ look, spin, open });
  }

  async function load(u) {
    if (!open || !canvas) return;
    if (!u) { token++; img = null; draw(); return; }
    try {
      const d = await api.artGet(u);
      if (u !== url) return;
      if (d) paint(d); else { api.log('album tab: no picture for ' + u); img = null; draw(); }
    } catch (e) { api.log('album tab error: ' + (e && e.message)); img = null; draw(); }
  }

  // u: picture address ('' = none, null = nothing playing); song: title; isPlaying: moves the reels / disc; album: its name
  function setArt(u, song, isPlaying, album) {
    const next = u === null ? '' : u;
    if (isPlaying !== undefined && !!isPlaying !== playing) { playing = !!isPlaying; animate(); }
    const name = album || song || ''; // YouTube and local files have no album: the song title instead
    const src = source();
    if (name !== albumName || src !== lastSrc) { albumName = name; lastSrc = src; if (open && canvas) draw(); }
    if (next === url) return;
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
