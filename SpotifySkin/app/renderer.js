(async () => {
  const api = window.bridge;
  window.addEventListener('error', (e) => api.log('error: ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', (e) => api.log('promise: ' + ((e.reason && e.reason.message) || e.reason)));

  // Webamp's "butterchurn" build includes Milkdrop; fall back to the plain build if it's missing.
  let Webamp;
  try {
    Webamp = (await import('./node_modules/webamp/built/webamp.butterchurn-bundle.min.mjs')).default;
  } catch (e) {
    console.warn('Milkdrop build unavailable, using plain Webamp', e);
    await new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'node_modules/webamp/built/webamp.bundle.min.js';
      s.onload = ok; s.onerror = no; document.head.appendChild(s);
    });
    Webamp = window.Webamp;
  }

  // Webamp needs *some* audio to drive its UI. We feed it 30 min of silence and
  // overwrite the title/duration/position with Spotify's real data.
  function silentWav(seconds = 1800, rate = 4000) {
    const n = Math.ceil(seconds * rate), buf = new Uint8Array(44 + n), v = new DataView(buf.buffer);
    const w = (o, s) => [...s].forEach((c, i) => (buf[o + i] = c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true); buf.fill(128, 44);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  let silentUrl = null;

  const webamp = new Webamp({
    windowLayout: {
      main: { position: { top: 0, left: 0 }, shadeMode: false },
      equalizer: { position: { top: 116, left: 0 }, closed: true },
      playlist: { position: { top: 232, left: 0 }, closed: true },
      milkdrop: { position: { top: 0, left: 275 }, closed: true },
    },
    enableHotkeys: false,
  });
  webamp.onClose(() => api.quit());
  await webamp.renderWhenReady(document.getElementById('app'));

  // ----- skins -----
  const loadSkinBuf = (buf) => {
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
    webamp.setSkinFromUrl(url);
  };
  api.onSkin(loadSkinBuf);
  const last = await api.lastSkin();
  if (last) loadSkinBuf(last);

  // ----- mini mode (Winamp "windowshade") -----
  api.onMini(() => document.querySelector('#shade')?.click());

  // ----- stack the windows with no gaps; Milkdrop sits to the right of the player -----
  const SEL = { main: '#main-window', equalizer: '#equalizer-window', playlist: '#playlist-window' };
  let lastSig = '';
  function restack() {
    try {
      const gen = webamp.store.getState().windows.genWindows;
      if (!gen || !gen.main) return;
      const h = {};
      for (const id of Object.keys(SEL)) {
        const open = !!(gen[id] && gen[id].open);
        const el = document.querySelector(SEL[id]);
        const r = el && el.getBoundingClientRect();
        const dom = r && r.width && r.height ? Math.round(r.height) : 0;
        h[id] = open ? (dom || (id === 'main' ? (gen.main.shade ? 14 : 116) : 116)) : 0;
      }
      const milk = !!(gen.milkdrop && gen.milkdrop.open);
      const sig = JSON.stringify([h, milk]);
      if (sig === lastSig) return;
      lastSig = sig;
      let y = 0;
      const positions = {};
      for (const id of ['main', 'equalizer', 'playlist']) {
        if (h[id]) { positions[id] = { x: 0, y }; y += h[id]; }
      }
      if (milk) positions.milkdrop = { x: 275, y: 0 };
      webamp.store.dispatch({ type: 'UPDATE_WINDOW_POSITIONS', positions });
    } catch (e) { console.warn('restack failed', e); }
  }

  // Webamp clamps menus to the viewport, so open the viewport up *before* the
  // menu appears (O button / right-click), then shrink back once it closes.
  let expandUntil = 0;
  const expand = () => { expandUntil = Date.now() + 1500; };

  // keep the Electron window sized to the Winamp windows (and any open menu)
  let lw = 0, lh = 0;
  setInterval(() => {
    restack();
    // only the few top-level boxes are measured (cheap); a full-tree scan every tick made the playlist feel laggy
    const els = [...document.querySelectorAll('#main-window, #equalizer-window, #playlist-window, #milkdrop-window')];
    for (const c of document.body.children) {
      if (c.id !== 'app' && !['SCRIPT', 'STYLE'].includes(c.tagName)) els.push(c);
    }
    if (document.querySelector('.context-menu, #webamp-context-menu')) expand(); // menu still open
    let right = 0, bottom = 0;
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) { right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom); }
    });
    try { // if Milkdrop is open but its element wasn't found, still leave room for it
      const m = webamp.store.getState().windows.genWindows.milkdrop;
      if (m && m.open) { right = Math.max(right, 275 + 275); bottom = Math.max(bottom, 232); }
    } catch {}
    let w = Math.round(right), h = Math.round(bottom);
    if (Date.now() < expandUntil) { w = Math.max(w, 420); h = Math.max(h, 400); }
    if (w && h && (w !== lw || h !== lh)) { lw = w; lh = h; api.size(w, h); }
  }, 150);

  // menu item / Cmd+Shift+K -> show or hide the Milkdrop window
  api.onMilkdrop(() => {
    try { webamp.store.dispatch({ type: 'TOGGLE_WINDOW', windowId: 'milkdrop' }); }
    catch (e) { console.warn('milkdrop toggle failed', e); }
  });

  // drag the window by the skin's title bar (no CSS drag regions, so menus stay clickable)
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !e.target.closest('#title-bar') || e.target.closest('#option, #minimize, #shade, #close')) return;
    e.stopPropagation();
    api.dragStart();
  }, true);
  window.addEventListener('mouseup', () => api.dragEnd());
  window.addEventListener('blur', () => api.dragEnd());

  // ----- skin buttons -> Spotify -----
  const MAP = { play: 'play', pause: 'playpause', stop: 'pause', next: 'next', previous: 'previous' };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#play, #pause, #stop, #next, #previous');
    if (b && MAP[b.id]) api.cmd(MAP[b.id]);
    // shuffle / repeat: Webamp flips its own switch, then the source is told the new value
    const sr = e.target.closest('#shuffle, #repeat');
    if (sr) setTimeout(() => {
      try {
        const m = webamp.store.getState().media;
        modeHoldUntil = Date.now() + 3000;
        api.cmd(sr.id, sr.id === 'shuffle' ? m.shuffle : m.repeat);
      } catch {}
    }, 0);
    // eject used to open Webamp's own file picker, which makes no sense here: open the menu instead
    if (e.target.closest('#eject')) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); api.showMenu(); }
  }, true);
  let modeHoldUntil = 0, holdUntil = 0;
  const followModes = (s) => {
    if (Date.now() < modeHoldUntil) return;
    try {
      const m = webamp.store.getState().media;
      if (typeof s.shuffle === 'boolean' && s.shuffle !== !!m.shuffle) webamp.store.dispatch({ type: 'TOGGLE_SHUFFLE' });
      if (typeof s.repeat === 'boolean' && s.repeat !== !!m.repeat) webamp.store.dispatch({ type: 'TOGGLE_REPEAT' });
    } catch {}
  };

  // ----- audio routing: equalizer + visualizer -----
  // Captured sound (YouTube window, or the whole PC for Spotify) is fed into Webamp's own audio chain, so the
  // skin's real EQ, preamp, volume and analyser (the visualizer bars and Milkdrop) all work on it.
  //  kind 'eq'  : feeds the start of the chain (the page plays the result; the original is muted by the capture)
  //  kind 'viz' : listen only, feeds just the analyser
  const media = webamp.media;
  let cap = null; // { kind, stream, src, guard }
  function stopCapture() {
    if (!cap) return;
    clearInterval(cap.guard);
    try { cap.src.disconnect(); } catch {}
    try { cap.tap && media._gainNode.disconnect(cap.tap); } catch {}
    try { cap.stream.getTracks().forEach((t) => t.stop()); } catch {}
    const wasEq = cap.kind === 'eq';
    cap = null;
    // hand loudness back to the source at the level the slider shows
    if (wasEq) try { api.cmd('volume', webamp.store.getState().media.volume); } catch {}
  }
  async function startCapture(mode) {
    await api.capPrepare(mode);
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach((t) => t.stop()); throw new Error('No audio was captured.'); }
    const ctx = media._context;
    if (ctx.state !== 'running') await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    let guard = null, tap = null;
    if (mode.kind === 'eq') {
      api.cmd('volume', 100); // the slider now sets the level of the equalized sound, so the source plays at full
      src.connect(media._staticSource);
      // safety: if our own output is being re-captured we get a runaway squeal; shut down
      tap = ctx.createAnalyser(); tap.fftSize = 2048;
      media._gainNode.connect(tap);
      const buf = new Float32Array(tap.fftSize);
      let loud = 0;
      guard = setInterval(() => {
        tap.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        loud = Math.sqrt(sum / buf.length) > 0.6 ? loud + 1 : 0;
        if (loud >= 6) { stopCapture(); api.eqMessage('The sound was feeding back on itself (a loud squeal), so the equalizer was stopped.'); }
      }, 250);
    } else {
      src.connect(media._analyser);
    }
    stream.getAudioTracks()[0].addEventListener('ended', () => { if (cap && cap.stream === stream) stopCapture(); });
    cap = { kind: mode.kind, stream, src, tap, guard };
  }
  // called by the main process (with a user gesture, which screen/audio capture requires)
  window.__audioApply = async (mode) => {
    stopCapture();
    if (!mode) return 'off';
    await startCapture(mode);
    return mode.kind;
  };
  const eqRouted = () => !!cap && cap.kind === 'eq'; // Webamp's own volume already controls what is heard

  // the EQ sliders drive Equalizer APO (Spotify on Windows) through the main process, and are remembered
  const eqSnap = () => { const e = webamp.store.getState().equalizer; return { on: e.on !== false, sliders: { ...e.sliders } }; };
  let eqSig = '', saveT = null;
  const savePrefs = () => {
    try {
      const st = webamp.store.getState();
      api.prefsSave({ eq: eqSnap(), balance: st.media.balance });
    } catch {}
  };
  try {
    const prefs = (await api.prefsGet()) || {};
    if (prefs.eq && prefs.eq.sliders) {
      const d = webamp.store.dispatch;
      Object.entries(prefs.eq.sliders).forEach(([band, value]) => d({ type: 'SET_BAND_VALUE', band, value: Number(value) }));
      d({ type: prefs.eq.on === false ? 'SET_EQ_OFF' : 'SET_EQ_ON' });
    }
    if (typeof prefs.balance === 'number') webamp.store.dispatch({ type: 'SET_BALANCE', balance: prefs.balance });
  } catch (e) { console.warn('restore prefs failed', e); }
  const pushEq = () => {
    try {
      const snap = eqSnap(), sig = JSON.stringify(snap);
      if (sig === eqSig) return;
      eqSig = sig; api.eqState(snap);
      clearTimeout(saveT); saveT = setTimeout(savePrefs, 800);
    } catch {}
  };
  try { webamp.store.subscribe(pushEq); pushEq(); } catch (e) { console.warn('EQ sync unavailable', e); }

  // volume slider <-> the source's own volume (Spotify per-app volume on Windows, YouTube, Spotify on Mac)
  let syncingVol = false, volHoldUntil = 0;
  try {
    let lastVol = webamp.store.getState().media.volume, t;
    webamp.store.subscribe(() => {
      const v = webamp.store.getState().media.volume;
      if (v === lastVol) return;
      lastVol = v;
      if (syncingVol) { syncingVol = false; return; }
      volHoldUntil = Date.now() + 2500;
      clearTimeout(t);
      if (!eqRouted()) t = setTimeout(() => api.cmd('volume', v), 120);
    });
  } catch (e) { console.warn('volume sync unavailable', e); }
  const followVolume = (v) => {
    if (typeof v !== 'number' || v < 0 || eqRouted() || Date.now() < volHoldUntil) return;
    try {
      if (Math.abs(webamp.store.getState().media.volume - v) > 2) { syncingVol = true; webamp.store.dispatch({ type: 'SET_VOLUME', volume: Math.round(v) }); syncingVol = false; }
    } catch {}
  };

  // dropping a skin on the player also adds it to the skin library (so it is still there next time)
  const skinNameOk = (n) => /\.(wsz|zip)$/i.test(n || '');
  ['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
    if (ev === 'dragover') { e.preventDefault(); return; }
    const files = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter((f) => skinNameOk(f.name));
    if (e.target.closest && e.target.closest('#playlist-window')) { e.preventDefault(); return; } // queue view stays read-only
    e.preventDefault();
    files.slice(0, 1).forEach(async (f) => {
      try { const buf = await f.arrayBuffer(); await api.saveSkin(f.name, buf); loadSkinBuf(buf); } catch (err) { console.warn('skin drop failed', err); }
    });
  }, true));

  // ----- native pop-up menu instead of Webamp's own dropdown (which the small window clips) -----
  const swallow = (e) => { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); };
  ['mousedown', 'mouseup'].forEach((ev) =>
    document.addEventListener(ev, (e) => { if (e.target.closest && e.target.closest('#option')) swallow(e); }, true));
  document.addEventListener('click', (e) => {
    if (!(e.target.closest && e.target.closest('#option'))) return;
    swallow(e); api.showMenu();
  }, true);
  document.addEventListener('contextmenu', (e) => { swallow(e); api.showMenu(); }, true);

  // show/hide the playlist and equalizer windows (the menu uses the skin's own PL / EQ buttons)
  api.onWindowToggle((id) => {
    const btn = { playlist: '#playlist-button', equalizer: '#equalizer-button' }[id];
    const el = btn && document.querySelector(btn);
    if (el) { el.click(); return; }
    try { webamp.store.dispatch({ type: 'TOGGLE_WINDOW', windowId: id }); } catch (err) { console.warn('window toggle failed', err); }
  });

  // ----- pin: the skin's left top-right button (minimize) pins the player above all other apps -----
  const pinStyle = document.createElement('style');
  pinStyle.textContent = 'html.pinned #minimize { filter: invert(1) sepia(1) saturate(6) hue-rotate(60deg); }';
  document.head.appendChild(pinStyle);
  const showPin = (v) => document.documentElement.classList.toggle('pinned', !!v);
  api.onPin(showPin);
  api.pinGet().then(showPin);
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#minimize')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    api.pinToggle();
  }, true);
  setInterval(() => { const b = document.querySelector('#minimize'); if (b && b.title !== 'Pin on top') b.title = 'Pin on top'; }, 1000);

  // ----- the playlist window is a read-only queue view: no playing, removing, adding or reordering -----
  const PL_BLOCKED = '#playlist-window .playlist-tracks, #playlist-window .playlist-bottom-left, #playlist-window .playlist-bottom-right';
  const PL_ALLOWED = '#playlist-scroll-up-button, #playlist-scroll-down-button, [class*="resize" i]';
  // A click on an upcoming title jumps to it (rows are numbered "12. Artist - Title"; the first row is the playing song).
  let rowDown = -1, lastQueue = [], lastHist = [];
  const rowIndex = (cell) => { const m = /^\s*(\d+)\./.exec((cell.textContent || '').replace(/\u00a0/g, ' ')); return m ? Number(m[1]) - 1 : -1; };
  const blockPlaylist = (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const cell = t.closest('#playlist-window .playlist-track-titles .track-cell');
    if (cell) {
      // compare row numbers, not elements: the list is rebuilt whenever the queue changes
      if (e.type === 'mousedown') rowDown = rowIndex(cell);
      if (e.type === 'click' && rowDown >= 0 && rowDown === rowIndex(cell)) {
        const i = rowDown;
        rowDown = -1;
        // rows: [history..., playing song, queue...]; clicking above the playing song goes back, below it jumps ahead
        const h = lastHist.length, off = i - h;
        const item = off > 0 ? lastQueue[off - 1] : off < 0 ? lastHist[i] : null;
        if (off !== 0 && item && !item.hint) {
          api.cmd('jump', off);
          holdUntil = Date.now() + 2500; // ignore the old position while the skip happens
          cell.style.opacity = '0.5'; setTimeout(() => { cell.style.opacity = ''; }, 400);
        }
      }
    }
    const hit = (t.closest(PL_BLOCKED) && !t.closest(PL_ALLOWED)) || (e.type === 'drop' && t.closest('#playlist-window'));
    if (hit) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  };
  ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'touchstart', 'dragstart', 'drop']
    .forEach((ev) => document.addEventListener(ev, blockPlaylist, true));

  // position bar -> Spotify seek
  document.addEventListener('mouseup', (e) => {
    if (!e.target.closest('#position')) return;
    setTimeout(() => {
      try { holdUntil = Date.now() + 1500; api.cmd('seek', webamp.store.getState().media.timeElapsed); } catch {}
    }, 150);
  }, true);

  // ----- Spotify -> skin (poll) -----
  let pendingFix = null, curId = null, busy = false, lastQSig = '', lastBuild = 0;
  const queueUrl = silentWav(5); // placeholder audio for the upcoming items (never actually heard)
  async function tick() {
    if (busy) return; busy = true;
    try {
      const s = await api.state();
      const status = webamp.getMediaStatus();
      if (s.status === 'closed' || s.status === 'stopped') {
        if (status === 'PLAYING') webamp.pause();
        return;
      }
      if (pendingFix) {
        // Webamp starts the first row; with history above, move playback and the view to the playing song
        const st = webamp.store.getState(), order = st.playlist.trackOrder;
        if (order.length === pendingFix.len) {
          const id = order[pendingFix.h];
          if (pendingFix.h > 0 && st.playlist.currentTrack !== id) webamp.store.dispatch({ type: 'PLAY_TRACK', id });
          const overflow = Math.max(0, order.length - 4);
          const pos = pendingFix.scroll != null ? pendingFix.scroll : overflow ? Math.min(100, (pendingFix.h / overflow) * 100) : 0;
          webamp.store.dispatch({ type: 'SET_PLAYLIST_SCROLL_POSITION', position: pos });
          pendingFix = null;
        } else if (++pendingFix.tries > 8) pendingFix = null;
        return;
      }
      const q = Array.isArray(s.queue) ? s.queue.slice(0, 30) : [];
      lastQueue = q;
      const hist = Array.isArray(s.history) ? s.history.slice(-30) : [];
      lastHist = hist;
      const qSig = hist.map((x) => x.id + '~' + x.title).join('|') + '||' + q.map((x) => x.id + '~' + x.title).join('|');
      const changed = s.id !== curId;
      if (changed || (qSig !== lastQSig && Date.now() - lastBuild > 4000)) {
        curId = s.id; lastQSig = qSig; lastBuild = Date.now();
        if (changed) {
          if (silentUrl) URL.revokeObjectURL(silentUrl);
          silentUrl = silentWav(Math.max(1, Math.ceil(s.duration)));
        }
        // keep the scroll position the user chose, unless the song changed (then show the playing song at the top)
        let keepScroll = null;
        try { keepScroll = webamp.store.getState().display.playlistScrollPosition; } catch {}
        webamp.setTracksToPlay([
          ...hist.map((x) => ({ url: queueUrl, duration: x.duration || 0, metaData: { artist: x.artist || '', title: x.title || '' } })),
          { url: silentUrl, duration: s.duration, metaData: { artist: s.artist, title: s.title } },
          ...q.map((x) => ({ url: queueUrl, duration: x.duration || 0, metaData: { artist: x.artist || '', title: x.title || '' } })),
        ]);
        pendingFix = { h: hist.length, len: hist.length + 1 + q.length, tries: 0, scroll: changed ? null : keepScroll };
        return; // next tick syncs position/play state once the track has loaded
      }
      followVolume(s.volume);
      followModes(s);
      const playing = s.status === 'playing';
      if (playing && status !== 'PLAYING') webamp.play();
      if (!playing && status === 'PLAYING') webamp.pause();
      try {
        const elapsed = webamp.store.getState().media.timeElapsed;
        if (Date.now() > holdUntil && Math.abs(elapsed - s.position) > 2) webamp.seekToTime(s.position);
      } catch {}
    } catch (e) { console.warn(e); }
    finally { busy = false; }
  }
  setInterval(tick, 750);
})();
