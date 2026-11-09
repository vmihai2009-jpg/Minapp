// Spotify playlist picker. Pressing LIST in the playlist window opens a folder-style list of your Spotify playlists,
// drawn like the rest of the player: the skin's song-title font (TEXT.BMP) and the playlist colours. Click a playlist
// to play it, click a folder line to open or close it, scroll with the mouse wheel, close with X, Esc or a click outside.
import { setText } from './download-bar.js';

const PAD = 7, ROW = 9, HEAD = 20, MIN_ROWS = 8;

export function initPlaylistPicker(webamp, api) {
  let panel = null, data = null, rows = [], open = { liked: true, mine: true, saved: false }, top = 0, hover = -1, vis = 8, cw = 52;

  const skinColours = () => {
    const st = (() => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } })();
    return { bg: st.normalbg || '#000', hi: st.current || '#fff', sel: st.selectedbg || '#0000c6' };
  };
  const isSpotify = () => (document.documentElement.dataset.source || 'spotify') === 'spotify';
  const cut = (t, n) => (t.length > n ? t.slice(0, Math.max(0, n - 1)) + '.' : t);

  function close() { if (panel) panel.remove(); panel = null; document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onOutside, true); }
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  const onOutside = (e) => { if (panel && !panel.contains(e.target) && !(e.target.closest && e.target.closest('#playlist-list-menu'))) close(); };

  // the lines to show: folders (+ closed / - open) with their playlists indented underneath
  function build() {
    rows = [];
    if (!data) { rows.push({ t: 'Loading your playlists...', dim: true }); return; }
    if (data.status === 'login' || data.status === 'rescope') {
      rows.push({ t: data.status === 'login' ? 'Spotify is not connected yet.' : 'Spotify needs to be connected again', dim: true });
      if (data.status === 'rescope') rows.push({ t: 'so it can read your playlists.', dim: true });
      rows.push({ t: '' });
      rows.push({ t: '[ Click here to connect Spotify ]', act: 'connect' });
      return;
    }
    if (data.status === 'error') { rows.push({ t: 'Could not load playlists:', dim: true }); rows.push({ t: data.message || 'unknown error', dim: true }); rows.push({ t: '' }); rows.push({ t: '[ Try again ]', act: 'retry' }); return; }
    const mine = data.items.filter((p) => p.mine), saved = data.items.filter((p) => !p.mine);
    const folder = (key, label, list) => {
      rows.push({ t: `${open[key] ? '-' : '+'} ${label} (${list.length})`, folder: key });
      if (open[key]) for (const p of list) rows.push({ t: p.name, n: p.tracks, uri: 'spotify:playlist:' + p.id, indent: true });
      if (open[key] && !list.length) rows.push({ t: '(empty)', dim: true, indent: true });
    };
    rows.push({ t: '  Liked songs', uri: `spotify:user:${data.userId}:collection`, n: null });
    folder('mine', 'MY PLAYLISTS', mine);
    folder('saved', 'SAVED FROM OTHERS', saved);
  }

  function draw() {
    if (!panel) return;
    const body = panel.querySelector('.pp-body');
    body.textContent = '';
    const maxTop = Math.max(0, rows.length - vis);
    top = Math.max(0, Math.min(top, maxTop));
    rows.slice(top, top + vis).forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'pp-row';
      d.dataset.i = String(top + i);
      d.style.cssText = `position:absolute;left:0;right:0;top:${i * ROW}px;height:${ROW}px;padding:1px ${PAD}px 0;box-sizing:border-box;` +
        ((r.uri || r.folder || r.act) ? 'cursor:pointer;' : '') + (r.dim ? 'opacity:.7;' : '') + (r.folder ? 'filter:brightness(1.35);' : '');
      if (top + i === hover && (r.uri || r.folder || r.act)) d.style.background = skinColours().sel;
      const room = cw - (r.indent ? 2 : 0) - (r.n != null ? String(r.n).length + 1 : 0);
      const name = document.createElement('div'); name.style.cssText = `position:absolute;left:${PAD + (r.indent ? 10 : 0)}px;top:1px;height:6px;white-space:nowrap;`;
      setText(name, cut(r.t, room)); d.appendChild(name);
      if (r.n != null) {
        const n = document.createElement('div'); n.style.cssText = `position:absolute;right:${PAD + 6}px;top:1px;height:6px;white-space:nowrap;`;
        setText(n, String(r.n)); d.appendChild(n);
      }
      body.appendChild(d);
    });
    // scroll marker on the right edge
    const bar = panel.querySelector('.pp-bar');
    bar.style.display = maxTop ? 'block' : 'none';
    if (maxTop) {
      const h = vis * ROW, th = Math.max(12, Math.round(h * vis / rows.length));
      bar.firstChild.style.cssText = `position:absolute;left:0;width:3px;height:${th}px;top:${Math.round((h - th) * top / maxTop)}px;background:${skinColours().hi};opacity:.5;`;
    }
  }

  function act(r) {
    if (!r) return;
    if (r.folder) { open[r.folder] = !open[r.folder]; build(); draw(); return; }
    if (r.act === 'connect') { api.spotConnect(); close(); return; }
    if (r.act === 'retry') { load(true); return; }
    if (r.uri) {
      api.spotPlayList(r.uri).catch((e) => api.log('play playlist failed: ' + (e && e.message)));
      close();
    }
  }

  async function load(force) {
    data = null; build(); draw();
    try { data = await api.spotLists(force); } catch (e) { data = { status: 'error', message: String((e && e.message) || e) }; }
    build(); draw();
  }

  function show() {
    close();
    const pl = document.querySelector('#playlist-window');
    if (!pl) return;
    const { bg, hi } = skinColours();
    const host = document.getElementById('webamp') || document.body;
    const r = pl.getBoundingClientRect();
    const scale = pl.offsetWidth ? r.width / pl.offsetWidth : 1; // the player may be zoomed
    const W = pl.offsetWidth || 275;
    vis = Math.max(MIN_ROWS, Math.floor(((pl.offsetHeight || 116) - HEAD - 6) / ROW));
    cw = Math.floor((W - 2 * PAD - 12) / 5);
    const H = HEAD + vis * ROW + 6;
    panel = document.createElement('div');
    panel.id = 'playlist-picker';
    panel.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${W}px;height:${H}px;transform:scale(${scale});transform-origin:0 0;` +
      `box-sizing:border-box;z-index:60;background:${bg};user-select:none;` +
      'border:1px solid;border-color:rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);' +
      `box-shadow:inset 0 0 0 1px ${bg},inset 0 0 0 2px rgba(0,0,0,.45);`;
    panel.innerHTML = '<div class="pp-title" style="position:absolute;left:0;top:0;right:0;height:16px"></div>' +
      `<div style="position:absolute;left:${PAD}px;right:${PAD}px;top:14px;height:1px;background:${hi};opacity:.45"></div>` +
      `<div class="pp-body" style="position:absolute;left:0;right:0;top:${HEAD}px;height:${vis * ROW}px;overflow:hidden"></div>` +
      `<div class="pp-bar" style="position:absolute;right:3px;top:${HEAD}px;width:3px;height:${vis * ROW}px"><div></div></div>`;
    const title = panel.querySelector('.pp-title');
    const t = document.createElement('div'); t.style.cssText = `position:absolute;left:${PAD}px;top:5px;height:6px;white-space:nowrap`; setText(t, 'Your Spotify playlists'); title.appendChild(t);
    const x = document.createElement('div'); x.style.cssText = `position:absolute;right:${PAD}px;top:5px;height:6px;cursor:pointer`; x.title = 'Close'; setText(x, 'X'); title.appendChild(x);
    x.addEventListener('click', (e) => { e.stopPropagation(); close(); });
    const body = panel.querySelector('.pp-body');
    const rowOf = (e) => { const d = e.target.closest && e.target.closest('.pp-row'); return d ? Number(d.dataset.i) : -1; };
    body.addEventListener('mousemove', (e) => { const i = rowOf(e); if (i !== hover) { hover = i; draw(); } });
    body.addEventListener('mouseleave', () => { hover = -1; draw(); });
    body.addEventListener('click', (e) => { e.stopPropagation(); act(rows[rowOf(e)]); });
    panel.addEventListener('wheel', (e) => { e.preventDefault(); top += e.deltaY > 0 ? 3 : -3; draw(); }, { passive: false });
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    host.appendChild(panel);
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
    top = 0; hover = -1;
    load(false);
  }

  // LIST in the playlist window: this picker while Spotify is the source; the other sources keep Webamp's own menu
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  const onList = (e) => e.target.closest && e.target.closest('#playlist-list-menu');
  ['mousedown', 'mouseup'].forEach((ev) => document.addEventListener(ev, (e) => { if (onList(e) && isSpotify()) swallow(e); }, true));
  document.addEventListener('click', (e) => {
    if (!onList(e) || !isSpotify()) return;
    swallow(e);
    if (panel) close(); else show();
  }, true);

  // test hook (no effect on normal use)
  window.__playlistPicker = { show, close };
}
