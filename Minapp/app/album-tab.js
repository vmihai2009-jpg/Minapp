// Album tab: a small pixelated picture of what is playing (Spotify album cover, YouTube thumbnail), attached to the
// left of the player like Milkdrop is attached to the right. Click the song title or the timer to show or hide it.
// The picture is drawn at 64 x 64 pixels with a slightly reduced palette, for a retro look that stays readable.
const SIZE = 64, GRID = 64, LEVELS = 8, BORDER = 2, TAB = SIZE + 2 * BORDER;

export function initAlbumTab(webamp, api, getWidgetMode) {
  let open = false, tab = null, canvas = null, url = null, token = 0;
  try { open = localStorage.getItem('minapp.albumTab') === '1'; } catch {}

  const colours = () => {
    const st = (() => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } })();
    return st.normalbg || '#000';
  };

  function ensure() {
    if (tab) return;
    tab = document.createElement('div');
    tab.id = 'album-tab';
    const bg = colours();
    tab.style.cssText = `position:fixed;left:0;top:0;width:${TAB}px;height:${TAB}px;box-sizing:border-box;z-index:40;background:${bg};` +
      `padding:${BORDER - 1}px;user-select:none;cursor:pointer;` +
      'border:1px solid;border-color:rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);' +
      `box-shadow:inset 0 0 0 1px ${bg},inset 0 0 0 2px rgba(0,0,0,.45);`;
    canvas = document.createElement('canvas');
    canvas.width = canvas.height = GRID;
    canvas.style.cssText = `width:${SIZE}px;height:${SIZE}px;image-rendering:pixelated;display:block;opacity:.92;`;
    tab.appendChild(canvas);
    tab.title = 'Click to hide the picture';
    tab.addEventListener('mousedown', (e) => e.stopPropagation());
    tab.addEventListener('click', () => set(false));
    (document.getElementById('webamp') || document.body).appendChild(tab);
    blank();
  }

  function blank() { // nothing to show yet: a dim checkerboard
    const g = canvas.getContext('2d');
    for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) { g.fillStyle = (x + y) % 2 ? '#3a3a3a' : '#555'; g.fillRect(x, y, 1, 1); }
  }

  function paint(dataUrl) {
    const img = new Image();
    const mine = ++token;
    img.onload = () => {
      if (mine !== token || !canvas) return;
      const s = Math.min(img.naturalWidth, img.naturalHeight); // centre square (YouTube thumbnails are wide)
      const g = canvas.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, GRID, GRID);
      const d = g.getImageData(0, 0, GRID, GRID), p = d.data, q = 255 / (LEVELS - 1);
      for (let i = 0; i < p.length; i += 4) for (let k = 0; k < 3; k++) p[i + k] = Math.round(p[i + k] / q) * q; // fewer colours
      g.putImageData(d, 0, 0);
    };
    img.onerror = () => { api.log('album tab: picture could not be decoded'); blank(); };
    img.src = dataUrl;
  }

  function set(on) {
    open = on;
    try { localStorage.setItem('minapp.albumTab', on ? '1' : '0'); } catch {}
    if (on) { ensure(); tab.style.display = ''; if (url) load(url, true); }
    else if (tab) tab.style.display = 'none';
  }

  async function load(u, force) {
    if (!open || !canvas) return;
    if (!u) { token++; blank(); return; }
    try {
      const d = await api.artGet(u);
      if (d && u === url) paint(d); else if (!d) { api.log('album tab: no picture for ' + u); blank(); }
    } catch (e) { api.log('album tab error: ' + (e && e.message)); blank(); }
  }

  function setArt(u) {
    const next = u === null ? '' : u;
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

  window.__albumTab = {
    setArt,
    // how far the player is pushed right to make room for the tab
    offset: () => (open && tab && getWidgetMode() === 'off' ? TAB : 0),
  };
  if (open) ensure();
}
