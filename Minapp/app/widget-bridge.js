// macOS desktop widget bridge. The native widget (mac/widget) lives in a sandboxed extension, so the two sides talk
// through files in the widget's App Group container (~/Library/Group Containers/<TEAM>.com.minapp.widget):
//   state.json            written here on every poll: what is playing
//   commands/<id>.json    written by the widget's buttons: { "command": "playpause" | "next" | "previous" }
// Nothing here touches audio or the visualizer. It does nothing unless the widget app has been run once (that is
// what creates the container).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ALLOWED = new Set(['playpause', 'next', 'previous']);
const HOST_APPS = ['/Applications/Minapp Widget.app', path.join(os.homedir(), 'Applications', 'Minapp Widget.app')];
let dir = null, lastJson = '', lastWrite = 0, doCmd = null, log = () => {};

function findDir() {
  const root = path.join(os.homedir(), 'Library', 'Group Containers');
  try {
    const name = fs.readdirSync(root).find((n) => /\.com\.minapp\.widget$/.test(n));
    return name ? path.join(root, name) : null;
  } catch { return null; }
}

function launchHost() {
  const app = HOST_APPS.find((p) => fs.existsSync(p));
  if (app) execFile('open', ['-g', '-a', app], () => {});
}

function publish(st) {
  if (!dir || !st) return;
  const playing = st.status === 'playing';
  const out = {
    status: st.status || 'closed',
    title: st.title || '',
    artist: st.artist || '',
    id: st.id || '',
    source: st.source || 'spotify',
    duration: Number(st.duration) || 0,
    position: Number(st.position) || 0,
    playing,
  };
  const key = JSON.stringify([out.status, out.title, out.artist, out.id, out.duration, playing]);
  const now = Date.now();
  // the position only matters as a starting point for the widget's own running timer: rewrite it when something else
  // changed, or as a heartbeat every few seconds (the widget treats a silent file as "Minapp closed")
  if (key === lastJson && now - lastWrite < 4000) return;
  lastJson = key; lastWrite = now;
  out.updated = now / 1000;
  try {
    const tmp = path.join(dir, 'state.json.tmp');
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, path.join(dir, 'state.json'));
  } catch (e) { log('widget state write failed: ' + e.message); }
}

function pollCommands() {
  const cdir = path.join(dir, 'commands');
  let files;
  try { files = fs.readdirSync(cdir).filter((f) => f.endsWith('.json')).sort(); } catch { return; }
  for (const f of files) {
    const p = path.join(cdir, f);
    try {
      const age = Date.now() - fs.statSync(p).mtimeMs;
      const cmd = JSON.parse(fs.readFileSync(p, 'utf8')).command;
      fs.unlinkSync(p);
      if (age < 10000 && ALLOWED.has(cmd)) { log('widget command: ' + cmd); doCmd(cmd); }
    } catch { try { fs.unlinkSync(p); } catch {} }
  }
}

function init(opts) {
  if (process.platform !== 'darwin') return;
  doCmd = opts.doCmd; log = opts.log || log;
  const look = () => {
    const d = findDir();
    if (d && d !== dir) { dir = d; try { fs.mkdirSync(path.join(dir, 'commands'), { recursive: true }); } catch {} log('widget container: ' + dir); }
    if (dir) launchHost();
  };
  look();
  setInterval(look, 60000);
  setInterval(() => { if (dir) pollCommands(); }, 700);
}

module.exports = { init, publish };
