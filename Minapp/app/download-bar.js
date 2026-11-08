// Download progress panel: a strip under the player, drawn with the current skin's own pieces: the song-title font
// (TEXT.BMP), the position bar and its slider (POSBAR.BMP), the pause/play/stop buttons (CBUTTONS.BMP) and the
// playlist colours. It appears while the record button is saving a YouTube link and goes away when it is done.
const W = 275, H = 40, BAR_W = 200, THUMB_W = 29, TEXT_W = 259, PCT_CHARS = 4;

// the skin's images live in Webamp's generated style sheet; copy the ones we need onto our own classes
export function skinImage(selector) {
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r.selectorText === selector && r.style && r.style.backgroundImage) return r.style.backgroundImage;
    }
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
  let panel = null, style = null, info = null, skinKey = null, offset = 0, scrollText = '';

  function buildStyle() {
    const st = (() => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } })();
    const bg = st.normalbg || '#000', fg = st.normal || '#00ff00', hi = st.current || '#ffffff';
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
    if (key !== skinKey) { skinKey = key; setTimeout(buildStyle, 300); }
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
