// Libraries panel: tucked under the album picture, on the left of the player. LIBRARIES opens Spotify, YouTube and
// Local folders (+ closed / - open), each with its playlists underneath; a click plays one. The magnifier at the right
// of a folder searches that library: type, Enter, click a result to play it. Drawn in the skin's song-title
// font and playlist colours, like the rest of the player. It shows whenever the album picture does.
import { setText } from './download-bar.js';

const W = 96, ROW = 9, PAD = 4, CW = 16, HEAD = 13; // CW: letters per line; HEAD: the closed panel's height

export function initListsTab(webamp, api, getWidgetMode) {
  let copyFrom = '', panel = null, data = null, rows = [], top = 0, hover = -1, vis = 0, skinKey = '', loadedAt = 0;
  const open = { libs: false, spotify: true, youtube: false, local: false };
  let search = null; // { key, q, results, busy } while a library is being searched
  try { Object.assign(open, JSON.parse(localStorage.getItem('minapp.listsOpen') || '{}')); } catch {}
  const skin = () => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } };
  const cut = (t, n) => (t.length > n ? t.slice(0, Math.max(0, n - 1)) + '.' : t);

  function build() {
    rows = [{ t: `${open.libs ? '-' : '+'} LIBRARIES`, folder: 'libs' }];
    if (!open.libs) return;
    const folder = (key, label, list, empty) => {
      rows.push({ t: `${open[key] ? '-' : '+'} ${label}`, folder: key, indent: 1, find: !copyFrom });
      if (!open[key]) return;
      if (search && search.key === key) { // the search line, then what it found
        rows.push({ t: '?' + search.q + (Date.now() % 1000 < 550 ? '_' : ' '), input: true, indent: 2 });
        if (search.busy) rows.push({ t: 'Searching...', dim: true, indent: 2 });
        else if (search.results) { for (const r of search.results) rows.push({ ...r, indent: 2 }); if (!search.results.length) rows.push({ t: 'Nothing found', dim: true, indent: 2 }); }
        else rows.push({ t: 'Type, then Enter', dim: true, indent: 2 });
        rows.push({ t: '[ Close search ]', act: 'endsearch', indent: 2 });
        return;
      }
      if (!data) { rows.push({ t: 'Loading...', dim: true, indent: 2 }); return; }
      for (const r of list) rows.push({ ...r, indent: 2 });
      if (!list.length && empty) rows.push({ t: empty, dim: true, indent: 2 });
    };
    const sp = data && data.spotify;
    let spl = [];
    if (sp && sp.status === 'ok') spl = [{ t: 'Liked songs', kind: 'spotify', id: `spotify:user:${sp.userId}:collection` }, ...sp.items.map((p) => ({ t: p.name, kind: 'spotify', id: 'spotify:playlist:' + p.id }))];
    else if (sp && (sp.status === 'login' || sp.status === 'rescope')) spl = [{ t: '[ Connect ]', kind: 'spotconnect' }];
    if (copyFrom) { rows.push({ t: 'PICK ONE TO COPY', bright: true }); rows.push({ t: '[ Cancel ]', act: 'cancel' }); }
    // copying: only the playlists of the chosen side can be picked
    const pick = (list, side) => (copyFrom ? list.filter((r) => r.kind && (side === copyFrom ? r.kind !== 'spotconnect' && r.kind !== 'ytsignin' : false)).map((r) => ({ ...r, copy: true })) : list);
    if (sp && sp.status === 'ok' && !copyFrom) spl.push({ t: '[ Copy to YouTube ]', act: 'spotify' });
    folder('spotify', 'SPOTIFY', pick(spl, 'spotify'), copyFrom ? '' : 'Could not load');
    const yt = data && data.youtube;
    const ytl = [];
    if (yt) {
      if (yt.link) ytl.push({ t: yt.link, kind: 'ytlink' });
      for (const p of yt.items) ytl.push({ t: p.name, kind: 'youtube', id: p.id });
      for (const p of yt.saved || []) ytl.push({ t: p.name, kind: 'ytsaved', id: p.name });
      if (!yt.signedIn) ytl.push({ t: '[ Sign in ]', kind: 'ytsignin' });
      if (!copyFrom && ytl.some((r) => r.kind === 'youtube' || r.kind === 'ytlink' || r.kind === 'ytsaved')) ytl.push({ t: '[ Copy to Spotify ]', act: 'youtube' });
    }
    folder('youtube', 'YOUTUBE', pick(ytl, 'youtube'), yt && yt.loading ? 'Loading...' : 'No playlists');
    if (!copyFrom) folder('local', 'LOCAL', ((data && data.local) || []).map((p) => ({ t: p.name, kind: 'local', id: p.name })), 'No local playlists');
  }

  function draw() {
    if (!panel) return;
    const st = skin(), sel = st.selectedbg || '#0000c6', hi = st.current || '#fff';
    const body = panel.firstChild;
    body.textContent = '';
    const maxTop = Math.max(0, rows.length - vis);
    top = Math.max(0, Math.min(top, maxTop));
    rows.slice(top, top + vis).forEach((r, i) => {
      const d = document.createElement('div');
      d.dataset.i = String(top + i);
      const live = r.kind || r.folder || r.act;
      d.style.cssText = `position:absolute;left:0;right:0;top:${i * ROW}px;height:${ROW}px;` + (live ? 'cursor:pointer;' : '') +
        (live && top + i === hover ? `background:${sel};` : '') + (r.dim ? 'opacity:.6;' : '') + (r.folder || r.bright ? 'filter:brightness(1.35);' : '');
      const t = document.createElement('div');
      t.style.cssText = `position:absolute;left:${PAD + (r.indent || 0) * 5}px;top:1px;height:6px;white-space:nowrap;`;
      setText(t, cut(r.t, CW - (r.indent || 0) - (r.find ? 2 : 0)));
      d.appendChild(t);
      if (r.find) { // magnifier: a 5 px ring with a handle, in the text colour
        const m = document.createElement('canvas'); m.width = 7; m.height = 7; m.className = 'lt-find'; m.title = 'Search ' + r.folder;
        m.style.cssText = `position:absolute;right:${PAD + 2}px;top:1px;width:7px;height:7px;cursor:pointer;`;
        const mg = m.getContext('2d'); mg.fillStyle = st.normal || '#00ff00';
        [[1, 0], [2, 0], [3, 0], [0, 1], [4, 1], [0, 2], [4, 2], [0, 3], [4, 3], [1, 4], [2, 4], [3, 4], [4, 5], [5, 5], [5, 6], [6, 6]].forEach(([x, y]) => mg.fillRect(x, y, 1, 1));
        d.appendChild(m);
      }
      body.appendChild(d);
    });
    const bar = panel.lastChild;
    bar.style.display = maxTop ? '' : 'none';
    if (maxTop) { const h = vis * ROW, th = Math.max(8, Math.round(h * vis / rows.length)); bar.style.cssText = `position:absolute;right:2px;width:2px;height:${th}px;top:${4 + Math.round((h - th) * top / maxTop)}px;background:${hi};opacity:.5;`; }
  }

  async function load(force) {
    loadedAt = Date.now();
    try { data = await api.listsAll(force); } catch (e) { api.log('playlist panel: ' + (e && e.message)); }
    build(); draw();
  }

  function ensure() {
    if (panel) return;
    panel = document.createElement('div');
    panel.id = 'lists-tab';
    panel.innerHTML = '<div style="position:absolute;left:0;right:0;top:2px;bottom:2px;overflow:hidden"></div><div></div>';
    const body = panel.firstChild;
    const rowOf = (e) => { const d = e.target.closest && e.target.closest('[data-i]'); return d ? Number(d.dataset.i) : -1; };
    body.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== hover) { hover = i; draw(); } });
    body.addEventListener('mouseleave', () => { hover = -1; draw(); });
    body.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = rows[rowOf(e)]; if (!r) return;
      if (r.find && e.target.classList.contains('lt-find')) { search = { key: r.folder, q: '', results: null }; open[r.folder] = true; build(); draw(); return; }
      if (r.act === 'endsearch') { search = null; build(); draw(); return; }
      if (r.found) { api.listsFound(r.found).catch((err) => api.log('play result failed: ' + (err && err.message))); return; }
      if (r.folder) { open[r.folder] = !open[r.folder]; if (r.folder === 'libs') skinKey = ''; try { localStorage.setItem('minapp.listsOpen', JSON.stringify(open)); } catch {} build(); draw(); return; }
      if (r.act === 'cancel') { copyFrom = ''; build(); draw(); return; }
      if (r.act) { copyFrom = r.act; open[r.act] = true; build(); draw(); return; }
      if (r.copy) { copyFrom = ''; build(); draw(); api.listsPlay('copy-' + r.kind, r.id || '', r.t).then(() => load(true)).catch((err) => api.log('copy failed: ' + (err && err.message))); return; }
      if (r.kind) api.listsPlay(r.kind, r.id || '').catch((err) => api.log('play from panel failed: ' + (err && err.message)));
    });
    panel.addEventListener('wheel', (e) => { e.preventDefault(); top += e.deltaY > 0 ? 2 : -2; draw(); }, { passive: false });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    (document.getElementById('webamp') || document.body).appendChild(panel);
    build(); load(false);
  }

  // fills the space left of the windows stacked under the player (or a few rows when there are none)
  function place() {
    const art = document.getElementById('album-tab');
    const show = !!(art && art.style.display !== 'none' && getWidgetMode() === 'off');
    if (!show) { if (panel) panel.style.display = 'none'; return; }
    ensure();
    const a = art.getBoundingClientRect();
    let bottom = a.bottom;
    for (const s of ['#equalizer-window', '#playlist-window', '#dl-panel', '#info-tab']) {
      const el = document.querySelector(s); const r = el && el.getBoundingClientRect();
      if (r && r.width && r.height && el.style.display !== 'none') bottom = Math.max(bottom, r.bottom);
    }
    // it starts HEAD px up, over the foot of the album picture, so that closed it ends level with the player
    const y0 = a.bottom - HEAD, h = open.libs ? Math.max(8 * ROW + 8, Math.round(bottom - y0)) : HEAD, v = Math.max(1, Math.floor((h - 4) / ROW));
    const st = skin(), bg = st.normalbg || '#000', key = [a.left, y0, a.width, h, bg].join();
    if (key !== skinKey) {
      skinKey = key;
      panel.style.cssText = `position:fixed;left:${a.left}px;top:${y0}px;width:${a.width}px;height:${h}px;box-sizing:border-box;z-index:40;background:${bg};user-select:none;` +
        'border:1px solid;border-color:rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);' +
        `box-shadow:inset 0 0 0 1px ${bg},inset 0 0 0 2px rgba(0,0,0,.45);` + (a.width > W + 1 ? '' : '');
      if (v !== vis) { vis = v; draw(); }
    }
    if (Date.now() - loadedAt > 5 * 60000) load(false); // playlists change now and then
  }
  // typing while a search is open: the letters go into the search line, not to the player's own shortcuts
  document.addEventListener('keydown', (e) => {
    if (!search || !panel || panel.style.display === 'none' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') search = null;
    else if (e.key === 'Enter') { if (search.q.trim()) run(); }
    else if (e.key === 'Backspace') search.q = search.q.slice(0, -1);
    else if (e.key.length === 1 && search.q.length < 40) search.q += e.key;
    else return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    build(); draw();
  }, true);
  async function run() {
    const s = search; s.busy = true; s.results = null; build(); draw();
    let res = [];
    try { res = await api.listsSearch(s.key, s.q.trim()); } catch (err) { api.log('search failed: ' + (err && err.message)); }
    if (search !== s) return;
    s.busy = false; s.results = (res || []).map((x) => ({ t: x.t, found: x, dim: false }));
    build(); draw();
  }
  setInterval(() => { if (search && open.libs && panel && !document.hidden) { build(); draw(); } }, 500); // the blinking cursor
  setInterval(() => { if (!document.hidden) place(); }, 300);
  window.__listsTab = { load, place };
}
