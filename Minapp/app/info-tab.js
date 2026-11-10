// Info panel: an optional strip under the player that shows either the LYRICS of the playing song or a short text
// ABOUT THE ARTIST. It is drawn like the rest of the player: the skin's song-title font and the playlist colours.
// The two choices are skin-style push buttons in the panel's top bar; X (or the Player menu) hides the panel.
import { setText, skinImage } from './download-bar.js';

const W = 275, H = 116, PAD = 7, ROW = 9, HEAD = 20, VIS = 10, CW = 50;
const KINDS = [['lyrics', 'LYRICS'], ['artist', 'ARTIST'], ['album', 'ALBUM']];
const SAY = { // what each tab says while it waits, fails or finds nothing
  lyrics: ['Play a song to see its lyrics.', 'Looking for the lyrics...', 'Could not reach the lyrics service.', 'No lyrics found for this song.'],
  artist: ['Play a song to read about the artist.', 'Looking up the artist...', 'Could not reach Wikipedia.', 'Nothing found about this artist.'],
  album: ['Play a song to see its album.', 'Looking up the album...', 'Could not reach the album services.', 'Nothing found about this album.'],
};
const mmss = (ms) => { const t = Math.round(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const same = (a, b) => { const n = (x) => String(x || '').toLowerCase().replace(/\s*[-(\[].*$/, '').replace(/[^\p{L}\p{N}]/gu, ''); return !!n(a) && n(a) === n(b); };

// the skin font has capitals, digits and a few signs: everything else is brought down to those
function plain(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»]/g, '"').replace(/[–—−]/g, '-').replace(/…/g, '...')
    .replace(/;/g, ':').replace(/\s+/g, ' ').trim();
}
function wrap(t, width) {
  const out = []; let line = '';
  for (let word of plain(t).split(' ')) {
    while (word.length > width) { if (line) { out.push(line); line = ''; } out.push(word.slice(0, width)); word = word.slice(width); }
    if (!line) line = word; else if (line.length + 1 + word.length <= width) line += ' ' + word; else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}

export function initInfoTab(webamp, api, getWidgetMode) {
  let open = false, kind = 'lyrics', panel = null, skinKey = '';
  let song = null, songKey = '', data = {}, rows = [], top = 0, cur = -1, handsOff = 0, ticket = 0, hover = -1, hasComma = true;
  try { open = localStorage.getItem('minapp.infoTab') === '1'; const k = localStorage.getItem('minapp.infoKind'); if (k === 'artist' || k === 'album') kind = k; } catch {}
  const skin = () => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } };
  const colours = () => { const st = skin(); return { bg: st.normalbg || '#000', hi: st.current || '#fff', sel: st.selectedbg || '#0000c6' }; };
  const visible = () => open && getWidgetMode() === 'off';
  const report = () => { try { api.infoState({ open, kind }); } catch {} };

  // ---------- what to show ----------
  function build() {
    rows = [];
    const d = data[kind];
    const note = (...lines) => { rows.push({ t: '' }); for (const t of lines) rows.push({ t, dim: true, mid: true }); };
    const say = SAY[kind];
    if (!song || !song.title) note(say[0]);
    else if (!d) note(say[1]);
    else if (d.status === 'error') { note(say[2]); rows.push({ t: '' }); rows.push({ t: '[ Try again ]', act: 'retry', mid: true }); }
    else if (d.status !== 'ok') note(say[3]);
    else if (kind === 'lyrics') {
      if (d.instrumental) note('Instrumental', '(this one has no words)');
      else if (d.synced) d.synced.forEach((l, i) => { if (!l.s) rows.push({ t: '', li: i }); else for (const t of wrap(l.s, CW)) rows.push({ t, li: i }); });
      else { let blank = true; for (const l of d.text.split(/\r?\n/)) { if (!l.trim()) { if (!blank) rows.push({ t: '' }); blank = true; } else { blank = false; for (const t of wrap(l, CW)) rows.push({ t }); } } }
      if (!d.instrumental) { rows.push({ t: '' }); rows.push({ t: 'Lyrics from LRCLIB', dim: true }); }
    } else if (kind === 'album') {
      rows.push({ t: d.name || song.album || '', bright: true });
      rows.push({ t: [d.artist, d.year].filter(Boolean).join('  '), dim: true });
      if (d.uri) rows.push({ t: '[ PLAY THE ALBUM ]', act: 'play' });
      if (d.tracks.length) rows.push({ t: '' });
      d.tracks.forEach((t, i) => {
        const time = t.ms ? mmss(t.ms) : '', no = String(i + 1).padStart(2, ' ') + '. ';
        rows.push({ t: no + t.name.slice(0, CW - no.length - time.length - 1).padEnd(CW - no.length - time.length, ' ') + time, now: same(t.name, song.title) });
      });
      if (d.text) { for (const para of d.text.split(/\n+/)) { rows.push({ t: '' }); for (const t of wrap(para, CW)) rows.push({ t }); } rows.push({ t: '' }); rows.push({ t: 'From Wikipedia', dim: true }); }
    } else {
      rows.push({ t: d.name || song.artist || '', bright: true });
      if (d.about) for (const t of wrap(d.about, CW)) rows.push({ t, dim: true });
      for (const para of d.text.split(/\n+/)) { rows.push({ t: '' }); for (const t of wrap(para, CW)) rows.push({ t }); }
      rows.push({ t: '' }); rows.push({ t: 'From Wikipedia', dim: true });
    }
    if (!hasComma) for (const r of rows) r.t = r.t.replace(/,/g, '.');
  }

  // the timed line that is being sung now (-1: none, or the words are not timed)
  function current() {
    const d = data[kind];
    if (kind !== 'lyrics' || !d || !d.synced) return -1;
    let pos = 0; try { pos = webamp.store.getState().media.timeElapsed || 0; } catch {}
    let i = -1;
    for (let k = 0; k < d.synced.length && d.synced[k].t <= pos + 0.25; k++) i = k;
    return i;
  }

  function draw() {
    if (!panel) return;
    const { hi, sel, bg } = colours();
    // the font's letters sit on little blocks of the skin's background colour: blend those away over a highlight
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(bg);
    const blend = `mix-blend-mode:${!m || parseInt(m[1], 16) * 3 + parseInt(m[2], 16) * 6 + parseInt(m[3], 16) < 1280 ? 'lighten' : 'darken'};`;
    const body = panel.querySelector('.it-body');
    body.textContent = '';
    const maxTop = Math.max(0, rows.length - VIS);
    top = Math.max(0, Math.min(top, maxTop));
    const timed = cur >= 0 || (kind === 'lyrics' && data.lyrics && data.lyrics.synced);
    rows.slice(top, top + VIS).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'it-row'; d.dataset.i = String(top + i);
      const now = r.now || (timed && r.li === cur && r.li !== undefined);
      d.style.cssText = `position:absolute;left:2px;right:2px;top:${i * ROW}px;height:${ROW}px;` + (r.act ? 'cursor:pointer;' : '') +
        (now ? `background:${sel};` : '') + (r.act && top + i === hover ? `background:${sel};` : '') +
        (r.dim ? 'opacity:.6;' : timed && r.li !== undefined && !now ? 'opacity:.55;' : '') + (r.bright || now ? 'filter:brightness(1.35);' : '');
      const t = document.createElement('div');
      const x = (r.mid ? Math.round((W - 2 - r.t.length * 5) / 2) : PAD) - 2;
      t.style.cssText = `position:absolute;left:${x}px;top:1px;height:6px;white-space:nowrap;${now || r.act ? blend : ''}`;
      setText(t, r.t); d.appendChild(t);
      body.appendChild(d);
    });
    const bar = panel.querySelector('.it-bar');
    bar.style.display = maxTop ? 'block' : 'none';
    if (maxTop) {
      const h = VIS * ROW, th = Math.max(12, Math.round(h * VIS / rows.length));
      bar.firstChild.style.cssText = `position:absolute;left:0;width:3px;height:${th}px;top:${Math.round((h - th) * top / maxTop)}px;background:${hi};opacity:.5;`;
    }
    // the two push buttons: the chosen one is pressed in
    for (const b of panel.querySelectorAll('.it-tab')) {
      const on = b.dataset.kind === kind;
      b.style.background = on ? sel : 'rgba(255,255,255,.06)';
      b.style.borderColor = on ? 'rgba(0,0,0,.7) rgba(255,255,255,.35) rgba(255,255,255,.35) rgba(0,0,0,.7)' : 'rgba(255,255,255,.4) rgba(0,0,0,.7) rgba(0,0,0,.7) rgba(255,255,255,.4)';
      b.firstChild.style.opacity = on ? '1' : '.6';
      b.firstChild.style.top = on ? '2px' : '1px';
      b.firstChild.style.mixBlendMode = blend.slice(15, -1);
    }
  }

  // keep the line being sung in the middle, unless the list was just scrolled by hand
  function follow(force) {
    const c = current();
    if (c === cur && !force) return;
    cur = c;
    if (c >= 0 && Date.now() > handsOff) {
      const first = rows.findIndex((r) => r.li === c);
      if (first >= 0) top = first - Math.floor((VIS - 1) / 2);
    }
    draw();
  }

  async function load(force) {
    if (!song || !song.title) { build(); draw(); return; }
    const k = kind, key = songKey, mine = ++ticket;
    if (data[k] && !force) { build(); follow(true); return; }
    data[k] = null; build(); draw();
    let res;
    try { res = await api.infoGet(k, song); } catch (e) { res = { status: 'error', message: String((e && e.message) || e) }; }
    if (key !== songKey) return; // the song changed while we were asking
    data[k] = res || { status: 'none' };
    if (mine !== ticket && k !== kind) return;
    top = 0; build(); follow(true);
  }

  // ---------- the panel itself ----------
  function frame() {
    const { bg, hi } = colours();
    skinKey = bg;
    panel.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;box-sizing:border-box;z-index:45;background:${bg};user-select:none;` +
      'border:1px solid;border-color:rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);' +
      `box-shadow:inset 0 0 0 1px ${bg},inset 0 0 0 2px rgba(0,0,0,.45);` + (visible() ? '' : 'display:none;');
    panel.querySelector('.it-line').style.background = hi;
  }
  function ensure() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'info-tab';
    panel.innerHTML = '<div class="it-head" style="position:absolute;left:0;top:0;right:0;height:16px"></div>' +
      `<div class="it-line" style="position:absolute;left:${PAD}px;right:${PAD}px;top:15px;height:1px;opacity:.45"></div>` +
      `<div class="it-body" style="position:absolute;left:0;right:0;top:${HEAD}px;height:${VIS * ROW}px;overflow:hidden"></div>` +
      `<div class="it-bar" style="position:absolute;right:3px;top:${HEAD}px;width:3px;height:${VIS * ROW}px"><div></div></div>`;
    const head = panel.querySelector('.it-head');
    KINDS.forEach(([k, label], i) => {
      const b = document.createElement('div');
      b.className = 'it-tab'; b.dataset.kind = k;
      b.title = k === 'lyrics' ? 'Show the lyrics of this song' : 'Show a short text about the artist';
      b.style.cssText = `position:absolute;left:${PAD + i * 42}px;top:3px;width:40px;height:11px;box-sizing:border-box;border:1px solid;cursor:pointer;`;
      const t = document.createElement('div'); t.style.cssText = 'position:absolute;left:4px;top:2px;height:6px;white-space:nowrap;'; setText(t, label); b.appendChild(t);
      b.addEventListener('click', (e) => { e.stopPropagation(); setKind(k); });
      head.appendChild(b);
    });
    const x = document.createElement('div'); x.style.cssText = `position:absolute;right:${PAD}px;top:5px;height:6px;cursor:pointer`; x.title = 'Hide this panel'; setText(x, 'X'); head.appendChild(x);
    x.addEventListener('click', (e) => { e.stopPropagation(); set(false); });
    const body = panel.querySelector('.it-body');
    const rowOf = (e) => { const d = e.target.closest && e.target.closest('.it-row'); return d ? Number(d.dataset.i) : -1; };
    body.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== hover) { hover = i; if (rows.some((r) => r.act)) draw(); } });
    body.addEventListener('mouseleave', () => { hover = -1; });
    body.addEventListener('click', (e) => { const r = rows[rowOf(e)]; if (r && r.act === 'retry') load(true); if (r && r.act === 'play' && data.album && data.album.uri) api.infoPlay(data.album.uri).catch(() => {}); });
    panel.addEventListener('wheel', (e) => { e.preventDefault(); top += e.deltaY > 0 ? 3 : -3; handsOff = Date.now() + 6000; draw(); }, { passive: false });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    (document.getElementById('webamp') || document.body).appendChild(panel);
    // a skin without a comma in its font shows a full stop instead
    try { hasComma = [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.selectorText && r.selectorText.includes('.character-44')); } catch { return false; } }); } catch {}
    frame();
  }

  // right under the lowest of the stacked windows (and the download strip, when that is showing)
  function place() {
    if (!panel) return;
    const show = visible();
    if ((panel.style.display !== 'none') !== show) panel.style.display = show ? '' : 'none';
    if (!show) return;
    let left = 0, bottom = 0;
    for (const sel of ['#main-window', '#equalizer-window', '#playlist-window', '#dl-panel']) {
      const el = document.querySelector(sel); if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) { bottom = Math.max(bottom, r.bottom); if (sel === '#main-window') left = r.left; }
    }
    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(bottom) + 'px';
    if (skin().normalbg && skin().normalbg !== skinKey) { frame(); draw(); }
  }

  function set(v) {
    open = !!v;
    try { localStorage.setItem('minapp.infoTab', open ? '1' : '0'); } catch {}
    if (open) { ensure(); frame(); place(); load(false); } else if (panel) panel.style.display = 'none';
    report(); infoButton();
  }
  function setKind(k) {
    if (!SAY[k]) return;
    kind = k; top = 0; cur = -1; handsOff = 0;
    try { localStorage.setItem('minapp.infoKind', kind); } catch {}
    if (!open) set(true); else load(false);
    report();
  }
  // called with every poll of the player: reload when the song changes
  function setSong(s) {
    const next = s && s.title ? { artist: s.artist || '', title: s.title, duration: s.duration, album: s.album || '', id: s.id || '' } : null;
    const key = next ? `${next.artist}|${next.title}` : '';
    if (key === songKey) { if (next && song && next.album && !song.album) song.album = next.album; return; } // the album name can arrive a moment later
    const keepAlbum = next && song && data.album && next.album && next.album === song.album && data.album.status === 'ok';
    songKey = key; song = next; data = keepAlbum ? { album: data.album } : {}; top = 0; cur = -1; handsOff = 0;
    if (open) load(false);
  }

  // ---------- the repeat button becomes INFO: it opens and closes this panel, its light shows when it is open ----------
  const TINY = { I: ['#', '#', '#', '#', '#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'], F: ['###', '#..', '##.', '#..', '#..'], O: ['.##.', '#..#', '#..#', '#..#', '.##.'] };
  let btnKey = '';
  function infoButton() {
    const b = document.getElementById('repeat');
    if (!b) return;
    const src = skinImage(open ? '#webamp #repeat.selected' : '#webamp #repeat');
    const key = src + open;
    if (key === btnKey && b.querySelector('canvas')) return;
    btnKey = key;
    const m = /url\("?(.*?)"?\)$/.exec(src);
    if (!m) return;
    const im = new Image();
    im.onload = () => {
      let c = b.querySelector('canvas');
      if (!c) { c = document.createElement('canvas'); c.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated;'; b.style.position = b.style.position || 'absolute'; b.appendChild(c); }
      const w = b.offsetWidth || 28, h = b.offsetHeight || 15;
      c.width = w; c.height = h; c.style.width = w + 'px'; c.style.height = h + 'px';
      const cg = c.getContext('2d', { willReadFrequently: true });
      cg.drawImage(im, 0, 0);
      // the icon sits right of the light: paint over it with the button face, then the word in the icon's darkest colour
      const d = cg.getImageData(0, 0, w, h).data, at = (x, y) => { const o = (y * w + x) * 4; return [d[o], d[o + 1], d[o + 2]]; };
      const face = at(Math.round(w * 0.75), 2);
      let ink = face, dark = 999;
      for (let y = 3; y < h - 3; y++) for (let x = 11; x < w - 3; x++) { const p = at(x, y), l = p[0] + p[1] + p[2]; if (l < dark) { dark = l; ink = p; } }
      cg.fillStyle = `rgb(${face})`; cg.fillRect(10, 3, w - 13, h - 6);
      cg.fillStyle = `rgb(${ink})`;
      let x = 11, y = Math.round((h - 5) / 2);
      for (const ch of 'INFO') { TINY[ch].forEach((r, j) => [...r].forEach((q, i) => { if (q === '#') cg.fillRect(x + i, y + j, 1, 1); })); x += TINY[ch][0].length + 1; }
    };
    im.src = m[1];
    b.title = 'Lyrics and about the artist';
  }
  const onRepeat = (e) => e.target.closest && e.target.closest('#repeat');
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  ['mousedown', 'mouseup'].forEach((ev) => document.addEventListener(ev, (e) => { if (onRepeat(e)) swallow(e); }, true));
  document.addEventListener('click', (e) => { if (onRepeat(e)) { swallow(e); set(!open); } }, true);
  setInterval(infoButton, 1000);

  setInterval(() => { if (!open || document.hidden) return; place(); if (visible()) follow(false); }, 250);
  api.onInfo((o) => { if (!o) return; if (o.kind) setKind(o.kind); else set(o.open === undefined ? !open : o.open); });
  window.__infoTab = { set, setKind, setSong, show: (k, d) => { data[k] = d; kind = k; build(); follow(true); } };
  if (open) set(true); else report();
}
