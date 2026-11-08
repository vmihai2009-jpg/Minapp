const { ipcRenderer } = require('electron');
// YouTube Music has no player API, so this reads the page's own player bar and presses its buttons.
const $ = (s) => document.querySelector(s);
const text = (s) => ((($(s) || {}).textContent) || '').replace(/\s+/g, ' ').trim();
const vid = () => document.querySelector('video');

function push() {
  const v = vid(), title = text('ytmusic-player-bar .title');
  if (!v || !title) { ipcRenderer.send('ytm:state', { status: 'stopped' }); return; }
  const artist = text('ytmusic-player-bar .byline').split('•')[0].trim();
  ipcRenderer.send('ytm:state', {
    status: v.paused ? 'paused' : 'playing', title, artist,
    id: (new URLSearchParams(location.search).get('v')) || title,
    duration: isFinite(v.duration) ? v.duration : 0, position: v.currentTime || 0, volume: Math.round(v.volume * 100),
  });
}
setInterval(push, 500);

const click = (s) => { const e = $(s); if (e) e.click(); };
ipcRenderer.on('ytm:cmd', (_e, c, a) => {
  const v = vid();
  try {
    ({
      play: () => v && v.play(),
      pause: () => v && v.pause(),
      playpause: () => v && (v.paused ? v.play() : v.pause()),
      next: () => click('ytmusic-player-bar .next-button'),
      previous: () => click('ytmusic-player-bar .previous-button'),
      volume: () => { if (v) v.volume = Math.max(0, Math.min(1, (Number(a) || 0) / 100)); },
      seek: () => { if (v) v.currentTime = Number(a) || 0; },
      shuffle: () => click('ytmusic-player-bar .shuffle'),
      repeat: () => click('ytmusic-player-bar .repeat'),
    })[c]?.();
  } catch (e) {}
  setTimeout(push, 150);
});
