// The playlist window, reworked: your libraries on the left (Spotify, YouTube and local playlists in folders) and on the
// right the songs of what is picked there; NOW PLAYING (the queue) is picked by default. It is drawn over the skin's own
// playlist window with the skin's playlist font and colours, so every skin keeps its look. The five buttons at the
// bottom are the skin's own buttons with new words: FIND, LIKE, COPY, SORT and INFO (it was LIST OPTS).
import { skinImage, paintWord } from './download-bar.js';

const ROW = 14, FS = 11; // row height and letter size: a little bigger than the skin's 9 px so it reads easily
const BUTTONS = [ // the skin's button, where it sits inside the bottom pieces of the window, and its new job
  { sel: '#playlist-add-menu', piece: 'left', x: 14, word: 'FIND', tip: 'Find a song in the list on the right (Enter searches a whole library)' },
  { sel: '#playlist-remove-menu', piece: 'left', x: 43, word: 'LIKE', tip: 'Spotify: like the song. YouTube: save it to Minapp likes. Local: copy it to Liked' },
  { sel: '#playlist-selection-menu', piece: 'left', x: 72, word: 'ADD', tip: 'Add the playing song to the playlist picked on the left' },
  { sel: '#playlist-misc-menu', piece: 'left', x: 101, word: 'SORT', tip: 'Shuffle, or sort the list' },
  { sel: '#playlist-list-menu', piece: 'right', x: -44, word: 'MENU', tip: 'Minapp menu: sources, skins, sleep timer and more' },
];
const TABS = [['playlist', 'PLAYLIST'], ['library', 'LIBRARY'], ['lyrics', 'LYRICS'], ['artist', 'ARTIST'], ['album', 'ALBUM']];
const SORTS = [['shuffle', 'SHUF'], ['az', 'A-Z'], ['artist', 'ARTST'], ['reverse', 'REV']];

export function initPlaylistView(webamp, api) {
  let tools = true, tab = 'playlist', lw = 100, hoverAt = 0, menuOpen = false, bar = null, infoBox = null, infoCur = -1, infoTop = 0, infoHover = -1, infoRows = [];
  try { tools = localStorage.getItem('minapp.pvTools') !== '0'; } catch {}
  try { const t = localStorage.getItem('minapp.pvTab'); if (TABS.some((x) => x[0] === t)) tab = t; } catch {}
  let root = null, left = null, right = null, line = null, data = null, loadedAt = 0, skinKey = '';
  let pick = { kind: 'queue' }, songs = null, results = null, busy = false, find = null, sort = 'order', sortOpen = false;
  let lTop = 0, rTop = 0, lHover = -1, rHover = -1, lRows = [], rRows = [], flash = '', flashUntil = 0;
  let queue = { hist: [], cur: null, q: [] }, qSig = '', rMax = 0, barSet = -1;
  const open = { spotify: true, youtube: false, ytmusic: false, local: false };
  try { Object.assign(open, JSON.parse(localStorage.getItem('minapp.pvOpen') || '{}')); } catch {}
  const skin = () => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } };
  const colours = () => { const s = skin(); return { bg: s.normalbg || '#000', fg: s.normal || '#00ff00', cur: s.current || '#fff', sel: s.selectedbg || '#0000c6', font: s.font || 'Arial' }; };
  const win = () => document.querySelector('#playlist-window');
  const n = (x) => String(x || '').toLowerCase();

  // ---------- the left side: libraries ----------
  function buildLeft() {
    lRows = [{ t: 'NOW PLAYING', kind: 'queue' }];
    const folder = (key, label, list, empty) => {
      lRows.push({ t: `${open[key] ? '-' : '+'} ${label}`, folder: key });
      if (!open[key]) return;
      if (!data) lRows.push({ t: '   Loading...', dim: true });
      else if (!list.length) lRows.push({ t: '   ' + empty, dim: true });
      for (const r of list) lRows.push({ ...r, t: '   ' + r.t });
    };
    const sp = data && data.spotify;
    let spl = [];
    if (sp && sp.status === 'ok') spl = [{ t: 'Liked songs', kind: 'spotify', id: `spotify:user:${sp.userId}:collection` }, ...sp.items.map((p) => ({ t: p.name, kind: 'spotify', id: 'spotify:playlist:' + p.id })),
      { t: '[ Add a Spotify-made playlist ]', kind: 'spotaddlink', act: true }]; // Daily Mix and the like: Spotify does not list them for apps
    else if (sp && (sp.status === 'login' || sp.status === 'rescope')) spl = [{ t: '[ Connect ]', kind: 'spotconnect', act: true }];
    folder('spotify', 'SPOTIFY', spl, 'Could not load');
    const yt = data && data.youtube, ytl = [];
    if (yt) {
      if (yt.link) ytl.push({ t: yt.link, kind: 'ytlink' });
      for (const p of yt.items) ytl.push({ t: p.name, kind: 'youtube', id: p.id });
      for (const p of yt.saved || []) ytl.push({ t: p.name, kind: 'ytsaved', id: p.name });
      if (!yt.signedIn) ytl.push({ t: '[ Sign in ]', kind: 'ytsignin', act: true });
    }
    folder('youtube', 'YOUTUBE', ytl, yt && yt.loading ? 'Loading...' : 'No playlists');
    const ym = data && data.ytmusic, yml = [];
    if (ym) { for (const p of ym.items) yml.push({ t: p.name, kind: 'ytmusic', id: p.id }); if (!ym.signedIn) yml.push({ t: '[ Sign in ]', kind: 'ytsignin', act: true }); }
    folder('ytmusic', 'YT MUSIC', yml, ym && ym.loading ? 'Loading...' : 'No playlists');
    folder('local', 'LOCAL', ((data && data.local) || []).map((p) => ({ t: p.name, kind: 'local', id: p.name })), 'No playlists');
  }
  const pickNow = () => pick;
  const same = (r) => r.kind === pick.kind && (r.kind === 'queue' || (r.folder ? r.folder === pick.key : (r.id || '') === (pick.id || '')));

  // ---------- the right side: the queue, a playlist's songs or search results ----------
  function buildRight() {
    rRows = [];
    const pick = tab === 'playlist' ? { kind: 'queue' } : pickNow(); // the PLAYLIST tab always shows what's playing
    if (find !== null) rRows.push({ t: 'Find: ' + find + (Date.now() % 1000 < 550 ? '_' : ' '), input: true });
    let list = [];
    if (pick.kind === 'queue') {
      queue.hist.forEach((x, i) => list.push({ x, off: i - queue.hist.length }));
      if (queue.cur) list.push({ x: queue.cur, off: 0 });
      queue.q.forEach((x, i) => list.push({ x, off: i + 1 }));
      list = list.map((e, i) => ({ t: (tab === 'playlist' ? i + 1 + '. ' : '') + (e.x.artist ? e.x.artist + ' - ' : '') + e.x.title, d: e.x.duration, off: e.off, now: e.off === 0, dim: e.off < 0, hint: e.x.hint }));
      if (!list.length) { rRows.push({ t: 'Nothing is playing.', dim: true }); return; }
    } else if (pick.kind === 'search') {
      if (busy) { rRows.push({ t: 'Searching...', dim: true }); return; }
      if (!results) { rRows.push({ t: find === null ? 'Press FIND to search ' + pick.name + '.' : 'Type, then Enter to search ' + pick.name + '.', dim: true }); return; }
      list = results.map((r) => ({ t: r.t, found: r }));
      if (!list.length) { rRows.push({ t: 'Nothing found.', dim: true }); return; }
    } else {
      if (!songs) { rRows.push({ t: 'Loading songs...', dim: true }); return; }
      list = songs.map((s) => ({ t: s.t, found: s }));
      if (!list.length) { rRows.push({ t: 'No songs.', dim: true }); return; }
    }
    if (find && pick.kind !== 'search') list = list.filter((r) => n(r.t).includes(n(find)));
    const title = (r) => n(r.t.includes(' - ') && pick.kind === 'queue' ? r.t.split(' - ').slice(1).join(' - ') : r.t);
    const artist = (r) => n(r.t.split(' - ')[pick.kind === 'queue' ? 0 : 1] || '');
    if (sort === 'az') list.sort((a, b) => title(a).localeCompare(title(b)));
    if (sort === 'artist') list.sort((a, b) => artist(a).localeCompare(artist(b)) || title(a).localeCompare(title(b)));
    if (sort === 'reverse') list.reverse();
    if (!list.length) rRows.push({ t: 'Nothing found.', dim: true });
    rRows.push(...list);
    if (list.length > 1) { // the last line: how many songs, and how long they run when the lengths are known
      const secs = list.reduce((a, r) => a + (r.d || 0), 0), h = Math.floor(secs / 3600);
      rRows.push({ t: `${list.length} songs` + (secs ? ' \u00b7 ' + (h ? h + ':' + String(Math.floor(secs / 60) % 60).padStart(2, '0') + ':' + String(Math.round(secs) % 60).padStart(2, '0') : mmss(secs)) : ''), dim: true, mid: true });
    }
  }

  // ---------- drawing ----------
  const mmss = (s) => (s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}` : '');
  function paint(box, rows, top, hover, side) {
    const { fg, cur } = colours();
    const vis = Math.max(1, Math.floor(box.clientHeight / ROW));
    const maxTop = Math.max(0, rows.length - vis);
    top = Math.max(0, Math.min(top, maxTop));
    box.textContent = '';
    rows.slice(top, top + vis).forEach((r, i) => {
      const d = document.createElement('div');
      const picked = side === 'L' && !r.dim && (r.kind || r.folder) && same(r.folder ? { kind: 'search', folder: r.folder } : r);
      const live = side === 'L' ? !r.dim : !!(r.found || (r.off && !r.hint));
      const on = picked || r.now || (live && top + i === hover);
      d.dataset.i = String(top + i);
      d.style.cssText = `position:absolute;left:0;right:0;top:${i * ROW}px;height:${ROW}px;line-height:${ROW}px;white-space:nowrap;overflow:hidden;padding:0 3px;box-sizing:border-box;display:flex;` +
        `color:${on || r.input ? cur : fg};` + (r.dim ? 'opacity:.55;' : '') + (live ? 'cursor:pointer;' : '');
      const wrap = document.createElement('div'), t = document.createElement('span');
      wrap.style.cssText = 'flex:1;min-width:0;overflow:hidden;' + (r.mid ? 'text-align:center;' : ''); t.style.cssText = 'display:inline-block;';
      t.textContent = (r.now ? '\u25b8 ' : '') + r.t; wrap.appendChild(t); d.appendChild(wrap); // a small arrow marks the playing song
      if (r.d) { const u = document.createElement('span'); u.style.cssText = 'flex:none;padding-left:4px;'; u.textContent = mmss(r.d); d.appendChild(u); }
      box.appendChild(d);
      if (live && top + i === hover) slide(t, wrap);
    });
    return top;
  }
  // a title too long for its row slides along while the pointer rests on it (and back), so it can be read
  function slide(t, wrap) {
    const over = t.scrollWidth - wrap.clientWidth;
    if (over <= 2) return;
    const secs = Math.max(2.5, over / 22);
    t.style.setProperty('--pv-mq', -over + 'px');
    t.style.animation = `pv-mq ${secs}s linear ${-((Date.now() - hoverAt) / 1000) % (secs * 2)}s infinite alternate`;
  }
  // the always-on bar at the top: LIBRARY, LYRICS, ARTIST, ALBUM
  function drawBar() {
    const { cur, fg } = colours();
    bar.textContent = '';
    for (const [k, label] of TABS) {
      const b = document.createElement('div');
      b.dataset.tab = k; b.textContent = label;
      b.style.cssText = `flex:1;text-align:center;height:${ROW}px;cursor:pointer;color:${k === tab ? cur : fg};` + (k === tab ? 'text-decoration:underline;text-underline-offset:2px;' : 'opacity:.8;');
      bar.appendChild(b);
    }
    const t = document.createElement('div'); // show / hide the bottom tools bar
    t.dataset.tools = '1'; t.textContent = tools ? '\u25be' : '\u25b4';
    t.title = tools ? 'Hide the buttons at the bottom (more room for songs)' : 'Show the buttons at the bottom';
    t.style.cssText = `flex:none;width:14px;text-align:center;height:${ROW}px;cursor:pointer;color:${fg};`;
    bar.appendChild(t);
  }
  function setTab(k) {
    if (!TABS.some((x) => x[0] === k)) return;
    tab = k; infoTop = 0; infoCur = -1;
    try { localStorage.setItem('minapp.pvTab', tab); } catch {}
    if (k !== 'library') { find = null; sortOpen = false; }
    if (k === 'playlist') { buildRight(); const i = rRows.findIndex((r) => r.now); if (i >= 0) rTop = Math.max(0, i - 2); } // open on the playing song
    draw();
  }
  // the LYRICS / ARTIST / ALBUM pages (their words come from info-tab.js)
  function drawInfo() {
    const { fg, cur } = colours();
    const v = window.__infoTab ? window.__infoTab.view(tab, Math.max(20, Math.floor(infoBox.clientWidth / 5.4))) : { rows: [], cur: -1 };
    infoRows = v.rows;
    const vis = Math.max(1, Math.floor(infoBox.clientHeight / ROW));
    if (tab === 'lyrics' && v.cur >= 0 && v.cur !== infoCur && Date.now() > infoHands) { const i = infoRows.findIndex((r) => r.li === v.cur); if (i >= 0) infoTop = i - Math.floor((vis - 1) / 2); }
    infoCur = v.cur;
    infoTop = Math.max(0, Math.min(infoTop, infoRows.length - vis));
    infoBox.textContent = '';
    infoRows.slice(infoTop, infoTop + vis).forEach((r, i) => {
      const d = document.createElement('div');
      const now = r.now || (r.li !== undefined && r.li === v.cur && tab === 'lyrics'), on = now || (r.act && infoTop + i === infoHover);
      d.dataset.i = String(infoTop + i);
      d.style.cssText = `position:absolute;left:0;right:0;top:${i * ROW}px;height:${ROW}px;line-height:${ROW}px;white-space:nowrap;overflow:hidden;padding:0 4px;box-sizing:border-box;` +
        (r.mid ? 'text-align:center;' : '') + `color:${on || r.bright ? cur : fg};` + (r.act && !on ? 'text-decoration:underline;' : '') + (r.dim || (tab === 'lyrics' && v.cur >= 0 && r.li !== undefined && !now) ? 'opacity:.55;' : '') + (r.act ? 'cursor:pointer;' : '');
      d.textContent = r.t;
      infoBox.appendChild(d);
    });
  }
  let infoHands = 0, drawing = false;
  function draw() {
    if (!root) return;
    drawBar();
    const lib = tab === 'library' || tab === 'playlist';
    for (const el of [left, line, right]) el.style.visibility = lib ? '' : 'hidden';
    if (tab === 'playlist') { left.style.visibility = line.style.visibility = 'hidden'; right.style.left = '0px'; } else right.style.left = lw + 1 + 'px';
    infoBox.style.display = lib ? 'none' : '';
    if (!lib) { drawInfo(); const m = document.getElementById('pv-sort'); if (m) m.remove(); buttons(true); return; }
    buildLeft(); buildRight();
    if (tab !== 'playlist') lTop = paint(left, lRows, lTop, lHover, 'L');
    rTop = paint(right, rRows, rTop, rHover, 'R');
    // the skin's scrollbar follows the right side, and dragging it scrolls the right side
    rMax = Math.max(0, rRows.length - Math.max(1, Math.floor(right.clientHeight / ROW)));
    const pct = rMax ? (rTop / rMax) * 100 : 0;
    if (Math.abs(pct - barSet) > 0.01) { barSet = pct; try { webamp.store.dispatch({ type: 'SET_PLAYLIST_SCROLL_POSITION', position: pct }); } catch {} }
    if (sortOpen) sortMenu(); else { const m = document.getElementById('pv-sort'); if (m) m.remove(); }
    buttons(true);
  }

  // ---------- placing it over the skin's playlist window ----------
  let style = null;
  function place() {
    const w = win(), tracks = w && w.querySelector('.playlist-tracks');
    const show = !!(tracks && w.offsetParent !== null);
    document.documentElement.classList.toggle('pv-on', show);
    if (!show) { if (root) root.style.display = 'none'; if (gripEl) gripEl.style.display = 'none'; hideButtons(); return; }
    if (!root) build();
    // the first time: make the window wider so the libraries fit beside the songs (it can still be resized)
    try {
      if (!localStorage.getItem('minapp.pvWide')) {
        localStorage.setItem('minapp.pvWide', '1');
        const g = webamp.store.getState().windows.genWindows.playlist, sz = (g && g.size) || [0, 0];
        if (sz[0] < 4 || sz[1] < 4) webamp.store.dispatch({ type: 'WINDOW_SIZE_CHANGED', windowId: 'playlist', size: [Math.max(4, sz[0]), Math.max(4, sz[1])] }); // 12 songs in view
      }
      if (!localStorage.getItem('minapp.pvTall2')) { // 1.9.28: a proper page of songs (about 14 rows), not one or two
        localStorage.setItem('minapp.pvTall2', '1');
        const g = webamp.store.getState().windows.genWindows.playlist, sz = (g && g.size) || [0, 0];
        if (sz[1] < 8) webamp.store.dispatch({ type: 'WINDOW_SIZE_CHANGED', windowId: 'playlist', size: [sz[0], 8] });
      }
    } catch {}
    const r0 = tracks.getBoundingClientRect(), { bg, fg, font } = colours();
    // tools hidden: the list also covers the bottom bar (buttons, timer), all but the resize corner on the right
    const wr = w.getBoundingClientRect();
    const r = tools ? r0 : { left: r0.left, top: r0.top, width: r0.width, right: r0.right, height: Math.max(r0.height, wr.bottom - r0.top - 3) };
    // with the cassette above, the library column lines up under it; otherwise about a third of the width
    lw = Math.max(90, Math.round(r.width * 0.36));
    const art = document.getElementById('album-tab'), a = art && art.style.display !== 'none' ? art.getBoundingClientRect() : null;
    if (a && a.width && a.bottom <= r.top + 2 && a.right > r.left + 60 && a.right < r.right - 100) lw = Math.round(a.right - r.left) - 1;
    const key = [r.left, r.top, r.width, r.height, bg, fg, font, lw, tools].join();
    root.style.display = '';
    if (key !== skinKey) {
      skinKey = key;
      root.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:30;background:${bg};font:${FS}px/${ROW}px ${font},Arial,sans-serif;user-select:none;overflow:hidden;`;
      const T = ROW + 2; // under the top bar
      bar.style.cssText = `position:absolute;left:0;right:0;top:0;height:${ROW}px;border-bottom:1px solid ${fg};box-sizing:content-box;display:flex;gap:4px;padding:0 2px;font-size:${r.width < 320 ? 9 : FS}px;`;
      bar.style.borderBottomColor = fg; bar.style.borderBottomStyle = 'solid';
      left.style.cssText = `position:absolute;left:0;top:${T}px;bottom:0;width:${lw}px;overflow:hidden;`;
      line.style.cssText = `position:absolute;left:${lw}px;top:${T}px;bottom:0;width:1px;background:${fg};opacity:.5;`;
      right.style.cssText = `position:absolute;left:${lw + 1}px;top:${T}px;bottom:0;right:0;overflow:hidden;`;
      infoBox.style.cssText = `position:absolute;left:0;right:0;top:${T}px;bottom:0;overflow:hidden;`;
      draw();
    }
    if (tools) buttons(false); else { hideButtons(); if (menuOpen) closeMenu(); }
    extras();
    grip(w);
    try { // the scrollbar was dragged
      const pos = webamp.store.getState().display.playlistScrollPosition;
      if (barSet >= 0 && Math.abs(pos - barSet) > 0.5) { barSet = pos; rTop = Math.round((pos / 100) * rMax); draw(); }
    } catch {}
    if (Date.now() - loadedAt > 5 * 60000) load(false);
    if (tab === 'lyrics' && window.__infoTab) { const v = window.__infoTab.view('lyrics'); if (v.cur !== infoCur) draw(); } // the sung line moves on
  }
  function build() {
    style = document.createElement('style');
    // the skin's own rows (Webamp's copy of the queue) stay underneath, out of sight
    style.textContent = 'html.pv-on #playlist-window .playlist-track-titles, html.pv-on #playlist-window .playlist-track-durations { visibility: hidden; }' +
      ' html.pv-on #playlist-window .playlist-running-time-display > div:not(#pv-time) { display: none; }' +
      ' @keyframes pv-mq { 0%, 12% { transform: translateX(0); } 88%, 100% { transform: translateX(var(--pv-mq)); } }';
    document.head.appendChild(style);
    root = document.createElement('div'); root.id = 'playlist-view';
    left = document.createElement('div'); line = document.createElement('div'); right = document.createElement('div');
    bar = document.createElement('div'); infoBox = document.createElement('div');
    root.append(bar, left, line, right, infoBox);
    bar.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('[data-tools]')) { tools = !tools; try { localStorage.setItem('minapp.pvTools', tools ? '1' : '0'); } catch {} skinKey = ''; place(); return; }
      const t = e.target.closest && e.target.closest('[data-tab]'); if (t) setTab(t.dataset.tab);
    });
    infoBox.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== infoHover) { infoHover = i; draw(); } });
    infoBox.addEventListener('click', (e) => { const r = infoRows[rowOf(e)]; if (r && window.__infoTab) window.__infoTab.click(r); });
    infoBox.addEventListener('wheel', (e) => { e.preventDefault(); infoTop += e.deltaY > 0 ? 3 : -3; infoHands = Date.now() + 6000; draw(); }, { passive: false });
    if (window.__infoTab) window.__infoTab.onChange(() => { if (tab !== 'library' && !drawing) { drawing = true; try { draw(); } finally { drawing = false; } } });
    // right-click a Spotify / YouTube / YT Music playlist: copy it to the other side (after asking)
    left.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = lRows[rowOf(e)];
      if (!r || !['spotify', 'youtube', 'ytmusic', 'ytsaved', 'ytlink'].includes(r.kind)) return;
      const to = r.kind === 'spotify' ? 'YouTube (and YT Music)' : 'Spotify';
      if (window.confirm(`Copy "${r.t.trim()}" to ${to}?\n\nThis makes a new playlist there. Nothing is deleted.`)) { pick = { kind: r.kind, id: r.id || '', name: r.t.trim() }; copy(); }
    });
    (document.getElementById('webamp') || document.body).appendChild(root);
    const rowOf = (e) => { const d = e.target.closest && e.target.closest('[data-i]'); return d ? Number(d.dataset.i) : -1; };
    left.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== lHover) { lHover = i; hoverAt = Date.now(); draw(); } });
    right.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== rHover) { rHover = i; hoverAt = Date.now(); draw(); } });
    root.addEventListener('mouseenter', () => { inside = true; });
    root.addEventListener('mouseleave', () => { inside = false; lHover = rHover = -1; draw(); });
    left.addEventListener('click', (e) => clickLeft(lRows[rowOf(e)], false));
    left.addEventListener('dblclick', (e) => clickLeft(lRows[rowOf(e)], true));
    right.addEventListener('click', (e) => clickRight(rRows[rowOf(e)]));
    left.addEventListener('wheel', (e) => { e.preventDefault(); lTop += e.deltaY > 0 ? 2 : -2; draw(); }, { passive: false });
    right.addEventListener('wheel', (e) => { e.preventDefault(); rTop += e.deltaY > 0 ? 3 : -3; draw(); }, { passive: false });
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
  }

  // ---------- clicks ----------
  function clickLeft(r, twice) {
    if (!r || r.dim) return;
    if (r.folder) {
      if (!twice) { open[r.folder] = !open[r.folder]; try { localStorage.setItem('minapp.pvOpen', JSON.stringify(open)); } catch {} }
      if (r.folder === 'ytmusic' && open.ytmusic && !twice) load(false); // YouTube Music is only read once its folder is opened
      pick = { kind: 'search', key: r.folder, folder: r.folder, name: { spotify: 'Spotify', youtube: 'YouTube', ytmusic: 'YouTube Music', local: 'your files' }[r.folder] };
      results = null; rTop = 0; draw(); return;
    }
    if (r.kind === 'spotaddlink') { api.spotAddLink().then((ok) => { if (ok) load(true); }).catch(() => {}); return; }
    if (r.act) { api.listsPlay(r.kind, r.id || '', r.t.trim()).then(() => load(true)).catch(() => {}); return; }
    if (r.kind === 'queue') { pick = { kind: 'queue' }; try { localStorage.removeItem('minapp.pvPick'); } catch {} rTop = 0; draw(); return; }
    if (twice) { say('PLAYING'); api.listsPlay(r.kind, r.id || '', r.t.trim()).catch(() => {}); return; } // double-click: play the whole playlist
    if (same(r)) return;
    const mine = pick = { kind: r.kind, id: r.id || '', name: r.t.trim() };
    try { localStorage.setItem('minapp.pvPick', JSON.stringify(pick)); } catch {}
    songs = null; rTop = 0; draw();
    api.listsSongs(r.kind, r.id || '').then((x) => { if (pick === mine) { songs = x || []; draw(); } }).catch(() => { if (pick === mine) { songs = []; draw(); } });
  }
  function clickRight(r) {
    if (!r) return;
    if (r.off && !r.hint && window.__queueJump) { window.__queueJump(r.off); say(r.off > 0 ? 'JUMPING' : 'GOING BACK'); return; }
    if (r.found) { say('PLAYING'); api.listsFound(r.found).catch((e) => api.log('play failed: ' + (e && e.message))); }
  }

  // ---------- the five buttons: the skin's own pictures with new words ----------
  const btnEls = {};
  function hideButtons() { for (const k in btnEls) btnEls[k].style.display = 'none'; }
  function buttons(redraw) {
    const w = win(); if (!w) return;
    if (!tools) { hideButtons(); return; }
    for (const b of BUTTONS) {
      const el = w.querySelector(b.sel); if (!el) continue;
      const r = el.getBoundingClientRect();
      let c = btnEls[b.word];
      if (!c) {
        c = btnEls[b.word] = document.createElement('canvas');
        c.title = b.tip; c.width = 22; c.height = 18;
        c.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        c.addEventListener('click', (e) => { e.stopPropagation(); press(b.word); });
        (document.getElementById('webamp') || document.body).appendChild(c);
      }
      c.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;z-index:31;cursor:pointer;image-rendering:pixelated;`;
      const pressed = (b.word === 'FIND' && find !== null) || (b.word === 'SORT' && sortOpen) || (b.word === 'MENU' && menuOpen);
      const src = skinImage(`#webamp .playlist-bottom-${b.piece}`), key = src + pressed + r.width;
      if (c._key === key && !redraw) continue;
      c._key = key;
      paintButton(c, src, b, pressed, w);
    }
  }
  const infoOpen = () => { const p = document.getElementById('info-tab'); return !!(p && p.style.display !== 'none'); };
  const images = new Map();
  function img(src, then) {
    const m = /url\("?(.*?)"?\)$/.exec(src || ''); if (!m) return;
    let im = images.get(m[1]);
    if (im && im.complete) { then(im); return; }
    if (!im) { im = new Image(); im.src = m[1]; images.set(m[1], im); }
    im.addEventListener('load', () => then(im), { once: true });
  }
  function paintButton(c, src, b, pressed, w) {
    img(src, (im) => {
      const g = c.getContext('2d', { willReadFrequently: true });
      const x = b.piece === 'right' ? im.width + b.x : b.x; // LIST OPTS sits a fixed distance from the right edge
      g.clearRect(0, 0, 22, 18);
      g.drawImage(im, x, 8, 22, 18, 0, 0, 22, 18);
      paintWord(g, 22, 18, 2, b.word, true);
      if (pressed) { g.globalCompositeOperation = 'difference'; g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(2, 2, 18, 14); g.globalCompositeOperation = 'source-over'; }
    });
  }
  function sortMenu() {
    let m = document.getElementById('pv-sort');
    const anchor = btnEls.SORT; if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    if (!m) {
      m = document.createElement('div'); m.id = 'pv-sort';
      SORTS.forEach(([k, word]) => {
        const c = document.createElement('canvas'); c.width = 30; c.height = 18; c.dataset.k = k; c.title = word;
        c.style.cssText = 'display:block;cursor:pointer;image-rendering:pixelated;';
        c.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        c.addEventListener('click', (e) => { e.stopPropagation(); chooseSort(k); });
        m.appendChild(c);
        img(skinImage('#webamp .playlist-bottom-left'), (im) => {
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(im, 101, 8, 22, 18, 0, 0, 22, 18); g.drawImage(im, 108, 8, 15, 18, 15, 0, 15, 18); // the SORT button's face, a little wider
          paintWord(g, 30, 18, 2, word, true);
          if (k === sort || (k === 'shuffle' && shuffleOn())) { g.globalCompositeOperation = 'difference'; g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(2, 2, 26, 14); g.globalCompositeOperation = 'source-over'; }
        });
      });
      (document.getElementById('webamp') || document.body).appendChild(m);
    }
    m.style.cssText = `position:fixed;left:${a.left}px;top:${a.top - SORTS.length * 18}px;z-index:32;`;
  }
  const shuffleOn = () => { try { return !!webamp.store.getState().media.shuffle; } catch { return false; } };
  function chooseSort(k) {
    if (k === 'shuffle') { const sh = document.querySelector('#webamp #shuffle'); if (sh) sh.click(); say(shuffleOn() ? 'SHUFFLE OFF' : 'SHUFFLE ON'); }
    else sort = sort === k ? 'order' : k;
    sortOpen = false; rTop = 0; draw();
  }
  function press(word) {
    if ((word === 'FIND' || word === 'SORT') && tab !== 'library' && tab !== 'playlist') setTab('library');
    if (word === 'FIND') { find = find === null ? '' : null; sortOpen = false; if (find === null && pick.kind === 'search') results = null; rTop = 0; }
    else if (word === 'SORT') sortOpen = !sortOpen;
    else if (word === 'LIKE') { api.queueLike().then(say, () => say('COULD NOT SAVE')); return; }
    else if (word === 'MENU') { toggleMenu(); return; }
    else if (word === 'ADD') {
      if (!['spotify', 'youtube', 'ytmusic', 'local'].includes(pick.kind)) { say('PICK A PLAYLIST ON THE LEFT'); return; }
      say('ADDING...'); api.listsAddCurrent(pick.kind, pick.id).then(say, () => say('COULD NOT ADD')); return;
    }
    draw();
  }
  function copy() {
    const ok = ['spotify', 'youtube', 'ytmusic', 'ytsaved', 'ytlink'].includes(pick.kind);
    if (!ok) { say('PICK A PLAYLIST'); return; }
    say(pick.kind === 'spotify' ? 'COPYING TO YOUTUBE + YT MUSIC' : 'COPYING TO SPOTIFY');
    api.listsPlay('copy-' + pick.kind, pick.id, pick.name).then(() => load(true)).catch(() => {});
  }
  // a short note in the title bar's place for a few seconds (LIKED, COPYING...)
  function say(t) {
    flash = String(t || ''); flashUntil = Date.now() + 3000;
    let f = document.getElementById('pv-flash');
    const w = win(); if (!w) return;
    if (!f) { f = document.createElement('div'); f.id = 'pv-flash'; (document.getElementById('webamp') || document.body).appendChild(f); }
    const r = root.getBoundingClientRect(), { bg, fg, cur, font } = colours();
    f.textContent = flash;
    f.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom - ROW}px;width:${r.width}px;height:${ROW}px;line-height:${ROW}px;z-index:31;background:${bg};border-top:1px solid ${fg};color:${cur};font:${FS}px ${font},Arial,sans-serif;text-align:center;pointer-events:none;`;
    setTimeout(() => { if (Date.now() >= flashUntil && f) f.remove(); }, 3100);
  }

  // ---------- keys: Cmd/Ctrl+F finds; with the pointer over the list, up / down move and Enter plays ----------
  let inside = false;
  document.addEventListener('keydown', (e) => {
    if (!root || root.style.display === 'none' || (tab !== 'playlist' && tab !== 'library')) return;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); if (find === null) press('FIND'); return; }
    if (!inside || find !== null || e.metaKey || e.ctrlKey || e.altKey) return;
    const live = (r) => r && (r.found || (r.off && !r.hint));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      let i = rHover < 0 ? rRows.findIndex((r) => r.now) : rHover;
      for (let n = 0; n < rRows.length; n++) { i += step; if (i < 0 || i >= rRows.length) return; if (live(rRows[i])) break; }
      const vis = Math.max(1, Math.floor(right.clientHeight / ROW));
      rHover = i; hoverAt = Date.now();
      if (i < rTop) rTop = i; else if (i >= rTop + vis) rTop = i - vis + 1;
      e.preventDefault(); e.stopPropagation(); draw();
    } else if (e.key === 'Enter' && live(rRows[rHover])) { e.preventDefault(); e.stopPropagation(); clickRight(rRows[rHover]); }
  }, true);

  // ---------- typing while FIND is on ----------
  document.addEventListener('keydown', (e) => {
    if (!root || root.style.display === 'none' || (find === null && !sortOpen) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { find = null; sortOpen = false; if (pick.kind === 'search') results = null; }
    else if (find === null) return;
    else if (e.key === 'Enter') {
      if (pick.kind === 'search' && find.trim()) { search(); }
      else { const r = rRows.find((x) => x.found || (x.off && !x.hint)); if (r) clickRight(r); }
    } else if (e.key === 'Backspace') find = find.slice(0, -1);
    else if (e.key.length === 1 && find.length < 40) find += e.key;
    else return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    rTop = 0; draw();
  }, true);
  async function search() {
    const p = pick; busy = true; results = null; draw();
    let res = [];
    try { res = await api.listsSearch(p.key, find.trim(), ''); } catch (err) { api.log('search failed: ' + (err && err.message)); }
    if (pick !== p) return;
    busy = false; results = res || []; draw();
  }

  let restored = false, ytmTries = 0;
  async function load(force) {
    loadedAt = Date.now();
    try { data = await api.listsAll(!!force, !!open.ytmusic); } catch (e) { api.log('playlists failed: ' + (e && e.message)); }
    // YouTube Music is read in the background: ask again shortly while it is still loading
    if (data && data.ytmusic && data.ytmusic.loading && ytmTries < 8) { ytmTries++; setTimeout(() => load(false), 4000); } else ytmTries = 0;
    if (!restored) { // open LIBRARY on the playlist that was open last time
      restored = true;
      try {
        const p = JSON.parse(localStorage.getItem('minapp.pvPick') || 'null');
        if (p && ['spotify', 'youtube', 'ytmusic', 'ytsaved', 'local'].includes(p.kind) && pick.kind === 'queue') {
          const mine = pick = { kind: p.kind, id: String(p.id || ''), name: String(p.name || '') };
          songs = null;
          api.listsSongs(mine.kind, mine.id).then((x) => { if (pick === mine) { songs = x || []; draw(); } }).catch(() => { if (pick === mine) { songs = []; draw(); } });
        }
      } catch {}
    }
    draw();
  }

  // ---------- drag the bottom edge of the playlist to make it taller or shorter (in the skin's 29 px steps) ----------
  let gripEl = null;
  function grip(w) {
    if (!gripEl) {
      gripEl = document.createElement('div'); gripEl.id = 'pv-grip'; gripEl.title = 'Drag to make the playlist taller or shorter';
      let start = null;
      gripEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const g = webamp.store.getState().windows.genWindows.playlist;
        start = { y: e.screenY, size: ((g && g.size) || [0, 0]).slice() };
        gripEl.setPointerCapture(e.pointerId);
      });
      gripEl.addEventListener('pointermove', (e) => {
        if (!start) return;
        const h = Math.max(0, Math.min(30, start.size[1] + Math.round((e.screenY - start.y) / 29)));
        const g = webamp.store.getState().windows.genWindows.playlist, sz = (g && g.size) || [0, 0];
        if (h !== sz[1]) webamp.store.dispatch({ type: 'WINDOW_SIZE_CHANGED', windowId: 'playlist', size: [sz[0], h] });
      });
      const end = () => { start = null; };
      gripEl.addEventListener('pointerup', end); gripEl.addEventListener('pointercancel', end);
      gripEl.addEventListener('mousedown', (e) => e.stopPropagation());
      (document.getElementById('webamp') || document.body).appendChild(gripEl);
    }
    const r = w.getBoundingClientRect();
    gripEl.style.cssText = `position:fixed;left:${r.left}px;top:${r.bottom - 4}px;width:${r.width - 20}px;height:7px;z-index:33;cursor:ns-resize;`;
  }

  // ---------- the black box and the timer at the bottom of the window ----------
  // the box shows the player's visualizer; the timer shows how far into the playing song we are, out of its length
  let mirror = null, mirrorAt = 0, timeKey = '';
  function extras() {
    const w = win(); if (!w) return;
    const box = w.querySelector('.playlist-visualizer');
    if (box && !box.querySelector('canvas:not(#pv-vis)')) {
      if (!mirror || !box.contains(mirror)) { mirror = document.createElement('canvas'); mirror.id = 'pv-vis'; mirror.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated;pointer-events:none;'; box.style.position = box.style.position || 'absolute'; box.appendChild(mirror); requestAnimationFrame(mirrorFrame); }
    }
    const t = w.querySelector('.playlist-running-time-display');
    if (t) {
      let el = t.querySelector('#pv-time');
      if (!el) { el = document.createElement('div'); el.id = 'pv-time'; t.appendChild(el); timeKey = ''; }
      let pos = 0, len = 0;
      try { const m = webamp.store.getState().media; pos = m.timeElapsed || 0; len = m.length || 0; } catch {}
      if (!len && queue.cur) len = queue.cur.duration || 0;
      const txt = `${mmss(pos) || '0:00'}/${mmss(len) || '0:00'}`;
      if (txt !== timeKey) {
        timeKey = txt; el.textContent = '';
        for (const ch of txt) { const sp = document.createElement('span'); sp.className = 'character character-' + ch.toLowerCase().charCodeAt(0); sp.textContent = ch; el.appendChild(sp); }
      }
    }
  }
  function mirrorFrame(ts) {
    if (!mirror || !mirror.isConnected) { mirror = null; return; }
    requestAnimationFrame(mirrorFrame);
    if (document.hidden || ts - mirrorAt < 33) return;
    mirrorAt = ts;
    const src = document.querySelector('#webamp #main-window canvas#visualizer') || document.querySelector('#webamp #main-window canvas');
    const r = mirror.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (mirror.width !== Math.round(r.width)) { mirror.width = Math.round(r.width); mirror.height = Math.round(r.height); }
    const g = mirror.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, mirror.width, mirror.height);
    if (src && src.width) try { g.drawImage(src, 0, 0, src.width, src.height, 0, 0, mirror.width, mirror.height); } catch {}
  }

  // ---------- MENU: the app menu in the skin's look; click MENU again, click outside or press Esc to close ----------
  let menuEl = null, menuItems = [], menuTop = 0, menuOpenSubs = new Set(), menuHover = -1;
  function toggleMenu() { if (menuOpen) closeMenu(); else openMenu(); }
  function closeMenu() { menuOpen = false; if (menuEl) menuEl.remove(); menuEl = null; buttons(true); }
  async function openMenu() {
    menuOpen = true; menuTop = 0; menuOpenSubs = new Set(); buttons(true);
    try { menuItems = await api.menuItems(); } catch { menuItems = []; }
    if (!menuOpen) return;
    drawMenu();
  }
  function menuRows() {
    const out = [];
    const walk = (items, depth, path) => items.forEach((m, i) => {
      const key = path + '/' + i;
      out.push({ ...m, depth, key });
      if (m.sub && menuOpenSubs.has(key)) walk(m.sub, depth + 1, key);
    });
    walk(menuItems || [], 0, '');
    return out;
  }
  function drawMenu() {
    const a = btnEls.MENU && btnEls.MENU.getBoundingClientRect(), w = win();
    if (!a || !w) return;
    const { bg, fg, cur, font } = colours(), rows = menuRows();
    if (!menuEl) {
      menuEl = document.createElement('div'); menuEl.id = 'pv-menu';
      menuEl.addEventListener('mousedown', (e) => e.stopPropagation());
      menuEl.addEventListener('wheel', (e) => { e.preventDefault(); menuTop += e.deltaY > 0 ? 3 : -3; drawMenu(); }, { passive: false });
      menuEl.addEventListener('mousemove', (e) => { const d = e.target.closest && e.target.closest('[data-i]'), i = d ? Number(d.dataset.i) : -1; if (i !== menuHover) { menuHover = i; drawMenu(); } });
      menuEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = e.target.closest && e.target.closest('[data-i]'); if (!d) return;
        const m = menuRows()[Number(d.dataset.i)]; if (!m || m.off || m.sep) return;
        if (m.sub) { if (menuOpenSubs.has(m.key)) menuOpenSubs.delete(m.key); else menuOpenSubs.add(m.key); drawMenu(); return; }
        if (m.id !== undefined) { api.menuPick(m.id); closeMenu(); }
      });
      (document.getElementById('webamp') || document.body).appendChild(menuEl);
    }
    const width = 190, room = Math.max(ROW * 4, Math.floor((a.top - 2) / ROW) * ROW);
    const vis = Math.min(rows.length, Math.floor(room / ROW));
    menuTop = Math.max(0, Math.min(menuTop, rows.length - vis));
    const left = Math.max(0, a.right - width);
    menuEl.style.cssText = `position:fixed;left:${left}px;top:${a.top - vis * ROW - 4}px;width:${width}px;height:${vis * ROW + 2}px;z-index:40;background:${bg};border:1px solid ${fg};box-sizing:content-box;font:${FS}px/${ROW}px ${font},Arial,sans-serif;color:${fg};overflow:hidden;user-select:none;box-shadow:0 0 0 1px rgba(0,0,0,.6);`;
    menuEl.textContent = '';
    rows.slice(menuTop, menuTop + vis).forEach((m, i) => {
      const d = document.createElement('div'), at = menuTop + i;
      d.dataset.i = String(at);
      const on = at === menuHover && !m.off && !m.sep;
      d.style.cssText = `position:absolute;left:0;right:0;top:${i * ROW + 1}px;height:${ROW}px;padding:0 6px 0 ${6 + m.depth * 10}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-sizing:border-box;` +
        (m.sep ? '' : `color:${on ? cur : fg};cursor:${m.off ? 'default' : 'pointer'};`) + (m.off ? 'opacity:.5;' : '');
      if (m.sep) { const l = document.createElement('div'); l.style.cssText = `position:absolute;left:6px;right:6px;top:${ROW / 2}px;height:1px;background:${fg};opacity:.4;`; d.appendChild(l); }
      else d.textContent = (m.tick ? (m.on ? '\u2022 ' : '   ') : '') + m.label + (m.sub ? (menuOpenSubs.has(m.key) ? '  \u25be' : '  \u25b8') : '');
      menuEl.appendChild(d);
    });
  }
  document.addEventListener('mousedown', (e) => { if (menuOpen && !(menuEl && menuEl.contains(e.target)) && e.target !== btnEls.MENU) closeMenu(); }, true);
  document.addEventListener('keydown', (e) => { if (menuOpen && e.key === 'Escape') { closeMenu(); e.preventDefault(); } }, true);

  // called with every poll: played songs, the playing one and the ones up next
  function setQueue(hist, cur, q) {
    const pickQ = (x) => ({ artist: x.artist || '', title: x.title || '', duration: x.duration || 0, hint: !!x.hint });
    queue = { hist: (hist || []).map(pickQ), cur: cur && cur.title ? pickQ(cur) : null, q: (q || []).map(pickQ) };
    const sig = JSON.stringify(queue);
    if (sig === qSig) return;
    const first = !qSig; qSig = sig;
    if (root && (pick.kind === 'queue' || tab === 'playlist')) {
      buildRight();
      const i = rRows.findIndex((r) => r.now), vis = Math.floor(right.clientHeight / ROW) || 4;
      if (i >= 0 && (first || i < rTop || i >= rTop + vis)) rTop = Math.max(0, i - 1);
      draw();
    }
  }

  // the first time after this update: show the playlist window (it was hidden while the queue lived elsewhere)
  setTimeout(() => {
    try {
      if (localStorage.getItem('minapp.pvShown')) return;
      localStorage.setItem('minapp.pvShown', '1');
      const g = webamp.store.getState().windows.genWindows.playlist;
      if (g && !g.open) webamp.store.dispatch({ type: 'TOGGLE_WINDOW', windowId: 'playlist' });
    } catch {}
  }, 2500);
  setInterval(() => { if (!document.hidden) place(); }, 250);
  setInterval(() => { if (root && find !== null && !document.hidden) draw(); }, 500); // the blinking cursor
  window.__playlistView = { setQueue, load, draw, tab: setTab };
}
