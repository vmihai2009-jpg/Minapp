// Album tab: a small clear plastic cassette case, attached to the left of the player like Milkdrop is attached to the
// right, with the cover of what is playing inside (Spotify album cover, YouTube thumbnail). The case carries the
// source's logo at the top and a little sound-wave under the cover that is different for every song.
// A second style is a cassette tape with the cover as its label and reels that turn while music plays.
// Click the song title or the timer to show or hide it; click the case itself to switch between the two styles.
const CASE = { W: 80, H: 110 }, TAPE = { W: 112, H: 74 };
const CX = 8, CY = 21, CS = 64;  // where the cover sits inside the case, and its size
const LX = 7, LY = 6, LW = 98, LH = 44; // the tape's label
const LEVELS = 8;                // slightly reduced palette for a retro look
let W = CASE.W, H = CASE.H;

export function initAlbumTab(webamp, api, getWidgetMode) {
  let open = false, tab = null, canvas = null, url = null, token = 0, cover = null, label = null, wave = '', style = 'case';
  let playing = false, spin = 0, lastSrc = '', spinTimer = null;
  try { open = localStorage.getItem('minapp.albumTab') === '1'; style = localStorage.getItem('minapp.albumStyle') === 'tape' ? 'tape' : 'case'; } catch {}
  const size = () => { ({ W, H } = style === 'tape' ? TAPE : CASE); if (tab) { tab.style.width = W + 'px'; tab.style.height = H + 'px'; canvas.width = W; canvas.height = H; canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; } };
  size();

  const source = () => document.documentElement.dataset.source || 'spotify';

  function ensure() {
    if (tab) return;
    tab = document.createElement('div');
    tab.id = 'album-tab';
    tab.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:40;user-select:none;cursor:pointer;`;
    canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    canvas.style.cssText = `width:${W}px;height:${H}px;image-rendering:pixelated;display:block;`;
    tab.appendChild(canvas);
    tab.title = 'Click to switch between the case and the cassette (click the song title to hide it)';
    tab.addEventListener('mousedown', (e) => e.stopPropagation());
    tab.addEventListener('click', () => {
      style = style === 'tape' ? 'case' : 'tape';
      try { localStorage.setItem('minapp.albumStyle', style); } catch {}
      size(); draw(); animate();
    });
    (document.getElementById('webamp') || document.body).appendChild(tab);
    draw();
  }

  // ---- drawing helpers (1 canvas pixel = 1 screen pixel, like the skin) ----
  const px = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  function roundRect(g, x, y, w, h, r, fill) {
    g.fillStyle = fill;
    g.fillRect(x + r, y, w - 2 * r, h); g.fillRect(x, y + r, w, h - 2 * r);
    for (let i = 1; i < r; i++) { g.fillRect(x + r - i, y + i, 1, h - 2 * i); g.fillRect(x + w - r + i - 1, y + i, 1, h - 2 * i); }
  }
  function outline(g, x, y, w, h, c) { // rounded-corner 1 px frame
    g.fillStyle = c;
    g.fillRect(x + 2, y, w - 4, 1); g.fillRect(x + 2, y + h - 1, w - 4, 1);
    g.fillRect(x, y + 2, 1, h - 4); g.fillRect(x + w - 1, y + 2, 1, h - 4);
    px(g, x + 1, y + 1, c); px(g, x + w - 2, y + 1, c); px(g, x + 1, y + h - 2, c); px(g, x + w - 2, y + h - 2, c);
  }
  function spotifyLogo(g, x, y) { // white disc with three dark arcs, 11 px
    g.fillStyle = '#f2f2f2';
    g.beginPath(); g.arc(x + 5.5, y + 5.5, 5.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a1a22'; g.lineWidth = 1.1; g.lineCap = 'round';
    [[3.0, 3.6], [5.4, 2.8], [7.6, 2.0]].forEach(([yy, r], i) => {
      g.beginPath(); g.ellipse(x + 5.6, y + yy + r * 0.9, r + 1.2 - i * 0.2, r * 0.75, 0, Math.PI * 1.15, Math.PI * 1.85); g.stroke();
    });
  }
  function youtubeLogo(g, x, y) { // red rounded box with a white play mark
    roundRect(g, x, y + 2, 13, 9, 2, '#e5322d');
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(x + 5, y + 4); g.lineTo(x + 9, y + 6.5); g.lineTo(x + 5, y + 9); g.closePath(); g.fill();
  }
  function noteLogo(g, x, y) { // generic music note for other sources
    g.fillStyle = '#e8e8e8';
    g.fillRect(x + 6, y, 1, 8); g.fillRect(x + 6, y, 4, 1); g.fillRect(x + 9, y, 1, 3);
    g.beginPath(); g.ellipse(x + 4.5, y + 8.5, 2.5, 2, 0, 0, Math.PI * 2); g.fill();
  }
  // a little sound-wave, the same for a song every time and different between songs
  function waveform(g, seed) {
    let h = 2166136261;
    for (const c of seed || 'minapp') { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    const bars = 17, bw = 2, gap = 1, total = bars * (bw + gap) - gap, x0 = Math.round((W - total) / 2), mid = 97;
    for (let i = 0; i < bars; i++) {
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      const env = Math.sin(Math.PI * (i + 0.5) / bars); // taller in the middle
      const bh = Math.max(1, Math.round((1 + (h % 6)) * (0.45 + env * 0.75)));
      g.fillStyle = 'rgba(240,240,245,.9)';
      g.fillRect(x0 + i * (bw + gap), mid - bh, bw, bh * 2);
    }
  }

  function draw() {
    if (!canvas) return;
    if (style === 'tape') return drawTape();
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    // the case: dark see-through body, a lighter rim, and an inner lip
    roundRect(g, 0, 0, W, H, 3, 'rgba(26,26,36,.92)');
    outline(g, 0, 0, W, H, 'rgba(210,210,225,.75)');
    outline(g, 2, 2, W - 4, H - 4, 'rgba(160,160,185,.28)');
    g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(4, 3, 1, H - 6);   // hinge line on the left
    g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(W - 3, 6, 1, H - 12); // bright edge on the right
    // logo of the source
    const src = source();
    if (src === 'spotify') spotifyLogo(g, CX + 1, 6);
    else if (src === 'youtube') youtubeLogo(g, CX, 5);
    else noteLogo(g, CX + 1, 6);
    // the cover, or a quiet checker while there is none
    if (cover) g.drawImage(cover, CX, CY);
    else for (let y = 0; y < CS; y += 4) for (let x = 0; x < CS; x += 4) { g.fillStyle = (x + y) % 8 ? '#3a3a44' : '#4a4a55'; g.fillRect(CX + x, CY + y, 4, 4); }
    outline(g, CX - 1, CY - 1, CS + 2, CS + 2, 'rgba(0,0,0,.55)');
    waveform(g, wave);
    // the plastic: a soft diagonal shine over everything, and a few bright pixels on the corners
    const shine = g.createLinearGradient(0, 0, W, H);
    shine.addColorStop(0, 'rgba(255,255,255,.16)'); shine.addColorStop(.32, 'rgba(255,255,255,.03)');
    shine.addColorStop(.33, 'rgba(255,255,255,0)'); shine.addColorStop(.62, 'rgba(255,255,255,0)');
    shine.addColorStop(.63, 'rgba(255,255,255,.07)'); shine.addColorStop(.75, 'rgba(255,255,255,0)');
    g.fillStyle = shine; roundRect(g, 1, 1, W - 2, H - 2, 2, shine);
    ['#ffffff', 'rgba(255,255,255,.6)'].forEach((c, i) => { px(g, 3 + i, 1, c); px(g, 1, 3 + i, c); });
  }

  // ---- the cassette ----
  function reel(g, cx, cy, a) {
    g.fillStyle = '#ece6da'; g.beginPath(); g.arc(cx, cy, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#26262c'; g.beginPath(); g.arc(cx, cy, 3.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ece6da';
    for (let k = 0; k < 6; k++) { // the teeth, turning with the music
      const t = a + k * Math.PI / 3;
      g.fillRect(Math.round(cx + Math.cos(t) * 2.6 - 0.5), Math.round(cy + Math.sin(t) * 2.6 - 0.5), 1, 1);
    }
    g.fillStyle = '#26262c'; g.fillRect(cx - 0.5, cy - 0.5, 1, 1);
  }
  const LETTER_A = ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'];
  function drawTape() {
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    // shell: cream plastic with a dark edge and four screws
    roundRect(g, 0, 0, W, H, 4, '#2a2a30');
    roundRect(g, 1, 1, W - 2, H - 2, 3, '#d8cfbf');
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(3, 2, W - 6, 1);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(3, H - 3, W - 6, 1);
    [[3, 3], [W - 5, 3], [3, H - 5], [W - 5, H - 5]].forEach(([x, y]) => { g.fillStyle = '#7d7a74'; g.fillRect(x, y, 2, 2); px(g, x, y, '#b7b2a8'); });
    // label: the cover, cut to the label's shape
    if (label) g.drawImage(label, LX, LY);
    else for (let y = 0; y < LH; y += 4) for (let x = 0; x < LW; x += 4) { g.fillStyle = (x + y) % 8 ? '#3a3a44' : '#4a4a55'; g.fillRect(LX + x, LY + y, 4, 4); }
    outline(g, LX - 1, LY - 1, LW + 2, LH + 2, 'rgba(40,36,30,.6)');
    // logo of the source, top left of the label
    const src = source();
    if (src === 'spotify') spotifyLogo(g, LX + 3, LY + 3);
    else if (src === 'youtube') youtubeLogo(g, LX + 2, LY + 1);
    else noteLogo(g, LX + 3, LY + 3);
    // side "A", bottom right of the label
    LETTER_A.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') px(g, LX + LW - 10 + x, LY + LH - 11 + y, '#f2f2f2'); }));
    // the window with the two reels and the tape between them
    const wx = 28, wy = 22, ww = 56, wh = 18;
    roundRect(g, wx, wy, ww, wh, 3, '#1c1c22');
    outline(g, wx, wy, ww, wh, '#0c0c10');
    g.fillStyle = '#4a3224'; g.fillRect(wx + 15, wy + 4, ww - 30, wh - 8);  // tape
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(wx + 15, wy + 4, ww - 30, 1);
    reel(g, wx + 10, wy + wh / 2, spin);
    reel(g, wx + ww - 10, wy + wh / 2, spin + 0.7);
    // bottom: the head opening with its little holes
    g.fillStyle = '#c9bfae';
    g.beginPath(); g.moveTo(20, H - 1); g.lineTo(26, LY + LH + 5); g.lineTo(W - 26, LY + LH + 5); g.lineTo(W - 20, H - 1); g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(26, LY + LH + 5, W - 52, 1);
    [[32, H - 10], [W - 35, H - 10], [44, H - 7], [W - 47, H - 7]].forEach(([x, y]) => { g.fillStyle = '#2a2a30'; g.fillRect(x, y, 3, 3); });
    g.fillStyle = '#2a2a30'; g.fillRect(W / 2 - 3, H - 9, 6, 3);
  }
  // the reels turn about 12 times a second while something plays (nothing runs when it is paused or hidden)
  function animate() {
    const want = open && style === 'tape' && playing && !document.hidden;
    if (want && !spinTimer) spinTimer = setInterval(() => { spin += 0.35; if (canvas) drawTape(); }, 80);
    if (!want && spinTimer) { clearInterval(spinTimer); spinTimer = null; }
  }

  function paint(dataUrl) {
    const img = new Image();
    const mine = ++token;
    img.onload = () => {
      if (mine !== token) return;
      const c = document.createElement('canvas'); c.width = c.height = CS;
      const s = Math.min(img.naturalWidth, img.naturalHeight); // centre square (YouTube thumbnails are wide)
      const g = c.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, CS, CS);
      const d = g.getImageData(0, 0, CS, CS), p = d.data, q = 255 / (LEVELS - 1);
      for (let i = 0; i < p.length; i += 4) for (let k = 0; k < 3; k++) p[i + k] = Math.round(p[i + k] / q) * q;
      g.putImageData(d, 0, 0);
      // the tape's label: the middle band of the cover, stretched to the label's width
      const l = document.createElement('canvas'); l.width = LW; l.height = LH;
      const lg = l.getContext('2d', { willReadFrequently: true });
      lg.imageSmoothingEnabled = true; lg.imageSmoothingQuality = 'high';
      const sh = s * LH / LW;
      lg.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - sh) / 2, s, sh, 0, 0, LW, LH);
      const ld = lg.getImageData(0, 0, LW, LH), lp = ld.data;
      for (let i = 0; i < lp.length; i += 4) for (let k = 0; k < 3; k++) lp[i + k] = Math.round(lp[i + k] / q) * q;
      lg.putImageData(ld, 0, 0);
      cover = c; label = l; draw();
    };
    img.onerror = () => { api.log('album tab: picture could not be decoded'); cover = null; label = null; draw(); };
    img.src = dataUrl;
  }

  function set(on) {
    open = on;
    try { localStorage.setItem('minapp.albumTab', on ? '1' : '0'); } catch {}
    if (on) { ensure(); tab.style.display = ''; if (url) load(url); else draw(); }
    else if (tab) tab.style.display = 'none';
    animate();
  }

  async function load(u) {
    if (!open || !canvas) return;
    if (!u) { token++; cover = null; label = null; draw(); return; }
    try {
      const d = await api.artGet(u);
      if (u !== url) return;
      if (d) paint(d); else { api.log('album tab: no picture for ' + u); cover = null; label = null; draw(); }
    } catch (e) { api.log('album tab error: ' + (e && e.message)); cover = null; label = null; draw(); }
  }

  // u: picture address ('' = none, null = nothing playing); song: title, so the sound-wave changes with the song
  function setArt(u, song, isPlaying) {
    const next = u === null ? '' : u;
    if (isPlaying !== undefined && !!isPlaying !== playing) { playing = !!isPlaying; animate(); }
    const src = source();
    if (src !== lastSrc) { lastSrc = src; if (open && canvas) draw(); } // the logo follows the source
    if (song !== undefined && song !== wave) { wave = song || ''; if (open && canvas && next === url) draw(); }
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
    // how far the player is pushed right to make room for the case
    offset: () => (open && tab && getWidgetMode() === 'off' ? W : 0),
  };
  document.addEventListener('visibilitychange', animate);
  if (open) ensure();
}
