// Info panel: an optional strip under the player that shows either the LYRICS of the playing song or a short text
// ABOUT THE ARTIST. It is drawn like the rest of the player: the skin's song-title font and the playlist colours.
// The two choices are skin-style push buttons in the panel's top bar; X (or the Player menu) hides the panel.
import { setText, skinImage, textBg, selBg, blendFor, paintWord } from './download-bar.js';

const W = 275, H = 116, PAD = 15, ROW = 9, HEAD = 22, VIS = 9, CW = 46, FL = 12, FR = 20, FB = 9; // FL/FR/FB: the skin frame's left, right and bottom edges
const KINDS = [['lyrics', 'LYRICS'], ['artist', 'ARTIST'], ['album', 'ALBUM']];
const SAY = {
  queue: ['Nothing is playing.', '', '', 'Nothing found.'], // what each tab says while it waits, fails or finds nothing
  lyrics: ['Play a song to see its lyrics.', 'Looking for the lyrics...', 'Could not reach the lyrics service.', 'No lyrics found for this song.'],
  artist: ['Play a song to read about the artist.', 'Looking up the artist...', 'Could not reach Wikipedia.', 'Nothing found about this artist.'],
  album: ['Play a song to see its album.', 'Looking up the album...', 'Could not reach the album services.', 'Nothing found about this album.'],
};
const TOOLS = [['find', 'FIND', 'Find a song in the queue (type, Esc closes)'], ['like', 'LIKE', 'Spotify: like the song. YouTube: save it to Minapp likes. Local: copy it to Liked'],
  ['skip', 'SKIP', 'Skip this song (right-click a song below to hide it)'], ['sort', 'SORT', 'Shuffle, or sort the list'], ['lists', 'LISTS', 'Open your libraries']];
const SORTS = [['order', 'PLAY ORDER'], ['az', 'A-Z BY TITLE'], ['artist', 'BY ARTIST'], ['reverse', 'REVERSE']];
const QVIS = 9, TOOLS_H = 13; // the queue shows 9 rows under its button row
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
  const colours = () => { const st = skin(); return { bg: textBg(st.normalbg || '#000'), hi: st.current || '#fff', sel: selBg(st.selectedbg || '#0000c6') }; };
  let cw = CW, changed = null, embed = false; // embed: shown inside the playlist window (its LYRICS / ARTIST / ALBUM tabs)
  let queue = { hist: [], cur: null, q: [] }, qSig = '', qFind = null, qSort = 'order', sortOpen = false, flash = '', flashUntil = 0;
  const hidden = new Set();
  const vis = () => (kind === 'queue' ? QVIS : VIS);
  const visible = () => open && getWidgetMode() === 'off';
  const report = () => { try { api.infoState({ open, kind }); } catch {} };

  // ---------- what to show ----------
  function build() {
    rows = [];
    const d = data[kind];
    const note = (...lines) => { rows.push({ t: '' }); for (const t of lines) rows.push({ t, dim: true, mid: true }); };
    const say = SAY[kind];
    if (kind === 'queue') buildQueue(note);
    else if (!song || !song.title) note(say[0]);
    else if (!d) note(say[1]);
    else if (d.status === 'error') { note(say[2]); rows.push({ t: '' }); rows.push({ t: '[ Try again ]', act: 'retry', mid: true }); }
    else if (d.status !== 'ok') note(say[3]);
    else if (kind === 'lyrics') {
      if (d.instrumental) note('Instrumental', '(this one has no words)');
      else if (d.synced) d.synced.forEach((l, i) => { if (!l.s) rows.push({ t: '', li: i }); else for (const t of wrap(l.s, cw)) rows.push({ t, li: i }); });
      else { let blank = true; for (const l of d.text.split(/\r?\n/)) { if (!l.trim()) { if (!blank) rows.push({ t: '' }); blank = true; } else { blank = false; for (const t of wrap(l, cw)) rows.push({ t }); } } }
      if (!d.instrumental) { rows.push({ t: '' }); rows.push({ t: 'Lyrics from LRCLIB', dim: true }); }
    } else if (kind === 'album') {
      rows.push({ t: d.name || song.album || '', bright: true });
      rows.push({ t: [d.artist, d.year].filter(Boolean).join('  '), dim: true });
      if (d.uri) rows.push({ t: '[ PLAY THE ALBUM ]', act: 'play' });
      if (d.tracks.length) rows.push({ t: '' });
      d.tracks.forEach((t, i) => {
        const time = t.ms ? mmss(t.ms) : '', no = String(i + 1).padStart(2, ' ') + '. ';
        rows.push({ t: no + t.name.slice(0, cw - no.length - time.length - 1).padEnd(cw - no.length - time.length, ' ') + time, now: same(t.name, song.title), act: t.uri && d.uri ? 'song' : '', uri: t.uri });
      });
      if (d.text) { for (const para of d.text.split(/\n+/)) { rows.push({ t: '' }); for (const t of wrap(para, cw)) rows.push({ t }); } rows.push({ t: '' }); rows.push({ t: 'From Wikipedia', dim: true }); }
    } else {
      rows.push({ t: d.name || song.artist || '', bright: true });
      if (d.about) for (const t of wrap(d.about, cw)) rows.push({ t, dim: true });
      for (const para of d.text.split(/\n+/)) { rows.push({ t: '' }); for (const t of wrap(para, cw)) rows.push({ t }); }
      rows.push({ t: '' }); rows.push({ t: 'From Wikipedia', dim: true });
    }
    if (!hasComma) for (const r of rows) r.t = r.t.replace(/,/g, '.');
  }

  function buildQueue(note) {
    const n = (x) => plain(x).toLowerCase();
    if (sortOpen) {
      const shuffle = (() => { try { return !!webamp.store.getState().media.shuffle; } catch { return false; } })();
      rows.push({ t: `SHUFFLE: ${shuffle ? 'ON' : 'OFF'}`, act: 'shuffle', bright: true });
      for (const [k, label] of SORTS) rows.push({ t: (qSort === k ? '* ' : '  ') + label, act: 'sort', val: k });
      rows.push({ t: '' });
    }
    if (qFind !== null) rows.push({ t: '?' + plain(qFind).slice(-(CW - 3)) + (Date.now() % 1000 < 550 ? '_' : ' '), input: true });
    let list = [];
    queue.hist.forEach((x, i) => list.push({ x, off: i - queue.hist.length }));
    if (queue.cur) list.push({ x: queue.cur, off: 0 });
    queue.q.forEach((x, i) => list.push({ x, off: i + 1 }));
    const label = (x) => plain((x.artist ? x.artist + ' - ' : '') + (x.title || ''));
    list = list.filter((e) => !hidden.has(label(e.x)) && (!qFind || n(label(e.x)).includes(n(qFind))));
    if (qSort === 'az') list.sort((a, b) => n(a.x.title || '').localeCompare(n(b.x.title || '')));
    if (qSort === 'artist') list.sort((a, b) => n(a.x.artist || '').localeCompare(n(b.x.artist || '')) || n(a.x.title || '').localeCompare(n(b.x.title || '')));
    if (qSort === 'reverse') list.reverse();
    if (!list.length) { note(queue.cur ? SAY.queue[3] : SAY.queue[0]); return; }
    for (const e of list) {
      const t = label(e.x);
      rows.push({ t: t.length > CW ? t.slice(0, CW - 1) + '.' : t, now: e.off === 0, dim: e.off < 0, act: e.off && !e.x.hint ? 'jump' : '', off: e.off, key: t });
    }
  }
  function tools() {
    const box = panel && panel.querySelector('.it-tools');
    if (!box) return;
    box.style.display = kind === 'queue' ? '' : 'none';
    if (kind !== 'queue') return;
    const { sel } = colours();
    for (const b of box.querySelectorAll('.it-tool')) {
      const on = (b.dataset.tool === 'find' && qFind !== null) || (b.dataset.tool === 'sort' && sortOpen) || (b.dataset.tool === 'lists' && window.__listsTab && window.__listsTab.isOpen());
      b.style.background = on ? sel : 'rgba(255,255,255,.06)';
      b.style.borderColor = on ? 'rgba(0,0,0,.7) rgba(255,255,255,.35) rgba(255,255,255,.35) rgba(0,0,0,.7)' : 'rgba(255,255,255,.4) rgba(0,0,0,.7) rgba(0,0,0,.7) rgba(255,255,255,.4)';
      b.firstChild.style.top = on ? '2px' : '1px';
      b.firstChild.style.mixBlendMode = blendFor(colours().bg);
    }
    const f = box.querySelector('.it-flash');
    const say = Date.now() < flashUntil ? flash : qSort !== 'order' ? SORTS.find((x) => x[0] === qSort)[1] : '';
    if (f.dataset.t !== say) { f.dataset.t = say; setText(f, say.slice(0, 15)); }
  }
  function say(t) { flash = String(t || ''); flashUntil = Date.now() + 3000; tools(); setTimeout(tools, 3100); }
  function tool(name) {
    if (name === 'find') { qFind = qFind === null ? '' : null; sortOpen = false; }
    else if (name === 'sort') { sortOpen = !sortOpen; }
    else if (name === 'skip') { if (window.__queueJump) window.__queueJump(1); say('SKIPPED'); return; }
    else if (name === 'like') { say('...'); api.queueLike().then(say, () => say('COULD NOT SAVE')); return; }
    else if (name === 'lists') { if (window.__listsTab) window.__listsTab.toggle(); setTimeout(tools, 50); return; }
    top = 0; build(); draw();
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
    if (changed) changed();
    if (!panel) return;
    const { hi, sel, bg } = colours();
    // the font's letters sit on little blocks of the skin's background colour: blend those away over a highlight
    const blend = `mix-blend-mode:${blendFor(bg)};`;
    const body = panel.querySelector('.it-body'), V = vis(), y0 = HEAD + (kind === 'queue' ? TOOLS_H : 0);
    body.textContent = '';
    body.style.top = y0 + 'px'; body.style.height = V * ROW + 'px';
    tools();
    const maxTop = Math.max(0, rows.length - V);
    top = Math.max(0, Math.min(top, maxTop));
    const timed = cur >= 0 || (kind === 'lyrics' && data.lyrics && data.lyrics.synced);
    rows.slice(top, top + V).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'it-row'; d.dataset.i = String(top + i);
      const now = r.now || (timed && r.li === cur && r.li !== undefined);
      d.style.cssText = `position:absolute;left:2px;right:2px;top:${i * ROW}px;height:${ROW}px;` + (r.act ? 'cursor:pointer;' : '') +
        (now ? `background:${sel};` : '') + (r.act && top + i === hover ? `background:${sel};` : '') +
        (r.dim ? 'opacity:.6;' : timed && r.li !== undefined && !now ? 'opacity:.55;' : '') + (r.bright || now ? 'filter:brightness(1.35);' : '');
      const t = document.createElement('div');
      const x = (r.mid ? Math.round((W - FL - FR - r.t.length * 5) / 2) : PAD - FL) - 2;
      t.style.cssText = `position:absolute;left:${x}px;top:1px;height:6px;white-space:nowrap;${now || r.act ? blend : ''}`;
      setText(t, r.t); d.appendChild(t);
      body.appendChild(d);
    });
    const bar = panel.querySelector('.it-bar');
    bar.style.display = maxTop ? 'block' : 'none';
    bar.style.top = y0 + 'px'; bar.style.height = V * ROW + 'px';
    if (maxTop) {
      const h = V * ROW, th = Math.max(12, Math.round(h * V / rows.length));
      bar.firstChild.style.cssText = `position:absolute;left:0;width:3px;height:${th}px;top:${Math.round((h - th) * top / maxTop)}px;background:${hi};opacity:.5;`;
    }
    // the two push buttons: the chosen one is pressed in
    for (const b of panel.querySelectorAll('.it-tab')) {
      const on = b.dataset.kind === kind;
      b.style.background = on ? sel : bg; // solid, so the tabs read clearly on the skin's title bar
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
      if (first >= 0) top = first - Math.floor((vis() - 1) / 2);
    }
    draw();
  }

  async function load(force) {
    if (kind === 'queue') { build(); if (!force) { const i = rows.findIndex((r) => r.now); top = i > 1 ? i - 1 : 0; } draw(); return; }
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
  const frameKey = () => JSON.stringify(colours()) + skinImage('#webamp .playlist-top-left-fill').slice(-60) + skinImage('#webamp .playlist-middle-left').slice(-60);
  function frame() {
    const { bg, hi } = colours();
    skinKey = frameKey();
    panel.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;box-sizing:border-box;z-index:45;background:${bg};user-select:none;` + (visible() ? '' : 'display:none;');
    panel.querySelector('.it-line').style.display = 'none';
    // the frame is the skin's own playlist window: its title bar, sides and bottom edge (any skin dresses it)
    const pic = (k) => skinImage('#webamp .playlist-' + k);
    const parts = {
      tl: [`left:0;top:0;width:25px;height:20px;`, pic('top-left'), 'no-repeat'],
      tf: [`left:25px;top:0;right:25px;height:20px;`, pic('top-left-fill'), 'repeat-x'],
      tr: [`right:0;top:0;width:25px;height:20px;`, pic('top-right'), 'no-repeat'],
      ml: [`left:0;top:20px;width:${FL}px;bottom:${FB}px;`, pic('middle-left'), 'repeat-y'],
      mr: [`right:0;top:20px;width:${FR}px;bottom:${FB}px;`, pic('middle-right'), 'repeat-y'],
      bf: [`left:0;right:0;bottom:0;height:${FB}px;`, pic('bottom'), 'repeat-x', 'left bottom'],
      bl: [`left:0;bottom:0;width:25px;height:${FB}px;`, pic('bottom-left'), 'no-repeat', 'left bottom'],
      br: [`right:0;bottom:0;width:25px;height:${FB}px;`, pic('bottom-right'), 'no-repeat', 'right bottom'],
    };
    for (const [k, [pos, img, rep, at]] of Object.entries(parts)) {
      let d = panel.querySelector('.it-f-' + k);
      if (!d) { d = document.createElement('div'); d.className = 'it-f-' + k; panel.insertBefore(d, panel.firstChild); }
      d.style.cssText = `position:absolute;${pos}pointer-events:none;background-image:${img === 'none' ? 'none' : img};background-repeat:${rep};background-position:${at || (k === 'mr' || k === 'tr' ? 'right top' : 'left top')};`;
    }
  }
  function ensure() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'info-tab';
    panel.innerHTML = '<div class="it-head" style="position:absolute;left:0;top:0;right:0;height:20px"></div>' +
      `<div class="it-line" style="position:absolute;left:${PAD}px;right:${PAD}px;top:15px;height:1px;opacity:.45"></div>` +
      `<div class="it-body" style="position:absolute;left:${FL}px;right:${FR}px;top:${HEAD}px;height:${VIS * ROW}px;overflow:hidden"></div>` +
      `<div class="it-bar" style="position:absolute;right:9px;top:${HEAD}px;width:3px;height:${VIS * ROW}px"><div></div></div>`;
    const tb = document.createElement('div');
    tb.className = 'it-tools'; tb.style.cssText = `position:absolute;left:0;right:0;top:${HEAD}px;height:${TOOLS_H - 2}px;`;
    TOOLS.forEach(([k, label, tip], i) => {
      const b = document.createElement('div');
      b.className = 'it-tool'; b.dataset.tool = k; b.title = tip;
      b.style.cssText = `position:absolute;left:${PAD + i * 34}px;top:0;width:32px;height:11px;box-sizing:border-box;border:1px solid;cursor:pointer;`;
      const t = document.createElement('div'); t.style.cssText = `position:absolute;left:${Math.round((30 - label.length * 5) / 2)}px;top:1px;height:6px;white-space:nowrap;`; setText(t, label); b.appendChild(t);
      b.addEventListener('click', (e) => { e.stopPropagation(); tool(k); });
      tb.appendChild(b);
    });
    const fl = document.createElement('div'); fl.className = 'it-flash'; fl.style.cssText = `position:absolute;left:${PAD + 5 * 34 + 3}px;top:3px;height:6px;white-space:nowrap;opacity:.75;`; tb.appendChild(fl);
    panel.appendChild(tb);
    const head = panel.querySelector('.it-head');
    KINDS.forEach(([k, label], i) => {
      const b = document.createElement('div');
      b.className = 'it-tab'; b.dataset.kind = k;
      b.title = { queue: 'The songs up next (and the ones played)', lyrics: 'Show the lyrics of this song', artist: 'Show a short text about the artist', album: 'The album: its songs and a short text' }[k];
      b.style.cssText = `position:absolute;left:${PAD + i * 42}px;top:5px;width:40px;height:11px;box-sizing:border-box;border:1px solid;cursor:pointer;`;
      const t = document.createElement('div'); t.style.cssText = 'position:absolute;left:4px;top:2px;height:6px;white-space:nowrap;'; setText(t, label); b.appendChild(t);
      b.addEventListener('click', (e) => { e.stopPropagation(); setKind(k); });
      head.appendChild(b);
    });
    const x = document.createElement('div'); x.style.cssText = 'position:absolute;right:0;top:0;width:12px;height:12px;cursor:pointer'; x.title = 'Hide this panel'; head.appendChild(x); // over the skin's own close button
    x.addEventListener('click', (e) => { e.stopPropagation(); set(false); });
    const body = panel.querySelector('.it-body');
    const rowOf = (e) => { const d = e.target.closest && e.target.closest('.it-row'); return d ? Number(d.dataset.i) : -1; };
    body.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== hover) { hover = i; if (rows.some((r) => r.act)) draw(); } });
    body.addEventListener('mouseleave', () => { hover = -1; if (rows.some((r) => r.act)) draw(); });
    body.addEventListener('click', (e) => { const r = rows[rowOf(e)]; if (r && r.act === 'retry') load(true); if (r && r.act === 'song' && data.album) api.infoPlay(r.uri, data.album.uri).catch(() => {});
      if (r && r.act === 'jump' && window.__queueJump) { window.__queueJump(r.off); say(r.off > 0 ? 'JUMPING AHEAD' : 'GOING BACK'); }
      if (r && r.act === 'sort') { qSort = r.val; sortOpen = false; top = 0; build(); draw(); }
      if (r && r.act === 'shuffle') { const sh = document.querySelector('#webamp #shuffle'); if (sh) sh.click(); setTimeout(() => { build(); draw(); }, 100); }
      if (r && r.act === 'play' && data.album && data.album.uri) api.infoPlay(data.album.uri).catch(() => {}); });
    body.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); const r = rows[rowOf(e)]; if (kind === 'queue' && r && r.key && !r.now) { hidden.add(r.key); say('HIDDEN'); build(); draw(); } });
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
    if (frameKey() !== skinKey) { frame(); draw(); }
  }

  function set(v) {
    if (embed) { if (v && window.__playlistView) window.__playlistView.tab(kind); return; } // the playlist window shows it now
    open = !!v;
    try { localStorage.setItem('minapp.infoTab', open ? '1' : '0'); } catch {}
    if (open) { ensure(); frame(); place(); load(false); } else if (panel) panel.style.display = 'none';
    report();
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
    if (open || embed) load(false);
  }

  // called with every poll: the played songs, the playing one and the ones up next
  function setQueue(hist, cur, q) {
    const pick = (x) => ({ artist: x.artist || '', title: x.title || '', hint: !!x.hint });
    queue = { hist: (hist || []).map(pick), cur: cur && cur.title ? pick(cur) : null, q: (q || []).map(pick) };
    const sig = JSON.stringify(queue);
    if (sig === qSig) return;
    const first = !qSig; qSig = sig;
    if (open && kind === 'queue' && panel) { build(); if (first || qSort === 'order') { const i = rows.findIndex((r) => r.now); if (i >= 0 && (i < top || i >= top + QVIS)) top = Math.max(0, i - 1); } draw(); }
  }
  // typing while FIND is on: letters go into the search line; Enter plays the first match; Esc closes FIND (and SORT)
  document.addEventListener('keydown', (e) => {
    if (!visible() || kind !== 'queue' || (qFind === null && !sortOpen) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { qFind = null; sortOpen = false; }
    else if (qFind === null) return;
    else if (e.key === 'Enter') { const r = rows.find((x) => x.act === 'jump'); if (r && window.__queueJump) { window.__queueJump(r.off); qFind = null; } }
    else if (e.key === 'Backspace') qFind = qFind.slice(0, -1);
    else if (e.key.length === 1 && qFind.length < 40) qFind += e.key;
    else return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    top = 0; build(); draw();
  }, true);
  setInterval(() => { if (qFind !== null && visible() && kind === 'queue' && !document.hidden) { build(); draw(); } }, 500); // the blinking cursor

  // ---------- the repeat button becomes INFO: it opens and closes this panel, its light shows when it is open ----------
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
      paintWord(cg, w, h, 10, 'INFO', false); // the light on the left of the button stays
    };
    im.src = m[1];
    b.title = 'Lyrics and about the artist';
  }
  const onRepeat = (e) => e.target.closest && e.target.closest('#repeat');
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  // (the repeat button is the skin's repeat button again: the info lives in the playlist window's top bar now)

  setInterval(() => { if (!open || document.hidden) return; place(); if (visible()) follow(false); }, 250);
  api.onInfo((o) => { if (!o) return; if (o.kind) setKind(o.kind); else set(o.open === undefined ? !open : o.open); });
  // the playlist window asks for what to show: rows for one kind, `width` letters wide; and the line being sung
  function view(k, width) {
    embed = true;
    if (open) { open = false; if (panel) panel.style.display = 'none'; }
    if (width && width !== cw) { cw = width; if (kind === k) build(); }
    if (k !== kind) { kind = k; top = 0; cur = -1; load(false); }
    else if (!song || !data[kind]) { if (!rows.length) build(); if (song && data[kind] === undefined) load(false); }
    return { rows, cur: current() };
  }
  function click(r) {
    if (!r) return;
    if (r.act === 'retry') load(true);
    if (r.act === 'song' && data.album) api.infoPlay(r.uri, data.album.uri).catch(() => {});
    if (r.act === 'play' && data.album && data.album.uri) api.infoPlay(data.album.uri).catch(() => {});
  }
  window.__infoTab = { view, click, onChange: (cb) => { changed = cb; }, set, setKind, setSong, setQueue, colours, style: () => skin(), show: (k, d) => { data[k] = d; kind = k; build(); follow(true); } };
  open = false; report(); // the separate panel is not shown any more: its tabs live in the playlist window
}
