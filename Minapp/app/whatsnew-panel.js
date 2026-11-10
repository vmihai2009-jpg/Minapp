// "What's new" pop-up after an update, drawn like the rest of the player: the skin's song-title font (TEXT.BMP), the
// playlist colours, with a close mark. It opens under the player and closes with its X or a click.
import { setText, textBg } from './download-bar.js';

const MAX_LINES = 26, W = 275, PAD = 7, CHARS = Math.floor((W - 2 * PAD) / 5); // 52 characters of 5 px per line

function wrap(text, width) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if ((line + ' ' + word).length <= width) line += ' ' + word;
      else { out.push(line); line = '  ' + word; } // continued lines are indented under their bullet
    }
    out.push(line);
  }
  return out;
}

export function initWhatsNew(webamp, api) {
  api.onWhatsNew(({ version, sections }) => {
    document.getElementById('whatsnew-panel')?.remove();
    const st = (() => { try { return webamp.store.getState().display.skinPlaylistStyle || {}; } catch { return {}; } })();
    const bg = textBg(st.normalbg || '#000'), hi = st.current || '#fff';
    const lines = [];
    for (const s of sections) {
      lines.push({ t: `Version ${s.version}`, head: true });
      for (const item of s.items) wrap('- ' + item, CHARS).forEach((t) => lines.push({ t }));
      lines.push({ t: '' });
    }
    lines.pop();
    const panel = document.createElement('div');
    panel.id = 'whatsnew-panel';
    const shown = Math.min(lines.length, MAX_LINES);
    const H = 22 + shown * 9 + 8;
    panel.style.cssText = `position:fixed;width:${W}px;height:${H}px;box-sizing:border-box;z-index:55;background:${bg};` +
      'border:1px solid;border-color:rgba(255,255,255,.35) rgba(0,0,0,.6) rgba(0,0,0,.6) rgba(255,255,255,.35);' +
      `box-shadow:inset 0 0 0 1px ${bg},inset 0 0 0 2px rgba(0,0,0,.45);cursor:pointer;user-select:none;`;
    const row = (text, top, extra = '') => {
      const d = document.createElement('div');
      d.style.cssText = `position:absolute;left:${PAD}px;top:${top}px;height:6px;white-space:nowrap;${extra}`;
      setText(d, text); panel.appendChild(d); return d;
    };
    row(`What's new in Minapp ${version}`, 7);
    const rule = document.createElement('div');
    rule.style.cssText = `position:absolute;left:${PAD}px;right:${PAD}px;top:17px;height:1px;background:${hi};opacity:.45`;
    panel.appendChild(rule);
    const body = [];
    lines.forEach((l, i) => body.push(row(l.t, 23 + i * 9, l.head ? 'filter:brightness(1.35)' : '')));
    // a long history scrolls with the mouse wheel (the pop-up still closes with a click)
    let top = 0;
    const scroll = (d) => {
      top = Math.max(0, Math.min(lines.length - shown, top + d));
      body.forEach((el, i) => { const k = i - top; el.style.display = k >= 0 && k < shown ? '' : 'none'; el.style.top = 23 + k * 9 + 'px'; });
    };
    if (lines.length > shown) {
      scroll(0);
      panel.addEventListener('wheel', (e) => { e.preventDefault(); scroll(e.deltaY > 0 ? 3 : -3); }, { passive: false });
      row('wheel to scroll', 7, 'left:auto;right:30px;opacity:.6');
    }
    // close mark in the same skin font, top right (the whole pop-up closes on a click)
    const x = row('X', 7, 'left:auto;right:7px');
    x.title = 'Close';
    panel.addEventListener('mousedown', (e) => e.stopPropagation());
    panel.addEventListener('click', () => panel.remove());
    (document.getElementById('webamp') || document.body).appendChild(panel);
    const place = () => {
      if (!panel.isConnected) return clearInterval(t);
      let left = 0, bottom = 0;
      for (const sel of ['#main-window', '#equalizer-window', '#playlist-window', '#dl-panel']) {
        const el = document.querySelector(sel); if (!el || (el.style && el.style.display === 'none')) continue;
        const r = el.getBoundingClientRect();
        if (r.width && r.height) { bottom = Math.max(bottom, r.bottom); if (sel === '#main-window') left = r.left; }
      }
      panel.style.left = Math.round(left) + 'px'; panel.style.top = Math.round(bottom) + 'px';
    };
    const t = setInterval(place, 300); place();
  });
}
