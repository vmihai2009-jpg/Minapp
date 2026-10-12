// macOS desktop widget bridge. The native widget (mac/widget) lives in a sandboxed extension, so the two sides talk
// over loopback HTTP (127.0.0.1:47831 only) guarded by a shared secret kept in
// ~/Library/Application Support/Minapp/widget-secret (the widget is built with the same secret):
//   GET  /state          what is playing
//   POST /cmd?c=playpause|next|previous
// Nothing here touches audio or the visualizer. It does nothing off macOS.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = 47831;
const ALLOWED = new Set(['playpause', 'next', 'previous']);
const HOST_APPS = ['/Applications/Minapp Widget.app', path.join(os.homedir(), 'Applications', 'Minapp Widget.app')];
let secret = null, current = null, lastWrite = 0, doCmd = null, log = () => {};

function loadSecret(file) {
  try { secret = fs.readFileSync(file, 'utf8').trim(); } catch {}
  if (!secret) {
    secret = crypto.randomBytes(24).toString('hex');
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, secret, { mode: 0o600 }); } catch (e) { log('widget secret write failed: ' + e.message); }
  }
}

function launchHost() {
  const app = HOST_APPS.find((p) => fs.existsSync(p));
  if (app) execFile('open', ['-g', '-a', app, '--args', '-background'], () => {});
}

function publish(st) {
  if (!st) return;
  current = {
    status: st.status || 'closed',
    title: st.title || '',
    artist: st.artist || '',
    id: st.id || '',
    source: st.source || 'spotify',
    duration: Number(st.duration) || 0,
    position: Number(st.position) || 0,
    playing: st.status === 'playing',
    updated: Date.now() / 1000,
  };
}

function serve() {
  const srv = http.createServer((req, res) => {
    const ok = secret && req.headers['x-minapp-token'] === secret;
    if (!ok) { res.writeHead(403); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/state') {
      // "updated" is refreshed on read so a long song with no state changes still counts as live while Minapp runs
      const out = Object.assign({}, current || { status: 'closed', title: '', artist: '', id: '', source: 'spotify', duration: 0, position: 0, playing: false }, current ? { updated: Date.now() / 1000, position: current.position + (current.playing ? (Date.now() / 1000 - current.updated) : 0) } : { updated: Date.now() / 1000 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(out));
    }
    if (req.method === 'POST' && url.pathname === '/cmd') {
      const cmd = url.searchParams.get('c');
      if (!ALLOWED.has(cmd)) { res.writeHead(400); return res.end(); }
      log('widget command: ' + cmd);
      try { doCmd(cmd); } catch (e) { log('widget command failed: ' + e.message); }
      res.writeHead(204); return res.end();
    }
    res.writeHead(404); res.end();
  });
  srv.on('error', (e) => log('widget server: ' + e.message));
  srv.listen(PORT, '127.0.0.1');
}

function init(opts) {
  if (process.platform !== 'darwin') return;
  doCmd = opts.doCmd; log = opts.log || log;
  loadSecret(path.join(os.homedir(), 'Library', 'Application Support', 'Minapp', 'widget-secret'));
  serve();
  launchHost();
  setInterval(launchHost, 60000);
}

module.exports = { init, publish };
