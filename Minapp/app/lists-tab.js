// Playlist panel: under the album picture, on the left of the player. Folders for Spotify, YouTube and the local
// library (+ closed / - open), each with its playlists underneath; a click plays one. Drawn in the skin's song-title
// font and playlist colours, like the rest of the player. It shows whenever the album picture does.
import { setText } from './download-bar.js';

const W = 96, ROW = 9, PAD = 4, CW = 16; // CW: letters per line

export function initListsTab(webamp, api, getWidgetMode) {
  let copyFrom = '', panel = null, data = null, rows = [], top = 0, hover = -1, vis = 0, skinKey = '', loadedAt = 0;
  const open = { spotify: true, youtube: false, local: false };
  try { Object.assign(open, JSON.parse(localStorage.getItem('minapp.listsOpen') || '{}')); } catch {}
  const skin = () => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } };
  const cut = (t, n) => (t.length > n ? t.slice(0, Math.max(0, n - 1)) + '.' : t);

  function build() {
    rows = [];
    const folder = (key, label, list, empty) => {
      rows.push({ t: `${open[key] ? '-' : '+'} ${label}`, folder: key });
      if (!open[key]) return;
      if (!data) { rows.push({ t: 'Loading...', dim: true, indent: true }); return; }
      for (const r of list) rows.push({ ...r, indent: true });
      if (!list.length) rows.push({ t: empty, dim: true, indent: true });
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
    if (data && data.local.length && !copyFrom) folder('local', 'LOCAL', data.local.map((p) => ({ t: p.name, kind: 'local', id: p.name })), '');
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
      t.style.cssText = `position:absolute;left:${PAD + (r.indent ? 5 : 0)}px;top:1px;height:6px;white-space:nowrap;`;
      setText(t, cut(r.t, CW - (r.indent ? 1 : 0)));
      d.appendChild(t); body.appendChild(d);
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
    panel.innerHTML = '<div style="position:absolute;left:0;right:0;top:4px;bottom:4px;overflow:hidden"></div><div></div>';
    const body = panel.firstChild;
    const rowOf = (e) => { const d = e.target.closest && e.target.closest('[data-i]'); return d ? Number(d.dataset.i) : -1; };
    body.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== hover) { hover = i; draw(); } });
    body.addEventListener('mouseleave', () => { hover = -1; draw(); });
    body.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = rows[rowOf(e)]; if (!r) return;
      if (r.folder) { open[r.folder] = !open[r.folder]; try { localStorage.setItem('minapp.listsOpen', JSON.stringify(open)); } catch {} build(); draw(); return; }
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
    const h = Math.max(6 * ROW + 8, Math.round(bottom - a.bottom)), v = Math.floor((h - 8) / ROW);
    const st = skin(), bg = st.normalbg || '#000', key = [a.left, a.bottom, a.width, h, bg].join();
    if (key !== skinKey) {
      skinKey = key;
      panel.style.cssText = `position:fixed;left:${a.left}px;top:${a.bottom}px;width:${a.width}px;height:${h}px;box-sizing:border-box;z-index:40;background:${bg};user-select:none;` +
        'border:1px solid;border-color:rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);' +
        `box-shadow:inset 0 0 0 1px ${bg},inset 0 0 0 2px rgba(0,0,0,.45);` + (a.width > W + 1 ? '' : '');
      if (v !== vis) { vis = v; draw(); }
    }
    if (Date.now() - loadedAt > 5 * 60000) load(false); // playlists change now and then
  }
  setInterval(() => { if (!document.hidden) place(); }, 300);
  window.__listsTab = { load, place };
}
