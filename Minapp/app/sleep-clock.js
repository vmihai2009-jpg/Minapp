// Sleep timer: the music pauses by itself after a while (Player menu > Sleep timer), or when the playing song ends.
// For a few seconds after it is set, and during its last minute, the player's own clock counts down to the pause.
export function initSleepClock(api) {
  let at = 0, afterSong = false, songKey = null, flashUntil = 0, box = null;
  const X = [9, 21, 39, 51]; // where the clock's four digits sit

  function ensure() {
    const time = document.querySelector('#main-window #time');
    if (!time || (box && box.isConnected)) return !!time;
    box = document.createElement('div');
    box.id = 'sleep-clock';
    box.title = 'Sleep timer: time left until the music pauses';
    box.style.cssText = `position:absolute;left:${time.offsetLeft}px;top:${time.offsetTop}px;width:${time.offsetWidth}px;height:${time.offsetHeight}px;pointer-events:none;display:none;`;
    for (const x of X) { const d = document.createElement('div'); d.style.cssText = `position:absolute;left:${x}px;top:0;width:9px;height:13px;margin:0;`; box.appendChild(d); }
    time.parentNode.appendChild(box);
    if (!document.getElementById('sleep-style')) {
      const st = document.createElement('style'); st.id = 'sleep-style';
      st.textContent = 'html.sleep-show #main-window #time > * { visibility: hidden !important; }';
      document.head.appendChild(st);
    }
    return true;
  }
  function show(on, left) {
    document.documentElement.classList.toggle('sleep-show', on);
    if (!box) return;
    box.style.display = on ? '' : 'none';
    if (!on) return;
    const s = Math.max(0, Math.ceil(left)), m = Math.min(99, Math.floor(s / 60)), digits = [Math.floor(m / 10), m % 10, Math.floor((s % 60) / 10), s % 10];
    // blink through the last ten seconds
    const hide = s <= 10 && Date.now() % 1000 > 600;
    [...box.children].forEach((d, i) => { const c = 'digit digit-' + digits[i]; if (d.className !== c) d.className = c; d.style.visibility = hide ? 'hidden' : ''; });
  }
  setInterval(() => {
    if (!at) { if (box && box.style.display !== 'none') show(false); return; }
    const left = (at - Date.now()) / 1000;
    const on = left > 0 && (left <= 60 || Date.now() < flashUntil) && !document.documentElement.classList.contains('widget-small');
    if (on && !ensure()) return;
    show(on, left);
  }, 200);

  api.onSleep((s) => {
    at = (s && s.at) || 0; afterSong = !!(s && s.song);
    flashUntil = at ? Date.now() + 4000 : 0;
    if (!at) show(false);
  });
  window.__sleep = {
    // called with every poll: "after this song" fires when another song starts
    song(key) {
      if (afterSong && songKey !== null && key && key !== songKey) { afterSong = false; api.sleepNow(); }
      songKey = key || songKey;
    },
  };
  api.sleepGet().then((s) => { if (s) { at = s.at || 0; afterSong = !!s.song; } }).catch(() => {});
}
