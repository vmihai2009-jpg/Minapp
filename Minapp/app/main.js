const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, screen, clipboard, session, desktopCapturer, shell, globalShortcut, Notification } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const widgetBridge = require('./widget-bridge');

// Every web request gets a time limit: a connection that hangs (sleeping laptop, captive Wi-Fi) must not leave the
// queue, cover or update checks waiting forever.
const netFetch = globalThis.fetch;
const fetch = (url, opts = {}) => netFetch(url, { signal: AbortSignal.timeout(15000), ...opts });

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
// Portable: keep settings next to the app (a "data" folder) instead of in %APPDATA% / Library.
// Inside a macOS .app bundle the app folder is not a place to keep data (it is replaced on updates), so there it
// uses ~/Library/Application Support/Minapp, which the uninstaller knows about.
const inMacBundle = isMac && __dirname.includes('.app/Contents/Resources');
try {
  const dataDir = inMacBundle ? path.join(app.getPath('appData'), 'Minapp') : path.join(path.dirname(__dirname), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.accessSync(dataDir, fs.constants.W_OK);
  app.setPath('userData', dataDir);
} catch (e) { /* fall back to the default location */ }
if (isWin) app.setAppUserModelId('Minapp.Player'); // groups the taskbar button / toasts under one identity

// The player's silent placeholder audio must not register as a media session or grab the media keys.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');

app.setName('Minapp');

// Only one player at a time: a second launch would fight over the helper, the ports and the EQ file.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

let tray = null;
let win, ytWin = null, ytmWin = null, localWin = null, zoom = 1, lastSize = { w: 275, h: 116 };
let source = 'spotify';
let ytState = { status: 'closed' }, ytmState = { status: 'closed' };
let ytServer = null, ytPort = 0;
let localState = { status: 'closed' }, localList = [], localName = '', localMeta = { path: '' };
const isPlayerSrc = () => source === 'youtube' || source === 'ytmusic' || source === 'local'; // sources played in their own window
const playerWin = () => (source === 'local' ? localWin : source === 'ytmusic' ? ytmWin : ytWin);

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
// Settings are read from disk once and kept in memory (menus and polls ask for them constantly); writes go to a
// temporary file first and are then renamed into place, so a crash or power loss mid-write cannot corrupt them.
let cfgCache = null;
const readCfg = () => {
  if (!cfgCache) {
    try { cfgCache = JSON.parse(fs.readFileSync(cfgPath(), 'utf8')) || {}; }
    catch { cfgCache = {}; try { if (fs.existsSync(cfgPath())) fs.copyFileSync(cfgPath(), cfgPath() + '.broken'); } catch {} }
  }
  return cfgCache;
};
const writeCfg = (p) => {
  cfgCache = { ...readCfg(), ...p };
  try {
    const tmp = cfgPath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfgCache));
    fs.renameSync(tmp, cfgPath());
  } catch (e) { log('could not save settings: ' + e.message); }
};

// ---------- logging ----------
const bridgeLogPath = () => path.join(app.getPath('userData'), 'bridge.log');
function log(msg) {
  try {
    const p = bridgeLogPath();
    try { if (fs.statSync(p).size > 400 * 1024) fs.renameSync(p, p + '.old'); } catch {}
    fs.appendFileSync(p, `${new Date().toISOString()} [app] ${msg}\n`);
  } catch {}
}
process.on('uncaughtException', (e) => log('uncaught: ' + ((e && e.stack) || e)));
process.on('unhandledRejection', (e) => log('unhandled rejection: ' + ((e && e.stack) || e)));

// ---------- Spotify bridge (AppleScript) ----------
const osa = (script) => new Promise((res) =>
  execFile('osascript', ['-e', script], { timeout: 3000 }, (err, out) => res(err ? null : out.trim())));

const STATE_SCRIPT = `
if application "Spotify" is running then
  tell application "Spotify"
    set s to player state as string
    if s is "stopped" then return "stopped"
    set t to current track
    set art to ""
    try
      set art to artwork url of t
    end try
    set alb to ""
    try
      set alb to album of t
    end try
    return s & "|||" & (name of t) & "|||" & (artist of t) & "|||" & (duration of t) & "|||" & player position & "|||" & sound volume & "|||" & (id of t) & "|||" & shuffling & "|||" & repeating & "|||" & art & "|||" & alb
  end tell
else
  return "closed"
end if`;

async function macState() {
  const out = await osa(STATE_SCRIPT);
  if (!out || out === 'closed' || out === 'stopped') return { status: out || 'closed' };
  const [status, title, artist, dur, pos, vol, id, shuf, rep, art, album] = out.split('|||');
  const num = (x) => parseFloat(String(x).replace(',', '.')) || 0;
  const st = { status, title, artist, id, duration: num(dur) / 1000, position: num(pos), volume: num(vol) };
  if (album && album.trim()) st.album = album.trim();
  if (SPOT_IMG.test((art || '').trim())) st.art = art.trim(); // the Spotify app tells us the cover itself, no login needed
  if (shuf === 'true' || shuf === 'false') st.shuffle = shuf === 'true';
  if (rep === 'true' || rep === 'false') st.repeat = rep === 'true';
  return st;
}

const CMDS = { play: 'play', pause: 'pause', playpause: 'playpause', next: 'next track', previous: 'previous track' };
async function macCmd(cmd, arg) {
  let action;
  if (cmd === 'volume') action = `set sound volume to ${Math.max(0, Math.min(100, Math.round(Number(arg) || 0)))}`;
  else if (cmd === 'seek') action = `set player position to ${Number(arg) || 0}`;
  else if (cmd === 'shuffle') action = `set shuffling to ${arg ? 'true' : 'false'}`;
  else if (cmd === 'repeat') action = `set repeating to ${arg ? 'true' : 'false'}`;
  else if (cmd === 'back') { // "previous" only restarts a song that has played a few seconds: rewind first so it really goes back
    await osa('if application "Spotify" is running then tell application "Spotify" to set player position to 0');
    action = 'previous track';
  }
  else action = CMDS[cmd];
  if (!action) return;
  await osa(`if application "Spotify" is running then tell application "Spotify" to ${action}`);
}


// ---------- Spotify bridge (Windows: PowerShell helper) ----------
let psProc = null, psReady = null, psInfo = null, psSeq = 0, psBuf = '';
let psFails = 0, psFailUntil = 0, psTimeouts = 0, psLongCalls = 0;
const psPending = new Map();
function psStart() {
  log('starting helper');
  psInfo = null;
  let resolveReady;
  const startedAt = Date.now();
  psReady = new Promise((r) => { resolveReady = r; });
  const proc = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'smtc.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  psProc = proc;
  psBuf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    psBuf += d;
    let i;
    while ((i = psBuf.indexOf('\n')) >= 0) {
      const line = psBuf.slice(0, i).trim();
      psBuf = psBuf.slice(i + 1);
      const sp = line.indexOf(' ');
      if (sp < 0) continue;
      const id = line.slice(0, sp), rest = line.slice(sp + 1);
      if (id === 'ready') {
        try { psInfo = JSON.parse(rest); } catch { psInfo = {}; }
        psFails = 0;
        log('helper ready: ' + rest);
        resolveReady(true);
      } else {
        const w = psPending.get(id);
        if (w) { psPending.delete(id); w(rest); }
      }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (d) => log('helper stderr: ' + String(d).trim().slice(0, 500)));
  const gone = (why) => {
    log('helper ' + why);
    if (psProc === proc) {
      psProc = null;
      // died right after starting (blocked PowerShell, policy...): back off instead of respawning every poll
      if (Date.now() - startedAt < 10000) { psFails++; psFailUntil = Date.now() + Math.min(60000, 2000 * 2 ** psFails); }
    }
    resolveReady(false);
    for (const [id, w] of psPending) { psPending.delete(id); w(''); }
  };
  proc.on('error', (e) => gone('failed to start: ' + e.message));
  proc.on('exit', (code) => gone('exited with code ' + code));
}
async function psCall(line, timeoutMs = 8000) {
  if (updating) return ''; // the update replaces the helper's files: keep it stopped until Minapp restarts
  if (!psProc) {
    if (Date.now() < psFailUntil) return '';
    psStart();
  }
  const ok = await Promise.race([psReady, new Promise((r) => setTimeout(() => r(false), 40000))]);
  if (!ok || !psProc) return '';
  const id = String(++psSeq);
  const proc = psProc;
  const long = timeoutMs > 8000;
  if (long) psLongCalls++;
  return new Promise((res) => {
    const t = setTimeout(() => {
      psPending.delete(id); res('');
      if (long) psLongCalls--;
      // a helper that stops answering is restarted rather than left hanging forever (but a helper busy with a
      // long job, such as a jump over many songs, is not unresponsive: the polls queued behind it just wait)
      if (!psLongCalls && ++psTimeouts >= 3) { psTimeouts = 0; log('helper unresponsive, restarting'); try { proc.kill(); } catch {} }
    }, timeoutMs);
    psPending.set(id, (r) => { clearTimeout(t); psTimeouts = 0; if (long) psLongCalls--; res(r); });
    try { proc.stdin.write(`${id} ${line}\n`); } catch { clearTimeout(t); psPending.delete(id); res(''); }
  });
}
app.on('before-quit', () => { try { psProc && psProc.kill(); } catch {} });

async function winState() {
  const raw = await psCall('state');
  try { return JSON.parse(raw); } catch { return { status: 'closed' }; }
}
async function winCmd(cmd, arg) {
  // Spotify's own volume, through the Windows per-app volume (Core Audio). Quietly ignored if unavailable.
  if (cmd === 'volume') return void (await psCall('vol ' + Math.max(0, Math.min(100, Math.round(Number(arg) || 0)))));
  if (cmd === 'seek') return void (await psCall('seek ' + (Number(arg) || 0)));
  if (cmd === 'shuffle' || cmd === 'repeat') return void (await psCall(`${cmd} ${arg ? 1 : 0}`));
  if (['play', 'pause', 'playpause', 'next', 'previous'].includes(cmd)) await psCall('cmd ' + cmd);
}

async function checkSpotify() {
  if (!isWin) return dialog.showMessageBox(win, { message: 'Only needed on Windows.' });
  const raw = await psCall('state');
  let how = 'helper did not start';
  if (psInfo) how = psInfo.smtc ? 'Windows media controls' : 'Spotify window title + media keys (media controls unavailable)';
  let seen = 'nothing', vol = 'unknown';
  try {
    const s = JSON.parse(raw);
    seen = s.status + (s.title ? ` — ${s.artist ? s.artist + ' - ' : ''}${s.title}` : '');
    if (typeof s.volume === 'number' && s.volume >= 0) vol = Math.round(s.volume) + '%';
  } catch {}
  const apo = apoDir();
  dialog.showMessageBox(win, {
    type: 'info', message: 'Spotify connection check',
    detail: `Connected through: ${how}\nSpotify currently reports: ${seen}\nSpotify volume control: ${vol === 'unknown' ? 'not available (start a song first)' : 'works (' + vol + ')'}\n` +
      `Spotify queue: ${readCfg().spotRefresh ? (spotifyQueue.err ? 'connected, but ' + spotifyQueue.err : spotifyQueue.items.length + ' upcoming songs read') : 'not connected (menu > Connect Spotify queue)'}\n`+
      `Equalizer APO (system EQ): ${apo ? 'found at ' + apo : 'not installed'}\n\n` +
      `If this says "closed", open the Spotify desktop app and start a song, then check again.\nA log is kept at:\n${bridgeLogPath()}`,
  });
}


// SKIN_FAKE=1 pretends Spotify is playing, so the UI can be tried and tested without it
const fake = { i: 0, t0: Date.now(), names: ['Intro', 'Skyline', 'Night Drive', 'Echoes', 'Parallel', 'Afterglow', 'Static', 'Harbor'] };
async function fakeState() {
  const dur = 200, pos = ((Date.now() - fake.t0) / 1000) % dur;
  const at = (k) => fake.names[((fake.i + k) % fake.names.length + fake.names.length) % fake.names.length];
  if (!fake.seeded) { fake.seeded = 1; history = [-2, -1].map((k) => ({ id: 'fh' + k, title: at(k), artist: 'Test Artist', duration: dur })); }
  spotifyQueue = { err: '', items: [1, 2, 3, 4, 5, 6, 7].map((k) => ({ id: 'f' + (fake.i + k), title: at(k), artist: 'Test Artist', duration: dur })) };
  return { status: 'playing', title: at(0), artist: 'Test Artist', id: 'f' + fake.i, duration: dur, position: pos, volume: 60, shuffle: false, repeat: false };
}
async function fakeCmd(cmd) { if (cmd === 'next') fake.i++; if (cmd === 'previous') fake.i--; log('fake cmd ' + cmd); }
const spotifyState = process.env.SKIN_FAKE ? fakeState : isWin ? winState : macState;
const spotifyCmd = process.env.SKIN_FAKE ? fakeCmd : isWin ? winCmd : macCmd;

// one entry point for every control: skin buttons, taskbar buttons, hotkeys
let jumping = false, queueHoldUntil = 0;
// right after a skip Spotify's Web API still reports the old queue for a few seconds: keep our own view, then re-read it
function holdQueue() { queueHoldUntil = Date.now() + 3500; setTimeout(refreshSpotifyQueue, 3600); }
async function doCmd(cmd, arg) {
  if (source === 'youtube' && cmd === 'download') return downloadCurrentYouTube();
  if (source === 'youtube') { if (ytWin) ytWin.webContents.send('yt:cmd', cmd, arg); return; }
  if (source === 'ytmusic') { if (ytmWin && cmd !== 'download') ytmWin.webContents.send('ytm:cmd', cmd, arg); return; }
  if (source === 'local') { if (localWin) localWin.webContents.send('local:cmd', cmd, arg); return; }
  if (cmd === 'jump') { // click on an upcoming title: Spotify's desktop app has no "play this one", so skip ahead to it
    const n = Math.max(-30, Math.min(40, Math.round(Number(arg) || 0))); // negative = back through the history
    if (!n || jumping) return;
    jumping = true;
    try {
      log(`jump ${n}: ` + (n > 0 ? spotifyQueue.items.slice(0, n) : history.slice(n)).map((x) => x.title).join(' > '));
      let done = Math.abs(n);
      if (isWin && !process.env.SKIN_FAKE) {
        // the helper skips one song at a time and waits for each to register; it reports how many really happened
        const raw = await psCall('skip ' + n, 45000);
        try { done = Number(JSON.parse(raw).skipped); } catch { done = 0; }
        if (!Number.isFinite(done)) done = 0;
        if (done < Math.abs(n)) log(`jump: only ${done} of ${Math.abs(n)} skips registered`);
      } else {
        for (let i = 0; i < Math.abs(n); i++) { await spotifyCmd(n > 0 ? 'next' : isMac ? 'back' : 'previous'); if (i < Math.abs(n) - 1) await new Promise((r) => setTimeout(r, 280)); }
      }
      // the list itself is updated when the new song shows up in the state (see trackHistory)
    } finally { jumping = false; holdQueue(); }
    return;
  }
  const r = await spotifyCmd(cmd, arg);
  if (cmd === 'previous') holdQueue();
  return r;
}


// ---------- Pin (always on top) ----------
let pinned = false;
// Widget mode ('small' = clock + visualizer, 'large' = clock + queue) always floats above other apps.
let widget = 'off';
function applyOnTop() {
  if (!win || win.isDestroyed()) return;
  if (pinned || (widget !== 'off' && readCfg().widgetTop !== false)) win.setAlwaysOnTop(true, 'screen-saver'); else win.setAlwaysOnTop(false);
}
function setWidget(mode, tell) {
  widget = mode === 'small' || mode === 'large' ? mode : 'off';
  writeCfg({ widget });
  applyOnTop();
  if (tell && win) win.webContents.send('widget:mode', widget);
  buildMenu();
}
ipcMain.handle('widget:get', () => widget);
ipcMain.on('widget:set', (_e, m) => setWidget(m, false));
function setPinned(v) {
  pinned = !!v;
  if (win) {
    applyOnTop();
    win.webContents.send('pin:state', pinned);
  }
  writeCfg({ onTop: pinned });
  buildMenu();
}
ipcMain.handle('pin:toggle', () => { setPinned(!pinned); return pinned; });
ipcMain.handle('pin:get', () => pinned);


// ---------- Equalizer + visualizer ----------
// Spotify (Windows): Equalizer APO, a free system-wide equalizer. The skin's sliders write its config file live,
//   so there is no re-routing, no extra delay and no risk of feedback.
// Spotify fallback (experimental): capture all system sound, mute the output, play it back through the EQ.
// YouTube: the player window's own sound is captured and run through Webamp's EQ.
// Visualizer: a capture that only listens (never mutes) feeds Webamp's analyser, so the bars and Milkdrop move.
const EQ_HZ = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const dbOf = (v) => (Number(v) / 100) * 24 - 12;
let eqOn = false, eqPref = 'apo', eqState = null;
let vizOn = true, capMode = null, vizFailed = false;

function apoDir() {
  if (!isWin) return null;
  const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files'].filter(Boolean);
  for (const r of roots) {
    const d = path.join(r, 'EqualizerAPO', 'config');
    if (fs.existsSync(path.join(d, 'config.txt'))) return d;
  }
  return null;
}
const APO_FILE = 'minapp_eq.txt';
const APO_LEGACY = 'spotifyskin_eq.txt'; // from the first versions: its include line is removed when found
const apoActive = () => eqOn && !isPlayerSrc() && eqPref === 'apo';

function apoEnsureInclude() {
  const d = apoDir();
  if (!d) return { ok: false, err: 'Equalizer APO was not found.' };
  try {
    const cfg = path.join(d, 'config.txt');
    const txt = fs.readFileSync(cfg, 'utf8');
    const legacy = new RegExp('^[ \\t]*Include:[ \\t]*' + APO_LEGACY.replace('.', '\\.') + '[ \\t]*\\r?\\n?', 'mi');
    if (legacy.test(txt)) { try { fs.copyFileSync(cfg, cfg + '.minapp.bak'); fs.writeFileSync(cfg, txt.replace(legacy, '')); } catch {} }
    if (!new RegExp('^\\s*Include:\\s*' + APO_FILE.replace('.', '\\.'), 'mi').test(txt)) {
      try { fs.copyFileSync(cfg, cfg + '.minapp.bak'); } catch {}
      fs.appendFileSync(cfg, `\r\nInclude: ${APO_FILE}\r\n`);
    }
    if (!fs.existsSync(path.join(d, APO_FILE))) fs.writeFileSync(path.join(d, APO_FILE), '');
    return { ok: true };
  } catch (e) { return { ok: false, err: (e && e.message) || String(e) }; }
}
let apoLast = null;
function apoText() {
  if (!apoActive() || !eqState || eqState.on === false) return '# Minapp: equalizer off\r\nPreamp: 0 dB\r\n';
  const s = eqState.sliders || {};
  const bands = EQ_HZ.map((hz) => dbOf(s[hz] == null ? 50 : s[hz]));
  const pre = dbOf(s.preamp == null ? 50 : s.preamp);
  // headroom: never let the boost push the signal past full scale
  const lift = Math.max(0, ...bands.map((b) => b + pre));
  const lines = ['# Written by Minapp. Edit the sliders in the skin, not this file.', `Preamp: ${(pre - lift).toFixed(1)} dB`];
  bands.forEach((g, i) => {
    const type = i === 0 ? 'LSC' : i === EQ_HZ.length - 1 ? 'HSC' : 'PK';
    lines.push(`Filter: ON ${type} Fc ${EQ_HZ[i]} Hz Gain ${g.toFixed(1)} dB Q ${i === 0 || i === EQ_HZ.length - 1 ? '0.7' : '1.4'}`);
  });
  return lines.join('\r\n') + '\r\n';
}
let apoErrShown = false;
function writeApo(force) {
  const d = apoDir();
  if (!d) return;
  const text = apoText();
  if (!force && text === apoLast) return;
  try { fs.writeFileSync(path.join(d, APO_FILE), text); apoLast = text; }
  catch (e) {
    log('could not write Equalizer APO file: ' + e.message);
    if (!apoErrShown && eqOn) {
      apoErrShown = true;
      dialog.showMessageBox(win, { type: 'warning', message: 'Could not update Equalizer APO', detail: `${e.message}\n\nGive your user write access to:\n${d}\nor run Minapp once as administrator.` });
    }
  }
}
// leave the system sound as we found it
app.on('before-quit', () => { eqOn = false; writeApo(true); });

let apoTimer = null, eqSeen = false;
ipcMain.on('eq:state', (_e, s) => {
  const wasOn = eqState ? eqState.on !== false : true;
  eqState = s;
  clearTimeout(apoTimer);
  apoTimer = setTimeout(() => { if (apoActive()) writeApo(); }, 60); // slider drags send many updates
  // pressing ON in the skin's EQ window turns the real equalizer on too, when that needs no setup questions
  if (eqSeen && !wasOn && s.on !== false && !eqOn && (isPlayerSrc() || (isWin && eqPref === 'apo' && apoDir() && apoEnsureInclude().ok))) { eqOn = true; applyAudio(); }
  eqSeen = true;
});
ipcMain.handle('cap:prepare', (_e, m) => true);
ipcMain.on('eq:message', (_e, text) => {
  eqOn = false; writeCfg({ eq: false }); buildMenu();
  dialog.showMessageBox(win, { type: 'warning', message: 'Equalizer sound switched off', detail: String(text) });
});

function installCaptureHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const m = capMode;
    try {
      if (m && m.src === 'youtube' && playerWin()) {
        const frame = playerWin().webContents.mainFrame;
        callback({ video: frame, audio: frame, enableLocalEcho: m.kind === 'viz' });
      } else if (m && m.src === 'system' && (isWin || isMac)) { // macOS 13+ also offers system audio; it asks for Screen Recording / audio permission once
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (!sources.length) throw new Error('no screen source (permission not granted)');
        callback({ video: sources[0], audio: m.kind === 'eq' ? 'loopbackWithMute' : 'loopback' });
      } else {
        try { callback({}); } catch {}
      }
    } catch (e) {
      log('capture handler failed: ' + ((e && e.message) || String(e)) + (isMac ? ' (on a Mac, allow Minapp under System Settings > Privacy & Security > Screen & System Audio Recording; the visualizer uses a generic beat until then)' : ''));
      try { callback({}); } catch { /* Electron throws when no stream is given; the capture request is rejected either way */ }
    }
  });
}

async function runCapture(mode) {
  capMode = mode;
  // executeJavaScript(..., true) counts as a user gesture, which getDisplayMedia needs
  return win.webContents.executeJavaScript(`window.__audioApply ? window.__audioApply(${JSON.stringify(mode)}) : 'not ready'`, true);
}

function desiredMode() {
  const src = isPlayerSrc() ? 'youtube' : 'system';
  let mode = null;
  if (eqOn && (src === 'youtube' || eqPref === 'capture')) mode = { kind: 'eq', src };
  else if (vizOn && !vizFailed) mode = { kind: 'viz', src };
  if (mode && mode.src === 'youtube' && !playerWin()) mode = null;
  if (mode && mode.src === 'system' && !isWin && !(isMac && mode.kind === 'viz')) mode = null; // on a Mac only the listen-only visualizer capture, never the mute-and-replay equalizer
  return mode;
}

// The listening capture can stop by itself (audio device switched, sleep/wake, a failed start).
// Every few seconds: if it should be running and is not, or it has been hearing only silence while music plays, restart it.
let capRetries = 0, capBusy = false;
async function capWatchdog() {
  if (!win || win.isDestroyed() || capBusy) return;
  const want = desiredMode();
  if (!want) { capRetries = 0; return; }
  let cur = null;
  try { cur = await win.webContents.executeJavaScript('window.__audioState ? window.__audioState() : null'); } catch { return; }
  if (cur === want.kind) { capRetries = 0; return; }
  if (capRetries >= 6) return; // give up for now (retried again after a source change or restart)
  capRetries++;
  log(`audio capture is ${cur || 'off'}, expected ${want.kind}: restarting (attempt ${capRetries})`);
  capBusy = true; vizFailed = false;
  try { await applyAudio(); } finally { capBusy = false; }
}
ipcMain.on('cap:lost', (_e, why) => { log('audio capture lost: ' + why); capRetries = Math.max(0, capRetries - 1); setTimeout(capWatchdog, 500); });

async function applyAudio() {
  if (!win) return;
  writeApo();
  let mode = desiredMode();
  try { await runCapture(mode); }
  catch (e) {
    const why = String((e && e.message) || e);
    log('audio capture failed (' + (mode && mode.kind) + '): ' + (e && e.message ? why : JSON.stringify(e) || why));
    if (mode && mode.kind === 'eq') {
      eqOn = false;
      dialog.showMessageBox(win, { type: 'warning', message: 'Could not start the equalizer sound', detail: why });
    } else vizFailed = true; // the visualizer is a nicety: stay quiet, retry only after a restart
    capMode = null;
  }
  writeCfg({ eq: eqOn, eqPref });
  buildMenu();
}

async function toggleEq() {
  if (eqOn) { eqOn = false; return applyAudio(); }
  if (isPlayerSrc()) { eqOn = true; return applyAudio(); }
  if (!isWin) {
    dialog.showMessageBox(win, { message: 'Equalizer sound for Spotify is only built for Windows.', detail: 'It works for the YouTube source on any system.' });
    return buildMenu();
  }
  if (apoDir()) {
    const r = apoEnsureInclude();
    if (!r.ok) {
      dialog.showMessageBox(win, { type: 'warning', message: 'Could not hook into Equalizer APO', detail: `${r.err}\n\nAdd this line to the end of Equalizer APO's config.txt yourself (or run Minapp as administrator once):\nInclude: ${APO_FILE}` });
      return buildMenu();
    }
    eqPref = 'apo'; eqOn = true;
    const first = !readCfg().apoTold;
    await applyAudio();
    if (first) {
      writeCfg({ apoTold: true });
      dialog.showMessageBox(win, { type: 'info', message: 'Equalizer is live',
        detail: 'The skin\'s EQ sliders now shape everything you hear in Spotify through Equalizer APO.\n\nIf you hear no change, open "Configurator" from the Equalizer APO start-menu folder and make sure your speakers/headphones are ticked under Playback devices, then restart Spotify once.' });
    }
    return;
  }
  const r = await dialog.showMessageBox(win, {
    type: 'info', buttons: ['Get Equalizer APO (recommended)', 'Try experimental capture', 'Cancel'], defaultId: 0, cancelId: 2,
    message: 'Windows needs a helper to equalize Spotify',
    detail: 'Windows does not let one app change another app\'s sound. The reliable fix is Equalizer APO, a free, tiny system equalizer that this skin then controls with its sliders:\n\n' +
      '1. Install it (opens the download page), tick your speakers/headphones in its Configurator, and restart Spotify.\n2. Choose Equalizer Sound again.\n\n' +
      'Or try the experimental capture mode: it records everything the PC plays, silences the normal output and replays it through the EQ. It can go silent or squeal on some setups.',
  });
  if (r.response === 0) { shell.openExternal('https://sourceforge.net/projects/equalizerapo/'); return buildMenu(); }
  if (r.response === 1) { eqPref = 'capture'; eqOn = true; return applyAudio(); }
  buildMenu();
}


// ---------- Now playing: title, tray tooltip, taskbar buttons, toasts ----------
function glyph(kind) {
  const N = 16, buf = Buffer.alloc(N * N * 4);
  const tri = (x, y, x0, x1) => x >= x0 && x <= x1 && Math.abs(y + 0.5 - 8) <= 6 * (x1 + 1 - x) / (x1 + 1 - x0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let on = false;
    if (kind === 'play') on = tri(x, y, 4, 13);
    else if (kind === 'pause') on = y >= 2 && y <= 13 && ((x >= 3 && x <= 6) || (x >= 9 && x <= 12));
    else if (kind === 'next') on = tri(x, y, 2, 10) || (y >= 2 && y <= 13 && x >= 11 && x <= 13);
    else if (kind === 'prev') on = tri(N - 1 - x, y, 2, 10) || (y >= 2 && y <= 13 && x >= 2 && x <= 4);
    if (on) { const o = (y * N + x) * 4; buf[o] = buf[o + 1] = buf[o + 2] = buf[o + 3] = 255; }
  }
  return nativeImage.createFromBitmap(buf, { width: N, height: N });
}
let thumbIcons = null, thumbPlaying = null;
function updateThumbar(playing) {
  if (!isWin || !win || win.isDestroyed()) return;
  if (playing === thumbPlaying) return;
  thumbPlaying = playing;
  try {
    thumbIcons = thumbIcons || { prev: glyph('prev'), play: glyph('play'), pause: glyph('pause'), next: glyph('next') };
    win.setThumbarButtons([
      { tooltip: 'Previous', icon: thumbIcons.prev, click: () => doCmd('previous') },
      { tooltip: playing ? 'Pause' : 'Play', icon: playing ? thumbIcons.pause : thumbIcons.play, click: () => doCmd('playpause') },
      { tooltip: 'Next', icon: thumbIcons.next, click: () => doCmd('next') },
    ]);
  } catch (e) { log('taskbar buttons failed: ' + e.message); }
}
let lastNowId = null, lastTitle = '';
function onNowPlaying(st) {
  const playing = st.status === 'playing';
  const label = st.title ? `${st.artist ? st.artist + ' - ' : ''}${st.title}` : '';
  try {
    const title = label || 'Minapp';
    if (title !== lastTitle) {
      lastTitle = title;
      if (win && !win.isDestroyed()) win.setTitle(title);
      if (tray) tray.setToolTip((label ? label + '\n' : '') + 'Minapp');
    }
  } catch {}
  updateThumbar(playing);
  widgetBridge.publish(st);
  const id = st.id || null;
  if (id && id !== lastNowId && st.title) {
    lastNowId = id;
    if (readCfg().toasts && Notification.isSupported() && !(win && win.isVisible() && win.isFocused())) {
      try { new Notification({ title: st.title, body: st.artist || '', silent: true }).show(); } catch {}
    }
  }
}


// ---------- Queue (read-only view in the playlist window) ----------
// YouTube: the player knows the playlist order; titles come from YouTube's public oEmbed endpoint.
const ytTitles = new Map();
let ytFetching = false;
async function fetchYtTitles(ids) {
  if (ytFetching) return;
  ytFetching = true;
  try {
    const todo = ids.filter((id) => !ytTitles.has(id));
    for (let i = 0; i < todo.length; i += 6) { // a few at a time: much quicker than one by one
      await Promise.all(todo.slice(i, i + 6).map(async (id) => {
        try {
          const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
          if (r.ok) { const j = await r.json(); ytTitles.set(id, { title: j.title || id, artist: j.author_name || '' }); }
          else ytTitles.set(id, { title: '(unavailable)', artist: '' });
        } catch {}
      }));
    }
  } finally { ytFetching = false; }
}
function ytHistory() {
  const ids = ytState.playlist || [], idx = typeof ytState.index === 'number' ? ytState.index : -1;
  if (!ids.length || idx <= 0) return [];
  const past = ids.slice(Math.max(0, idx - 30), idx);
  const missing = past.filter((id) => !ytTitles.has(id));
  if (missing.length) fetchYtTitles(missing);
  return past.map((id) => { const t = ytTitles.get(id); return { id: 'h' + id, title: t ? t.title : 'Loading…', artist: t ? t.artist : '', duration: 0 }; });
}
function ytQueue() {
  const ids = ytState.playlist || [], idx = typeof ytState.index === 'number' ? ytState.index : -1;
  if (!ids.length || idx < 0) return [];
  const upcoming = ids.slice(idx + 1, idx + 31);
  const missing = upcoming.filter((id) => !ytTitles.has(id));
  if (missing.length) fetchYtTitles(missing);
  return upcoming.map((id) => {
    const t = ytTitles.get(id);
    return { id, title: t ? t.title : 'Loading…', artist: t ? t.artist : '', duration: 0 };
  });
}

// Spotify: the desktop app exposes no queue, so this uses Spotify's Web API (one-time login, PKCE, no secret).
const SPOT_PORT = 8898;
const SPOT_REDIRECT = `http://127.0.0.1:${SPOT_PORT}/callback`;
const SPOT_SCOPE = 'user-read-playback-state user-read-currently-playing user-modify-playback-state playlist-read-private playlist-read-collaborative user-library-read user-library-modify';
let spotAccess = null, spotExpires = 0, spotBackoffUntil = 0, spotQueueBusy = false, spotLastId = null;
let spotifyQueue = { items: [], err: '' };
let spotCur = null; // { title, id } of the song the Web API reports (Windows media controls give no Spotify id)
let spotArt = null; // album picture of the song Spotify reports as playing
const SPOT_IMG = /^https:\/\/([\w-]+\.)*(scdn\.co|spotifycdn\.com)\//;
const artCache = new Map();
const thumbTries = new Map();
const thumbCache = new Map(); // 'thumb:artist|title' -> data URL from Windows' media controls
// Windows: Spotify hands its cover to the Windows media controls; the helper reads it once per song
function winThumb(st) {
  const k = 'thumb:' + (st.artist || '') + '|' + st.title;
  if (thumbCache.has(k)) return thumbCache.get(k) ? k : '';
  thumbCache.set(k, '');
  psCall('thumb', 8000).then((raw) => {
    let j = {}; try { j = JSON.parse(raw); } catch {}
    if (j.data && /^image\/[\w.+-]+$/.test(j.type || 'image/jpeg')) thumbCache.set(k, 'data:' + (j.type || 'image/jpeg') + ';base64,' + j.data);
    else { // Spotify may add the picture a moment later: ask again a few times
      log('cover from media controls: ' + (j.err || 'none'));
      const n = (thumbTries.get(k) || 0) + 1; thumbTries.set(k, n);
      if (n < 4) setTimeout(() => thumbCache.delete(k), 4000);
    }
  });
  if (thumbCache.size > 30) { const old = thumbCache.keys().next().value; thumbCache.delete(old); thumbTries.delete(old); }
  return '';
}
const oembedCache = new Map(); // spotify track id -> cover url ('' = none found) // url -> data URL
let lastSongTitle = '';
let history = [], prevSong = null; // songs already played, oldest first, so the playlist can scroll back
const norm = (t) => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function spotToken(form) {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || ('HTTP ' + r.status));
  spotAccess = j.access_token;
  spotExpires = Date.now() + (Number(j.expires_in) - 60) * 1000;
  if (j.refresh_token) writeCfg({ spotRefresh: j.refresh_token });
  if (j.scope) writeCfg({ spotScope: j.scope }); // remembers what the login allows (playlists need more than the queue did)
}
async function spotAccessToken() {
  if (spotAccess && Date.now() < spotExpires) return spotAccess;
  const cfg = readCfg();
  if (!cfg.spotRefresh || !cfg.spotClientId) return null;
  await spotToken({ grant_type: 'refresh_token', refresh_token: cfg.spotRefresh, client_id: cfg.spotClientId });
  return spotAccess;
}
async function refreshSpotifyQueue() {
  if (spotQueueBusy || Date.now() < spotBackoffUntil || Date.now() < queueHoldUntil || !readCfg().spotRefresh) return;
  spotQueueBusy = true;
  try {
    const tok = await spotAccessToken();
    if (!tok) return;
    const r = await fetch('https://api.spotify.com/v1/me/player/queue', { headers: { Authorization: 'Bearer ' + tok } });
    if (r.status === 401) { spotAccess = null; return; }
    if (r.status === 429) { spotBackoffUntil = Date.now() + (Number(r.headers.get('retry-after')) || 10) * 1000; return; }
    if (r.status === 204) { spotifyQueue = { items: [], err: '' }; return; }
    if (!r.ok) { spotifyQueue = { items: spotifyQueue.items, err: 'HTTP ' + r.status }; log('queue request failed: HTTP ' + r.status); return; }
    const j = await r.json();
    // Spotify's API can lag behind the app: if it still thinks another song is playing, its queue is stale, so retry shortly
    const cp = j.currently_playing && j.currently_playing.name;
    const imgs = (j.currently_playing && j.currently_playing.album && j.currently_playing.album.images) || [];
    const pick = imgs.filter((i) => i.width >= 64).pop() || imgs[imgs.length - 1]; // smallest picture that is still 64 px or more
    spotArt = cp && pick ? { title: norm(cp), url: pick.url } : null;
    spotCur = cp && j.currently_playing.id ? { title: norm(cp), id: j.currently_playing.id, album: (j.currently_playing.album && j.currently_playing.album.name) || '' } : spotCur;
    if (cp && lastSongTitle && norm(cp) !== norm(lastSongTitle)) { spotBackoffUntil = Date.now() + 1500; setTimeout(refreshSpotifyQueue, 1600); return; }
    const items = (j.queue || []).slice(0, 30).map((t) => ({
      id: t.id || t.uri, title: t.name || '',
      artist: t.artists ? t.artists.map((a) => a.name).join(', ') : ((t.show && t.show.name) || ''),
      duration: (t.duration_ms || 0) / 1000,
    }));
    spotifyQueue = { items, err: '' };
    log('queue: ' + items.slice(0, 4).map((x) => x.title).join(' | ') + (items.length > 4 ? ` (+${items.length - 4})` : ''));
  } catch (e) {
    spotifyQueue = { items: spotifyQueue.items, err: String((e && e.message) || e) };
    log('queue error: ' + spotifyQueue.err);
  } finally { spotQueueBusy = false; }
}

async function connectSpotifyQueue() {
  let clientId = readCfg().spotClientId;
  if (!clientId) {
    const r = await dialog.showMessageBox(win, {
      type: 'info', buttons: ['Open Spotify dashboard', 'I have my Client ID', 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'One-time setup for the Spotify queue',
      detail: '1. On the dashboard, log in and choose Create app (any name).\n' +
              `2. Redirect URI: ${SPOT_REDIRECT}\n` +
              '3. Tick "Web API", save, then copy the Client ID.\n\n' +
              'Spotify requires the app owner to have Premium for new apps. Then choose "I have my Client ID".',
    });
    if (r.response === 2) return;
    if (r.response === 0) { shell.openExternal('https://developer.spotify.com/dashboard'); return; }
    const id = await askText({ title: 'Spotify Client ID', label: 'Paste the Client ID of your Spotify app:', placeholder: '32 letters and numbers', button: 'Connect' });
    if (!id) return;
    if (!/^[0-9a-f]{20,40}$/i.test(id.trim())) {
      dialog.showMessageBox(win, { type: 'warning', message: "That doesn't look like a Client ID", detail: 'It is a 32-character code shown on your app page in the Spotify dashboard.' });
      return;
    }
    clientId = id.trim();
    writeCfg({ spotClientId: clientId });
  }
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));
  const code = await new Promise((resolve) => {
    let timer = null;
    const srv = http.createServer((req, resp) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/callback') { resp.writeHead(404); resp.end(); return; }
      const good = u.searchParams.get('state') === state && u.searchParams.get('code');
      resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      resp.end(good ? 'Connected. You can close this tab and go back to the player.' : 'Something went wrong. Close this tab and try again.');
      clearTimeout(timer); srv.close(); resolve(good ? u.searchParams.get('code') : null);
    });
    srv.on('error', (e) => {
      clearTimeout(timer);
      dialog.showMessageBox(win, { type: 'warning', message: 'Could not start the login', detail: `Port ${SPOT_PORT} is unavailable (${e.code || e.message}). Close whatever uses it and try again.` });
      resolve(null);
    });
    srv.listen(SPOT_PORT, '127.0.0.1', () => {
      timer = setTimeout(() => { srv.close(); resolve(null); }, 180000);
      shell.openExternal('https://accounts.spotify.com/authorize?' + new URLSearchParams({
        response_type: 'code', client_id: clientId, redirect_uri: SPOT_REDIRECT,
        scope: SPOT_SCOPE,
        code_challenge_method: 'S256', code_challenge: challenge, state,
      }).toString());
    });
  });
  if (!code) return;
  try {
    await spotToken({ grant_type: 'authorization_code', code, redirect_uri: SPOT_REDIRECT, client_id: clientId, code_verifier: verifier });
  } catch (e) {
    dialog.showMessageBox(win, { type: 'warning', message: 'Spotify login failed', detail: String((e && e.message) || e) });
    return;
  }
  await refreshSpotifyQueue();
  buildMenu();
  dialog.showMessageBox(win, {
    message: 'Spotify connected',
    detail: spotifyQueue.err ? `Connected, but Spotify answered: ${spotifyQueue.err}` : 'Open the playlist (PL) window to see what is coming up, and press its LIST button to pick one of your Spotify playlists.',
  });
}
function disconnectSpotifyQueue() {
  writeCfg({ spotRefresh: null, spotClientId: null, spotScope: null });
  spotLists = null;
  spotAccess = null; spotifyQueue = { items: [], err: '' };
  buildMenu();
}

// ---------- Spotify playlist picker (LIST button of the playlist window) ----------
// Spotify's Web API lists playlists but not the folders you may have made in the desktop app, so the picker groups
// them as "Liked Songs", "My playlists" and "Saved from others".
let spotLists = null; // { at, data }
async function spotApi(path, tok) {
  const r = await fetch('https://api.spotify.com/v1' + path, { headers: { Authorization: 'Bearer ' + tok } });
  if (r.status === 429) throw new Error('Spotify is busy, try again in a moment');
  if (r.status === 401 || r.status === 403) { const e = new Error('HTTP ' + r.status); e.auth = true; throw e; }
  if (!r.ok) throw new Error('Spotify answered HTTP ' + r.status);
  return r.json();
}
async function getSpotifyPlaylists(force) {
  const cfg = readCfg();
  if (!cfg.spotRefresh || !cfg.spotClientId) return { status: 'login' };
  if (!String(cfg.spotScope || '').includes('playlist-read-private')) return { status: 'rescope' }; // connected before playlists existed
  if (!force && spotLists && Date.now() - spotLists.at < 60000) return spotLists.data;
  try {
    const tok = await spotAccessToken();
    if (!tok) return { status: 'login' };
    const me = await spotApi('/me', tok);
    const items = [];
    let path = '/me/playlists?limit=50';
    for (let page = 0; path && page < 20; page++) { // up to 1000 playlists
      const j = await spotApi(path, tok);
      for (const p of j.items || []) {
        if (!p || !p.id) continue;
        const n = p.items && p.items.total != null ? p.items.total : (p.tracks && p.tracks.total);
        items.push({ id: p.id, name: p.name || '(no name)', tracks: typeof n === 'number' ? n : null, mine: !!(p.owner && p.owner.id === me.id) });
      }
      path = j.next ? j.next.replace('https://api.spotify.com/v1', '') : null;
    }
    const data = { status: 'ok', userId: me.id, items };
    spotLists = { at: Date.now(), data };
    log('playlists: ' + items.length);
    return data;
  } catch (e) {
    log('playlists error: ' + ((e && e.message) || e));
    if (e && e.auth) { spotAccess = null; return { status: 'rescope' }; }
    return { status: 'error', message: String((e && e.message) || e) };
  }
}
async function playSpotifyContext(uri) {
  if (!/^spotify:(playlist:[A-Za-z0-9]+|user:[^:\s]+:collection)$/.test(uri)) return { ok: false, message: 'Unknown playlist' };
  if (source !== 'spotify') await setSource('spotify');
  if (isMac && !process.env.SKIN_FAKE) {
    // the desktop app plays a playlist straight from its address (it is started first if it is closed)
    await osa('if application "Spotify" is not running then tell application "Spotify" to activate');
    for (let i = 0; i < 20 && (await osa('if application "Spotify" is running then return "yes"')) !== 'yes'; i++) await new Promise((r) => setTimeout(r, 500));
    if ((await osa(`tell application "Spotify" to play track "${uri}"`)) !== null) { holdQueue(); return { ok: true }; }
  }
  try { // Windows (and a Mac where the script failed): Spotify's Web API starts it on the device that is open
    const tok = await spotAccessToken();
    if (tok) {
      const r = await fetch('https://api.spotify.com/v1/me/player/play', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify({ context_uri: uri }),
      });
      if (r.status === 204 || r.status === 200) { holdQueue(); return { ok: true }; }
      log('play playlist: HTTP ' + r.status);
    }
  } catch (e) { log('play playlist error: ' + ((e && e.message) || e)); }
  shell.openExternal(uri); // last resort: Spotify opens the playlist, one press of its play button starts it
  return { ok: true, opened: true };
}
ipcMain.handle('spotlists:get', (_e, force) => getSpotifyPlaylists(!!force));
ipcMain.handle('spotlists:play', (_e, uri) => playSpotifyContext(String(uri || '')));
ipcMain.on('spotlists:connect', () => { connectSpotifyQueue().then(() => { spotLists = null; }); });

// Cover of a track through Spotify's public oEmbed address (no login). The first call starts the lookup and returns nothing;
// the next state poll finds it in the cache.
function spotCover(id) {
  const m = /^(?:spotify:track:)?([A-Za-z0-9]{22})$/.exec(String(id));
  if (!m) return '';
  const k = m[1];
  if (oembedCache.has(k)) return oembedCache.get(k);
  oembedCache.set(k, ''); // marks "looking"
  fetch('https://open.spotify.com/oembed?url=' + encodeURIComponent('spotify:track:' + k))
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((j) => { const u = String(j.thumbnail_url || ''); if (SPOT_IMG.test(u)) oembedCache.set(k, u); else log('cover: unexpected address ' + u.slice(0, 80)); })
    .catch((e) => { setTimeout(() => oembedCache.delete(k), 30000); log('cover lookup failed: ' + ((e && e.message) || e)); }); // offline: ask again in 30 s, not on every poll
  if (oembedCache.size > 200) oembedCache.delete(oembedCache.keys().next().value);
  return '';
}

// ---------- Spotify: heart button = add to / remove from Liked Songs ----------
const likedCache = new Map(); // track id -> true/false (absent = not asked yet)
const trackIdOf = (id) => { const m = /([A-Za-z0-9]{22})$/.exec(String(id || '')); return m ? m[1] : null; };
async function spotLibrary(method, tid) { // Spotify's newer /me/library address first, the older /me/tracks one as fallback
  const tok = await spotAccessToken();
  if (!tok) { const e = new Error('login'); e.login = true; throw e; }
  const H = { Authorization: 'Bearer ' + tok };
  const tries = method === 'GET'
    ? [`/me/library/contains?uris=${encodeURIComponent('spotify:track:' + tid)}`, `/me/tracks/contains?ids=${tid}`]
    : [`/me/library?uris=${encodeURIComponent('spotify:track:' + tid)}`, `/me/tracks?ids=${tid}`];
  let last = 0;
  for (const t of tries) {
    const r = await fetch('https://api.spotify.com/v1' + t, { method, headers: H });
    last = r.status;
    if (r.ok) return method === 'GET' ? !!(await r.json())[0] : true;
    if (r.status === 401 || r.status === 403) { const e = new Error('scope'); e.scope = true; throw e; }
    if (r.status === 429) throw new Error('Spotify is busy, try again in a moment');
  }
  throw new Error('Spotify answered HTTP ' + last);
}
function checkLiked(id) {
  const tid = trackIdOf(id);
  if (!tid || likedCache.has(tid) || !readCfg().spotRefresh || !String(readCfg().spotScope || '').includes('user-library-read')) return;
  likedCache.set(tid, false); // marks "asking"
  spotLibrary('GET', tid).then((v) => likedCache.set(tid, v)).catch((e) => { setTimeout(() => { if (likedCache.get(tid) === false) likedCache.delete(tid); }, 30000); log('liked check failed: ' + e.message); }); // ask again in 30 s, not on every poll
  if (likedCache.size > 100) likedCache.delete(likedCache.keys().next().value);
}
// the playing song's Spotify id from the Web API (needed on Windows, whose media controls only give title and artist)
async function apiTrackId(title) {
  if (spotCur && title && spotCur.title === norm(title)) return spotCur.id;
  try {
    const tok = await spotAccessToken();
    if (!tok) return null;
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing', { headers: { Authorization: 'Bearer ' + tok } });
    if (r.status !== 200) { log('currently-playing: HTTP ' + r.status); return null; }
    const j = await r.json();
    if (!j.item || !j.item.id) return null;
    spotCur = { title: norm(j.item.name), id: j.item.id, album: (j.item.album && j.item.album.name) || '' };
    return j.item.id;
  } catch (e) { log('currently-playing error: ' + e.message); return null; }
}
let likeBusy = false;
async function toggleLike() {
  if (likeBusy) return;
  likeBusy = true;
  try {
    const st = (await spotifyState()) || {};
    const cfg = readCfg();
    if (!cfg.spotRefresh || !String(cfg.spotScope || '').includes('user-library-modify')) {
      const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['Connect Spotify', 'Cancel'], defaultId: 0, cancelId: 1, message: 'The heart needs Spotify connected' + (cfg.spotRefresh ? ' once more' : ''),
        detail: cfg.spotClientId ? 'It lets Minapp add songs to your Liked Songs. Your Spotify app Client ID is kept, so this is one click and a browser approval.'
          : 'It lets Minapp add songs to your Liked Songs. The first time, Minapp shows how to make a free Spotify app Client ID (a few minutes, once).' });
      if (r.response === 0) { await connectSpotifyQueue(); }
      return;
    }
    let tid = trackIdOf(st.id) || await apiTrackId(st.title);
    if (!tid) { dialog.showMessageBox(win, { message: 'Nothing to like', detail: st.title ? 'Spotify did not say which song is playing. Try again in a few seconds.' : 'Start a Spotify song first.' }); return; }
    let was = likedCache.get(tid);
    if (was === undefined) was = await spotLibrary('GET', tid);
    await spotLibrary(was ? 'DELETE' : 'PUT', tid);
    likedCache.set(tid, !was);
    log((was ? 'unliked ' : 'liked ') + tid);
  } catch (e) {
    if (e.scope || e.login) { writeCfg({ spotScope: null }); dialog.showMessageBox(win, { message: 'Spotify needs to be connected again', detail: 'Use the heart once more and choose Connect Spotify.' }); }
    else dialog.showMessageBox(win, { type: 'warning', message: 'Could not update Liked Songs', detail: String((e && e.message) || e) });
  } finally { likeBusy = false; }
}
ipcMain.handle('spotify:like', () => toggleLike());

// Remember what played. When the song changes it also works out whether we moved forward through the queue
// (the skipped songs go to the history) or back through the history (they return to the front of the queue).
function trackHistory(st) {
  const prev = prevSong;
  prevSong = { id: st.id, title: st.title, artist: st.artist, duration: st.duration };
  if (!prev) return;
  const items = spotifyQueue.items;
  const k = items.findIndex((x) => norm(x.title) === norm(st.title));
  if (k >= 0) {
    history.push(prev, ...items.slice(0, k));
    spotifyQueue.items = items.slice(k + 1);
  } else {
    const h = history.map((x) => norm(x.title)).lastIndexOf(norm(st.title));
    if (h >= 0) {
      spotifyQueue.items = [...history.slice(h + 1), prev, ...items];
      history = history.slice(0, h);
    } else history.push(prev);
  }
  history = history.slice(-30);
}

// ---------- YouTube source ----------
// A small embedded YouTube player (the official IFrame player) does the playing.
// It stays a visible window because YouTube's rules don't allow a hidden player.
function startYtServer() {
  return new Promise((resolve) => {
    if (ytServer) return resolve();
    ytServer = http.createServer((req, resp) => {
      if (req.url.split('?')[0] === '/yt.html') {
        resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        resp.end(fs.readFileSync(path.join(__dirname, 'yt.html')));
      } else { resp.writeHead(404); resp.end(); }
    });
    ytServer.listen(0, '127.0.0.1', () => { ytPort = ytServer.address().port; resolve(); });
  });
}

function parseYouTube(text) {
  let u;
  try { u = new URL(String(text).trim()); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be') return null;
  const list = u.searchParams.get('list');
  let v = u.searchParams.get('v');
  if (host === 'youtu.be') v = u.pathname.slice(1) || v;
  if (!list && !v) return null;
  return { list: list || null, v: list ? null : v };
}

async function openYouTube(target) {
  await startYtServer();
  const qs = new URLSearchParams();
  if (target.list) qs.set('list', target.list);
  if (target.v) qs.set('v', target.v);
  if (target.ids) qs.set('ids', target.ids.join(','));
  const url = `http://localhost:${ytPort}/yt.html?${qs}`;
  ytState = { status: 'closed' };
  if (!ytWin) {
    ytWin = new BrowserWindow({
      width: 340, height: 230, minWidth: 200, minHeight: 200, title: 'YouTube', icon: path.join(__dirname, isWin ? 'icon.ico' : 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'yt-preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    ytWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ytWin.on('closed', () => { ytWin = null; ytState = { status: 'closed' }; if (source === 'youtube') applyAudio(); });
    const [x, y] = win.getPosition();
    ytWin.setPosition(x, y + Math.round(lastSize.h * zoom) + 12);
  }
  ytWin.webContents.once('did-finish-load', () => { if (eqOn || vizOn) setTimeout(applyAudio, 1500); });
  ytWin.loadURL(url);
  if (readCfg().ytHidden) ytWin.hide(); else ytWin.show();
}

// Small window with a text box, prefilled from the clipboard when it holds a YouTube link.
function askText({ title, label, placeholder = '', value = '', button = 'OK' }) {
  return new Promise((resolve) => {
    const pw = new BrowserWindow({
      width: 480, height: 160, resizable: false, minimizable: false, maximizable: false,
      title, alwaysOnTop: true, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'prompt-preload.js'), contextIsolation: true },
    });
    pw.setMenuBarVisibility(false);
    pw.loadFile('prompt.html', { query: { t: title, l: label, p: placeholder, v: value, b: button } });
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      ipcMain.removeListener('prompt:submit', onSubmit);
      ipcMain.removeListener('prompt:cancel', onCancel);
      if (!pw.isDestroyed()) pw.close();
      resolve(val);
    };
    const onSubmit = (e, text) => { if (e.sender === pw.webContents) finish(text); };
    const onCancel = (e) => { if (e.sender === pw.webContents) finish(null); };
    ipcMain.on('prompt:submit', onSubmit);
    ipcMain.on('prompt:cancel', onCancel);
    pw.on('closed', () => finish(null));
  });
}

// Small window with a text box, prefilled from the clipboard when it holds a YouTube link.
function askForLink() {
  const clip = clipboard.readText();
  return askText({
    title: 'YouTube link', label: 'Paste a YouTube playlist or video link:',
    placeholder: 'https://www.youtube.com/playlist?list=…', value: parseYouTube(clip) ? clip.trim() : '', button: 'Play',
  });
}

// Ask for a link and remember it. Returns true if we now have a valid one.
async function chooseYouTube() {
  const text = await askForLink();
  if (!text) return false;
  const target = parseYouTube(text);
  if (!target) {
    dialog.showMessageBox({
      type: 'warning', message: "That doesn't look like a YouTube link",
      detail: 'Paste a playlist or video link, e.g. https://www.youtube.com/playlist?list=… or https://www.youtube.com/watch?v=…',
    });
    return false;
  }
  writeCfg({ yt: target });
  return true;
}

// The video can be hidden: it keeps playing, only the window goes away.
function setYtHidden(h) {
  writeCfg({ ytHidden: !!h });
  if (ytWin && source === 'youtube') { if (h) ytWin.hide(); else ytWin.show(); }
  buildMenu();
}

// ---------- YouTube account + YouTube Music (experiment) ----------
// Sign-in goes through the user's normal browser (see ytapi.js); the playlists it lists are played by the YouTube player.
const ytApi = require('./ytapi').create({
  shell, dialog, readCfg, writeCfg, askText, log, getWin: () => win, onChange: () => buildMenu(),
});

async function playMyPlaylist(p) {
  try {
    const ids = await ytApi.videoIds(p.id);
    if (!ids.length) { dialog.showMessageBox(win, { message: `"${p.title}" has no videos`, detail: 'Nothing to play.' }); return; }
    writeCfg({ yt: { ids, list: null, v: null, name: p.title } });
    await setSource('youtube');
  } catch (e) {
    dialog.showMessageBox(win, { type: 'warning', message: 'Could not open that playlist', detail: String((e && e.message) || e) });
  }
}

function accountMenu() {
  if (!ytApi.signedIn()) return [{ label: 'Sign in with your browser…', click: () => ytApi.signIn() }];
  const pl = ytApi.playlists();
  return [
    { label: 'Signed in to YouTube', enabled: false },
    { label: ytApi.loading() ? 'Loading playlists…' : (ytApi.error() ? 'Could not load: ' + ytApi.error().slice(0, 60) : 'Your playlists'), enabled: false },
    ...pl.map((p) => ({ label: p.title + (p.count != null ? ` (${p.count})` : ''), click: () => playMyPlaylist(p) })),
    { type: 'separator' },
    { label: 'Refresh playlists', click: () => ytApi.refreshPlaylists() },
    { label: 'Sign out', click: () => ytApi.signOut() },
  ];
}

async function openYouTubeMusic() {
  if (!ytmWin) {
    ytmWin = new BrowserWindow({
      width: 1000, height: 700, minWidth: 400, minHeight: 300, title: 'YouTube Music', icon: path.join(__dirname, isWin ? 'icon.ico' : 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'ytm-preload.js'), contextIsolation: true, backgroundThrottling: false },
    });
    ytmWin.setMenuBarVisibility(false);
    ytmWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/(music|accounts)\.(youtube|google)\.com\//.test(url)) ytmWin.loadURL(url); return { action: 'deny' }; });
    ytmWin.on('closed', () => { ytmWin = null; ytmState = { status: 'closed' }; if (source === 'ytmusic') applyAudio(); });
    ytmWin.webContents.once('did-finish-load', () => { if (eqOn || vizOn) setTimeout(applyAudio, 1500); });
    ytmWin.loadURL('https://music.youtube.com/');
  }
  ytmWin.show();
  ytmWin.focus();
}

ipcMain.on('ytm:state', (_e, s) => { ytmState = s || { status: 'closed' }; });

// ---------- Local playlists + YouTube download (personal use) ----------
const library = require('./library').create({ dir: path.join(app.getPath('userData'), 'library'), binDir: path.join(app.getPath('userData'), 'bin'), log });
const { songInfo } = require('./songinfo');

async function playLocal(name, start = 0) {
  const tracks = library.tracks(name);
  if (!tracks.length) { dialog.showMessageBox(win, { message: `"${name}" has no songs yet` }); return; }
  try { await runCapture(null); } catch {}
  await spotifyCmd('pause');
  if (ytWin) { ytWin.webContents.send('yt:cmd', 'pause'); ytWin.hide(); }
  if (ytmWin) ytmWin.webContents.send('ytm:cmd', 'pause');
  localList = tracks; localName = name; writeCfg({ localPlaylist: name });
  source = 'local'; writeCfg({ source });
  localState = { status: 'closed' };
  if (!localWin) {
    localWin = new BrowserWindow({ show: false, width: 200, height: 100, webPreferences: { preload: path.join(__dirname, 'local-preload.js'), contextIsolation: true, backgroundThrottling: false } });
    localWin.on('closed', () => { localWin = null; localState = { status: 'closed' }; });
    await localWin.loadFile('local.html');
  }
  localWin.webContents.send('local:cmd', 'load', { tracks, start });
  await applyAudio();
}

async function importIntoPlaylist(folderMode) {
  const r = await dialog.showOpenDialog(win, folderMode
    ? { title: 'Import a folder of music', properties: ['openDirectory'] }
    : { title: 'Import music', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'opus', 'ogg', 'oga', 'webm', 'wav', 'flac'] }] });
  if (r.canceled || !r.filePaths.length) return;
  let name, files;
  if (folderMode) { name = path.basename(r.filePaths[0]); files = library.audioIn(r.filePaths[0]); }
  else {
    name = await askText({ title: 'Playlist name', label: 'Add these songs to which playlist?', value: localName || 'My music', button: 'Import' });
    if (!name) return;
    files = r.filePaths;
  }
  const n = library.importFiles(name, files);
  dialog.showMessageBox(win, { message: n ? `Added ${n} song${n === 1 ? '' : 's'} to "${library.safeName(name)}"` : 'Nothing new to add', detail: n ? '' : 'The files were already there, or are not audio files.' });
  buildMenu();
}

// ---------- Updates (GitHub Releases) ----------
const updater = require('./updater');
if (updater.cleanupOld) updater.cleanupOld(__dirname); // files an earlier update could not overwrite while they were in use
let updateInfo = null, updating = false;
async function checkForUpdate(manual) {
  if (updating) return;
  let info;
  try { info = await updater.check(app.getVersion()); }
  catch (e) {
    log('update check failed: ' + e.message);
    if (manual) dialog.showMessageBox(win, { type: 'error', message: 'Could not check for updates', detail: 'Check your internet connection and try again.\n\n' + e.message });
    return;
  }
  writeCfg({ updCheck: Date.now() });
  updateInfo = info.newer ? info : null; buildMenu();
  if (win && !win.isDestroyed()) win.webContents.send('update:available', updateInfo ? updateInfo.latest : null);
  if (!info.newer) {
    if (manual) dialog.showMessageBox(win, { message: `Minapp is up to date (version ${app.getVersion()})`, detail: info.none ? 'No release has been published on GitHub yet.' : '' });
    return;
  }
  if (!manual) { // the light bulb shows it (no Windows/Mac notification)
    return;
  }
  await installUpdate();
}
// Windows: the Spotify/volume helper (PowerShell) keeps skinvol.dll open, which blocks replacing it; stop it first
// (psCall leaves it stopped while an update runs)
async function stopHelper() {
  if (!psProc) return;
  const p = psProc;
  await new Promise((r) => { p.once('exit', r); try { p.kill(); } catch { r(); } setTimeout(r, 4000); });
}
const versionsDir = () => path.join(app.getPath('userData'), 'versions');
// Settings > Go back to an earlier version: the last 3 versions are kept by the updater
async function goBackTo(v) {
  if (updating) return;
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: [`Go back to ${v}`, 'Cancel'], defaultId: 1, cancelId: 1,
    message: `Go back to Minapp ${v}?`, detail: `You have ${app.getVersion()}, which is saved too, so you can return to it the same way. Settings, skins and the library are kept. Minapp restarts.` });
  if (r.response !== 0) return;
  updating = true;
  try {
    await stopHelper();
    await updater.restore(v, app.getVersion(), __dirname, versionsDir());
    log('went back to ' + v);
    app.relaunch(); app.exit(0);
  } catch (e) {
    updating = false;
    dialog.showMessageBox(win, { type: 'error', message: 'Could not go back', detail: String((e && e.message) || e) });
  }
}
async function installUpdate() {
  const info = updateInfo; if (!info || updating) return;
  const notes = info.notes ? '\n\n' + info.notes : '';
  const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Update now', 'Later'], defaultId: 0, cancelId: 1,
    message: `Update Minapp to version ${info.latest}?`, detail: `You have ${info.current}. Your settings, skins and library are kept. Minapp restarts when it is done.${notes}` });
  if (r.response !== 0) return;
  if (!info.asset) { shell.openExternal(info.page); return; }
  updating = true;
  await stopHelper();
  const note = (m) => { log('[update] ' + m); try { win.setTitle(m); tray && tray.setToolTip(m); } catch {} lastTitle = ''; };
  try {
    const v = await updater.install(info, __dirname, note, fetch, versionsDir());
    log('updated to ' + v);
    await dialog.showMessageBox(win, { message: `Updated to version ${v}`, detail: 'Minapp restarts now.' });
    app.relaunch(); app.exit(0);
  } catch (e) {
    updating = false; lastTitle = '';
    const r2 = await dialog.showMessageBox(win, { type: 'error', buttons: ['OK', 'Open download page'], defaultId: 0, message: 'The update did not work', detail: String((e && e.message) || e) + '\n\nMinapp keeps working as it is. You can also download the new version by hand.' });
    if (r2.response === 1) shell.openExternal(info.page);
  }
}

// After an update (or the first start of a newer version), show what changed since the version that ran last.
function whatsNew() {
  const cfg0 = readCfg(), cur = app.getVersion();
  // versions before 1.8.8 did not record which version ran last: an existing setup (it has settings) then gets the whole
  // history, so nothing is missed when coming from an old version
  const existing = Object.keys(cfg0).some((k) => k !== 'lastVersion');
  const last = cfg0.lastVersion || (existing ? '0.0.0' : null);
  if (last === cur) return;
  writeCfg({ lastVersion: cur });
  if (!last || !updater.newer(cur, last)) return; // first install: nothing to compare with
  let text = '';
  try { text = fs.readFileSync(path.join(__dirname, 'CHANGELOG.md'), 'utf8'); } catch { return; }
  const sections = [];
  for (const sec of text.split(/^## /m).slice(1, 16)) { // newest first; at most the latest 15 versions
    const v = sec.split(/\r?\n/)[0].trim();
    if (!updater.newer(v, last) || updater.newer(v, cur)) continue;
    const items = sec.split(/\r?\n/).slice(1).map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);
    sections.push({ version: v, items });
  }
  if (sections.length && win && !win.isDestroyed()) win.webContents.send('whatsnew', { version: cur, sections }); // skinned pop-up under the player
}

let downloading = false;
async function downloadCurrentYouTube() {
  const t = readCfg().yt;
  if (!t) { dialog.showMessageBox(win, { message: 'Open a YouTube link first (menu > YouTube link…)' }); return; }
  if (t.ids) { dialog.showMessageBox(win, { message: 'Downloading needs a pasted link', detail: 'Playlists opened from your account can be played but not downloaded. Paste a playlist or video link (menu > YouTube link…) to download it.' }); return; }
  if (downloading) return;
  if (!library.haveBin() || !readCfg().dlOk) {
    const r = await dialog.showMessageBox(win, {
      type: 'question', buttons: ['Download', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'Download this ' + (t.list ? 'playlist' : 'video') + ' as audio files?',
      detail: 'For your personal use only. YouTube\'s terms do not allow downloading, and most music is copyrighted: only keep what you have the right to keep.\n\nThe first time, Minapp fetches the free yt-dlp tool (about 20 MB) into its data folder, plus the free ffmpeg converter (about 25 MB) when "Save downloads as MP3" is on. Songs land in the local library and play from menu > Local playlists.',
    });
    if (r.response !== 0) return;
    writeCfg({ dlOk: true });
  }
  downloading = true; buildMenu();
  win.webContents.send('download:state', true);
  const url = t.list ? 'https://www.youtube.com/playlist?list=' + encodeURIComponent(t.list) : 'https://www.youtube.com/watch?v=' + encodeURIComponent(t.v);
  let lastLog = '';
  const note = (m, info) => {
    const phase = info ? info.phase : '';
    if (phase !== 'downloading' || m.split(':')[0] !== lastLog) { lastLog = m.split(':')[0]; log('[download] ' + m); } // not every percent
    try { tray && tray.setToolTip(m.slice(0, 120)); win.setTitle(m); } catch {} lastTitle = '';
    if (info && win && !win.isDestroyed()) win.webContents.send('download:progress', { ...info, paused: library.isPaused() });
  };
  try {
    const mp3 = cfgOn('dlMp3', true);
    let res = await library.download(url, !!t.list, note, false, mp3);
    if (!res.ok && !res.rateLimited) { note('Updating yt-dlp…'); res = await library.download(url, !!t.list, note, true, mp3); } // YouTube changes often: a newer yt-dlp usually fixes it
    const n = res.files.length, plural = (k) => `${k} song${k === 1 ? '' : 's'}`;
    const folder = n ? path.dirname(res.files[0]) : null;
    const have = folder ? library.tracks(path.basename(folder)).length : 0;
    if (res.cancelled) {
      buildMenu();
      if (n) dialog.showMessageBox(win, { message: `Stopped. ${plural(n)} saved this time.`, detail: 'Choose Download again later and it continues where it stopped.' });
    } else if (res.ok || res.rateLimited) {
      buildMenu();
      const limited = res.rateLimited;
      const of = res.total ? ` of ${res.total}` : '';
      const head = limited ? `Saved ${have}${of} songs so far` : `Saved ${plural(n)} to your local library`;
      const detail = limited
        ? 'YouTube asked Minapp to slow down, and it still said so after waiting. Nothing is lost: choose Download again in about an hour and it picks up where it stopped.'
        : (res.error ? 'Some items were skipped (for example videos that are private or removed): ' + res.error : '');
      if (n) {
        const r = await dialog.showMessageBox(win, { message: head, detail, buttons: ['Play them', 'OK'], defaultId: 1 });
        if (r.response === 0) await playLocal(path.basename(folder));
      } else {
        dialog.showMessageBox(win, { type: 'warning', message: 'YouTube is asking Minapp to slow down', detail });
      }
    } else {
      dialog.showMessageBox(win, { type: 'error', message: 'Download failed', detail: res.error || 'yt-dlp did not save anything.' });
    }
  } catch (e) {
    dialog.showMessageBox(win, { type: 'error', message: 'Download failed', detail: String((e && e.message) || e) });
  } finally {
    downloading = false; lastTitle = ''; buildMenu();
    if (win && !win.isDestroyed()) { win.webContents.send('download:state', false); win.webContents.send('download:progress', null); }
  }
}

// Songs saved before 1.9.16 have no picture: look each one up by its title and save the cover next to it
async function fillMissingCovers() {
  if (downloading) return;
  const n = library.withoutCover().length;
  if (!n) { dialog.showMessageBox(win, { message: 'Every song in your library already has its cover.' }); return; }
  const r = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Get covers', 'Cancel'], defaultId: 0, cancelId: 1,
    message: `Look up covers for ${n} song${n === 1 ? '' : 's'}?`,
    detail: 'Minapp searches YouTube for each song by its name and saves the picture of the first match next to the song. The songs themselves are not downloaded again. It takes a few seconds per song, and you can pause or stop it from the bar under the player.',
  });
  if (r.response !== 0) return;
  downloading = true; buildMenu();
  win.webContents.send('download:state', true);
  const note = (m, info) => { try { win.setTitle(m); } catch {} lastTitle = ''; if (info && win && !win.isDestroyed()) win.webContents.send('download:progress', { ...info, paused: library.isPaused() }); };
  try {
    const res = await library.fillCovers(note);
    localMeta = { path: '' }; // the playing song may have just got its cover
    const head = `Found covers for ${res.found} of ${res.total} songs`;
    const detail = res.rateLimited ? 'YouTube asked Minapp to slow down. Choose "Get missing covers" again in about an hour and it carries on with the rest.'
      : res.cancelled ? 'Stopped. Choose "Get missing covers" again to carry on with the rest.'
        : res.missed ? `No match was found for ${res.missed}.` : '';
    dialog.showMessageBox(win, { message: head, detail });
  } catch (e) {
    dialog.showMessageBox(win, { type: 'error', message: 'Could not get the covers', detail: String((e && e.message) || e) });
  } finally {
    downloading = false; lastTitle = ''; buildMenu();
    if (win && !win.isDestroyed()) { win.webContents.send('download:state', false); win.webContents.send('download:progress', null); }
  }
}

async function setSource(s) {
  try {
    try { await runCapture(null); } catch {}
    if (s !== 'ytmusic' && ytmWin) ytmWin.webContents.send('ytm:cmd', 'pause');
    if (s === 'ytmusic') {
      if (localWin) localWin.webContents.send('local:cmd', 'pause');
      if (ytWin) { ytWin.webContents.send('yt:cmd', 'pause'); ytWin.hide(); }
      source = 'ytmusic'; writeCfg({ source });
      await spotifyCmd('pause');
      await openYouTubeMusic();
      await applyAudio();
    } else if (s === 'local') {
      const pl = library.playlists();
      const name = pl.find((p) => p.name === readCfg().localPlaylist && p.count) ? readCfg().localPlaylist : (pl.find((p) => p.count) || {}).name;
      if (!name) { dialog.showMessageBox(win, { message: 'No local playlists yet', detail: 'Use menu > Local playlists > Import files… or Import folder…, or download a YouTube playlist with the record button.' }); await applyAudio(); return; }
      return playLocal(name);
    }
    else if (s === 'youtube') {
      if (localWin) localWin.webContents.send('local:cmd', 'pause');
      if (!readCfg().yt && !(await chooseYouTube())) { await applyAudio(); return; }
      source = 'youtube'; writeCfg({ source });
      await spotifyCmd('pause');
      await openYouTube(readCfg().yt);
    } else {
      source = 'spotify'; writeCfg({ source });
      if (localWin) localWin.webContents.send('local:cmd', 'pause');
      if (ytWin) { ytWin.webContents.send('yt:cmd', 'pause'); ytWin.hide(); }
      await applyAudio();
    }
  } catch (e) {
    dialog.showMessageBox({ type: 'error', message: 'Could not switch source', detail: String((e && e.message) || e) });
  }
  buildMenu();
}

ipcMain.on('yt:log', (_e, msg) => log('[youtube] ' + String(msg).slice(0, 300)));
ipcMain.on('yt:state', (_e, s) => { const pl = ytState.playlist; ytState = s || { status: 'closed' }; if (ytState.playlist === undefined && pl) ytState.playlist = pl; });
ipcMain.on('local:log', (_e, msg) => log('[local] ' + String(msg).slice(0, 300)));
ipcMain.on('local:state', (_e, s) => { localState = s || { status: 'closed' }; });

// the renderer talks to whichever source is active
ipcMain.handle('spotify:state', async () => {
  if (source === 'local') {
    const st = localWin ? { ...localState } : { status: 'closed' };
    const i = typeof st.index === 'number' ? st.index : -1;
    const row = (t, k) => ({ id: (k < i ? 'h' : '') + 'l' + k + ':' + t.path, title: t.title, artist: t.artist, duration: 0 });
    st.queue = i < 0 ? [] : localList.slice(i + 1, i + 31).map((t, k) => row(t, i + 1 + k));
    st.history = i <= 0 ? [] : localList.slice(Math.max(0, i - 30), i).map((t, k) => row(t, Math.max(0, i - 30) + k));
    st.source = 'local';
    const cur = localList[i];
    if (cur && st.status !== 'stopped') { // the cover and album saved with a downloaded song
      if (localMeta.path !== cur.path) localMeta = { path: cur.path, art: library.artFor(cur.path), d: library.detailsFor(cur.path) }; // read from disk once per song, not on every poll
      const { art, d } = localMeta;
      st.art = art ? 'local:' + art : '';
      st.album = d.album || '';
      if (d.artist) st.artist = d.artist;
    }
    onNowPlaying(st);
    return st;
  }
  if (source === 'ytmusic') {
    const st = ytmWin ? { ...ytmState } : { status: 'closed' };
    st.source = 'ytmusic';
    st.queue = []; st.history = [];
    onNowPlaying(st);
    return st;
  }
  if (source === 'youtube') {
    const st = ytWin ? { ...ytState } : { status: 'closed' };
    st.source = 'youtube';
    if (st.id && /^[\w-]{11}$/.test(st.id)) st.art = `https://i.ytimg.com/vi/${st.id}/mqdefault.jpg`; // the video's thumbnail
    st.queue = ytQueue();
    st.history = ytHistory();
    delete st.playlist;
    onNowPlaying(st);
    return st;
  }
  const st = (await spotifyState()) || { status: 'closed' };
  if (st.id && st.id !== spotLastId) {
    if (st.title) trackHistory(st); // updates the history and our view of the queue at once; the API re-confirms it shortly
    spotLastId = st.id;
    holdQueue();
  }
  if (st.title) lastSongTitle = st.title;
  st.queue = spotifyQueue.items;
  if (!st.art && spotArt && st.title && spotArt.title === norm(st.title)) st.art = spotArt.url;
  const likeId = trackIdOf(st.id) || (spotCur && st.title && spotCur.title === norm(st.title) ? spotCur.id : null);
  if (!st.album && spotCur && spotCur.album && st.title && spotCur.title === norm(st.title)) st.album = spotCur.album;
  if (likeId) { checkLiked(likeId); const lk = likedCache.get(likeId); if (lk !== undefined) st.liked = lk; }
  if (!st.art && isWin && st.title && !process.env.SKIN_FAKE) { const k = winThumb(st); if (k) st.art = k; }
  if (!st.art && st.id) { const c = spotCover(st.id); if (c) st.art = c; } // no login needed: Spotify's public oEmbed page
  st.history = history.map((x) => ({ ...x, id: 'h' + x.id }));
  // Explain an empty list instead of showing nothing: the desktop app does not expose its queue
  if (!st.queue.length && st.title && !process.env.SKIN_FAKE) {
    const cfg = readCfg();
    st.queue = [{ id: 'hint', hint: true, title: !cfg.spotRefresh ? 'Queue off: menu > Connect Spotify queue' : (spotifyQueue.err ? 'Queue unavailable (' + spotifyQueue.err + ')' : 'Queue is empty'), artist: '', duration: 0 }];
  }
  onNowPlaying(st);
  return st;
});
ipcMain.handle('spotify:cmd', (_e, cmd, arg) => doCmd(cmd, arg));

// ---------- window + skins ----------
function applySize() {
  if (!win) return;
  win.webContents.setZoomFactor(zoom);
  win.setContentSize(Math.round(lastSize.w * zoom), Math.round(lastSize.h * zoom));
}
// off = width of the album tab on the player's left: the window grows leftwards so the player itself stays where it is
let artOff = 0;
ipcMain.on('win:size', (_e, w, h, off = 0) => {
  lastSize = { w, h };
  off = Math.max(0, Math.min(200, Math.round(Number(off) || 0)));
  if (win && !win.isDestroyed() && off !== artOff) {
    const b = win.getBounds();
    win.setBounds({ x: b.x - Math.round((off - artOff) * zoom), y: b.y, width: b.width, height: b.height });
    artOff = off;
  }
  applySize();
});
ipcMain.handle('art:get', async (_e, url) => {
  url = String(url || '');
  if (url.startsWith('thumb:')) return thumbCache.get(url) || null; // Windows media-controls picture
  if (url.startsWith('local:')) { // a cover saved next to a downloaded song: only from inside the library folder
    const f = path.resolve(url.slice(6)), lib = path.resolve(library.dir) + path.sep;
    if (!f.startsWith(lib) || !/\.(jpe?g|png|webp)$/i.test(f)) return null;
    if (artCache.has(url)) return artCache.get(url);
    try {
      const ext = path.extname(f).slice(1).toLowerCase(), d = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + fs.readFileSync(f).toString('base64');
      if (artCache.size > 20) artCache.delete(artCache.keys().next().value);
      artCache.set(url, d);
      return d;
    } catch (e) { log('local cover error: ' + e.message); return null; }
  }
  if (!(SPOT_IMG.test(url) || /^https:\/\/i\.ytimg\.com\//.test(url))) return null;
  if (artCache.has(url)) return artCache.get(url);
  try {
    const r = await fetch(url);
    if (!r.ok) { log('album art: HTTP ' + r.status); return null; }
    const d = 'data:' + (r.headers.get('content-type') || 'image/jpeg') + ';base64,' + Buffer.from(await r.arrayBuffer()).toString('base64');
    if (artCache.size > 20) artCache.delete(artCache.keys().next().value);
    artCache.set(url, d);
    return d;
  } catch (e) { log('album art error: ' + ((e && e.message) || e)); return null; }
});

// Dragging uses the cursor position instead of CSS drag regions (so menus stay clickable).
// setBounds with the original size avoids the Windows high-DPI bug where setPosition makes the window grow.
// The window snaps to screen edges like classic Winamp.
let dragTimer = null;
function snapPos(x, y, w, h) {
  if (readCfg().snap === false) return [x, y];
  const d = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) }).workArea, T = 14;
  if (Math.abs(x - d.x) < T) x = d.x; else if (Math.abs(x + w - (d.x + d.width)) < T) x = d.x + d.width - w;
  if (Math.abs(y - d.y) < T) y = d.y; else if (Math.abs(y + h - (d.y + d.height)) < T) y = d.y + d.height - h;
  return [x, y];
}
function savePos() { try { if (win && !win.isDestroyed()) { const [x, y] = win.getPosition(); writeCfg({ pos: { x, y } }); } } catch {} }
ipcMain.on('win:dragstart', () => {
  if (!win || dragTimer) return;
  const c0 = screen.getCursorScreenPoint(), b0 = win.getBounds();
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) { clearInterval(dragTimer); dragTimer = null; return; }
    const c = screen.getCursorScreenPoint();
    const [x, y] = snapPos(b0.x + c.x - c0.x, b0.y + c.y - c0.y, b0.width, b0.height);
    win.setBounds({ x, y, width: b0.width, height: b0.height });
  }, 8);
});
ipcMain.on('win:dragend', () => { if (dragTimer) { clearInterval(dragTimer); dragTimer = null; savePos(); } });
let albumUi = { look: 'case', spin: false, open: false }; // what the album panel shows, for the menu's ticks
let infoUi = { open: false, kind: 'lyrics' };
ipcMain.on('info:state', (_e, st) => { if (st && typeof st === 'object') { infoUi = { open: !!st.open, kind: st.kind === 'artist' ? 'artist' : 'lyrics' }; buildMenu(); } });
ipcMain.handle('info:get', (_e, kind, song) => songInfo(kind === 'artist' ? 'artist' : 'lyrics', song && typeof song === 'object' ? song : {}));
ipcMain.on('album:state', (_e, st) => { if (st && typeof st === 'object') { albumUi = { look: String(st.look || 'case'), spin: !!st.spin, open: !!st.open }; buildMenu(); } });
ipcMain.on('app:quit', () => app.quit());
ipcMain.handle('app:version', () => app.getVersion());
// the bulb in the player's corner
ipcMain.handle('update:get', () => (updateInfo ? updateInfo.latest : null));
ipcMain.on('update:install', () => { installUpdate(); });
ipcMain.on('app:log', (_e, msg) => log('[ui] ' + String(msg).slice(0, 600)));

// Skins are copied into data/skins so the library travels with the folder and survives the original being moved.
const skinsDir = () => path.join(app.getPath('userData'), 'skins');
const readSkin = (p) => { try { return fs.readFileSync(p); } catch { return null; } };
function listSkins() {
  try { return fs.readdirSync(skinsDir()).filter((f) => /\.(wsz|zip)$/i.test(f)).sort((a, b) => a.localeCompare(b)); } catch { return []; }
}
function storeSkin(name, buf) {
  try {
    fs.mkdirSync(skinsDir(), { recursive: true });
    let base = path.basename(String(name || 'skin.wsz')).replace(/[^\w.\- ()]/g, '_');
    if (!/\.(wsz|zip)$/i.test(base)) base += '.wsz';
    const p = path.join(skinsDir(), base);
    fs.writeFileSync(p, buf);
    writeCfg({ skin: p });
    buildMenu();
    return p;
  } catch (e) { log('could not store skin: ' + e.message); return null; }
}
function useSkinFile(p) {
  const buf = readSkin(p);
  if (!buf) return;
  writeCfg({ skin: p });
  win.webContents.send('skin:load', buf);
}
ipcMain.handle('skin:last', () => { const p = readCfg().skin; return p ? readSkin(p) : null; });
ipcMain.handle('skin:save', (_e, name, data) => storeSkin(name, Buffer.from(data)));
ipcMain.handle('prefs:get', () => readCfg().ui || {});
ipcMain.on('prefs:save', (_e, ui) => writeCfg({ ui }));

async function pickSkin() {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a Winamp skin', filters: [{ name: 'Winamp skins', extensions: ['wsz', 'zip'] }], properties: ['openFile', 'multiSelections'] });
  if (r.canceled || !r.filePaths.length) return;
  let last = null;
  for (const f of r.filePaths) { const b = readSkin(f); if (b) last = storeSkin(path.basename(f), b); }
  if (last) useSkinFile(last);
}

// ---------- skin library ----------
// The library is simply the data/skins folder: skins you load, drag onto the player or copy there by hand all show up.
const SKIN_WEB = 'https://skins.webamp.org/';
const openSkinSite = () => shell.openExternal(SKIN_WEB);
ipcMain.on('skins:open', () => { log('logo clicked: opening ' + SKIN_WEB); openSkinSite(); });   // the corner logo
let skinWatch = null, skinWatchTimer = null;
function watchSkinLibrary() {
  try {
    fs.mkdirSync(skinsDir(), { recursive: true });
    if (skinWatch) skinWatch.close();
    skinWatch = fs.watch(skinsDir(), { persistent: false }, () => {
      clearTimeout(skinWatchTimer);
      skinWatchTimer = setTimeout(buildMenu, 300);   // wait until a copy has finished
    });
    skinWatch.on('error', () => { skinWatch = null; });
  } catch (e) { log('could not watch the skins folder: ' + e.message); }
}

function skinsMenu() {
  const cur = readCfg().skin;
  const skins = listSkins();
  return [
    { label: 'Load skin from file…', accelerator: 'CmdOrCtrl+O', click: pickSkin },
    { label: 'Get more skins (skins.webamp.org)…', click: openSkinSite },
    { label: 'Random skin', enabled: skins.length > 1, click: () => { const o = skins.filter((f) => path.join(skinsDir(), f) !== cur); useSkinFile(path.join(skinsDir(), o[Math.floor(Math.random() * o.length)])); } },
    { label: 'Minapp (default skin)', type: 'radio', checked: !cur, click: () => { writeCfg({ skin: null }); win.webContents.reload(); } },
    { type: 'separator' },
    ...(skins.length
      ? (() => {
          const items = skins.map((f) => ({ label: f.replace(/\.(wsz|zip)$/i, ''), type: 'radio', checked: path.join(skinsDir(), f) === cur, click: () => useSkinFile(path.join(skinsDir(), f)) }));
          if (items.length <= 20) return items;
          const groups = [];   // long libraries become a few short submenus, labelled by first letters
          for (let i = 0; i < items.length; i += 20) {
            const part = items.slice(i, i + 20);
            groups.push({ label: `${part[0].label.slice(0, 12)} … ${part[part.length - 1].label.slice(0, 12)}`, submenu: part });
          }
          return groups;
        })()
      : [{ label: 'Skins you load appear here', enabled: false }]),
    { type: 'separator' },
    { label: 'Open skins folder', click: () => { fs.mkdirSync(skinsDir(), { recursive: true }); shell.openPath(skinsDir()); } },
  ];
}

// ---------- hotkeys ----------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (readCfg().hotkeys === false) return;
  const keys = {
    'Control+Alt+Right': () => doCmd('next'),
    'Control+Alt+Left': () => doCmd('previous'),
    'Control+Alt+Down': () => doCmd('playpause'),
    'Control+Alt+Up': () => toggleVisible(),
    'Control+Alt+PageUp': () => { if (source === 'youtube') setYtHidden(!readCfg().ytHidden); },
  };
  for (const [k, fn] of Object.entries(keys)) {
    try { if (!globalShortcut.register(k, fn)) log('hotkey taken by another app: ' + k); } catch (e) { log('hotkey failed: ' + k); }
  }
}
function toggleVisible() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) win.hide(); else { win.show(); win.focus(); }
}

// ---------- sleep timer ----------
// pauses the music after a while, or when the playing song ends (the renderer tells us when the next one starts)
let sleepAt = 0, sleepSong = false, sleepTimer = null, sleepMin = 0, sleepTick = null;
const sleepSend = () => { if (win && !win.isDestroyed()) win.webContents.send('sleep:state', { at: sleepAt, song: sleepSong }); };
function sleepFire() {
  log('sleep timer: pausing');
  setSleep(0);
  doCmd('pause').catch((e) => log('sleep pause failed: ' + e.message));
}
function setSleep(min) {
  clearTimeout(sleepTimer); clearInterval(sleepTick); sleepTimer = sleepTick = null; sleepAt = 0; sleepSong = false; sleepMin = 0;
  if (min === 'song') sleepSong = true;
  else if (min > 0) { sleepMin = min; sleepAt = Date.now() + min * 60000; sleepTimer = setTimeout(sleepFire, min * 60000); sleepTick = setInterval(buildMenu, 60000); } // the menu shows the minutes left
  sleepSend(); buildMenu();
}
ipcMain.handle('sleep:get', () => ({ at: sleepAt, song: sleepSong }));
ipcMain.on('sleep:now', () => { if (sleepSong) sleepFire(); });
function sleepMenu() {
  const left = sleepAt ? Math.max(1, Math.round((sleepAt - Date.now()) / 60000)) : 0;
  return { label: sleepAt ? `Sleep timer (${left} min left)` : sleepSong ? 'Sleep timer (after this song)' : 'Sleep timer', submenu: [
    { label: 'Off', type: 'radio', checked: !sleepAt && !sleepSong, click: () => setSleep(0) },
    ...[15, 30, 45, 60, 90].map((m) => ({ label: `Pause in ${m} minutes`, type: 'radio', checked: !!sleepAt && sleepMin === m, click: () => setSleep(m) })),
    { label: 'Pause after this song', type: 'radio', checked: sleepSong, click: () => setSleep('song') },
  ] };
}

// ---------- menus ----------
const toggleCfg = (key, dflt) => () => { writeCfg({ [key]: !(readCfg()[key] === undefined ? dflt : readCfg()[key]) }); buildMenu(); };
const cfgOn = (key, dflt) => (readCfg()[key] === undefined ? dflt : !!readCfg()[key]);

// One list drives the skin's pop-up menu (O button / right-click), the tray icon and the Player menu.
function menuItems() {
  const send = (id) => () => win.webContents.send('window:toggle', id);
  const eqLabel = eqOn
    ? (isPlayerSrc() || eqPref === 'capture' ? 'Equalizer sound (on)' : 'Equalizer sound (on, via Equalizer APO)')
    : 'Equalizer sound';
  return [
    updateInfo ? { label: `Update available: ${updateInfo.latest}…`, click: installUpdate } : { label: 'Check for updates…', click: () => checkForUpdate(true) },
    { type: 'separator' },
    { label: 'Source', enabled: false },
    { label: 'Spotify', type: 'radio', checked: source === 'spotify', click: () => setSource('spotify') },
    { label: 'YouTube', type: 'radio', checked: source === 'youtube', click: () => setSource('youtube'), accelerator: 'CmdOrCtrl+Shift+S' },
    { label: 'Show YouTube video', type: 'checkbox', checked: !cfgOn('ytHidden', false), click: () => setYtHidden(!readCfg().ytHidden) },
    { label: 'YouTube link…', accelerator: 'CmdOrCtrl+Shift+Y', click: async () => { if (await chooseYouTube()) await setSource('youtube'); } },
    { label: 'YouTube Music (experiment)', type: 'radio', checked: source === 'ytmusic', click: () => setSource('ytmusic') },
    { label: 'YouTube account', submenu: accountMenu() },
    { label: 'Local playlists', type: 'radio', checked: source === 'local', click: () => setSource('local') },
    { label: 'Local library', submenu: [
      ...(library.playlists().length
        ? library.playlists().map((p) => ({ label: `${p.name} (${p.count})`, enabled: p.count > 0, type: 'radio', checked: source === 'local' && localName === p.name, click: () => playLocal(p.name) }))
        : [{ label: 'No playlists yet', enabled: false }]),
      { type: 'separator' },
      { label: 'Import files…', click: () => importIntoPlaylist(false) },
      { label: 'Import folder…', click: () => importIntoPlaylist(true) },
      ...(downloading ? [{ label: library.isPaused() ? 'Resume download' : 'Pause download', click: () => { library.pause(!library.isPaused()); buildMenu(); } },
        { label: 'Stop download', click: () => library.cancel() }]
        : source === 'youtube' ? [{ label: 'Download current YouTube link (personal use)…', click: downloadCurrentYouTube }] : []),
      ...(!downloading ? [{ label: 'Get missing covers…', click: fillMissingCovers }] : []),
      { label: 'Save downloads as MP3 320 (works in every DJ app)', type: 'checkbox', checked: cfgOn('dlMp3', true), click: toggleCfg('dlMp3', true) },
      { label: 'Open library folder', click: () => { fs.mkdirSync(library.dir, { recursive: true }); shell.openPath(library.dir); } },
    ] },
    { label: 'Open Spotify', click: () => shell.openExternal('spotify:') },
    { type: 'separator' },
    { label: 'Playlist (queue)', click: send('playlist') },
    { label: 'Equalizer window', click: send('equalizer') },
    { label: 'Milkdrop', accelerator: 'CmdOrCtrl+Shift+K', click: () => win.webContents.send('milkdrop:toggle') },
    { label: 'Album picture', submenu: [
      ...[['case', 'Cassette box'], ['tape', 'Cassette'], ['cd', 'CD']].map(([k, label]) => ({ label, type: 'radio', checked: albumUi.look === k, click: () => win.webContents.send('album:options', { look: k }) })),
      { type: 'separator' },
      { label: 'Spin the CD (slowly, while playing)', type: 'checkbox', checked: !!albumUi.spin, click: () => win.webContents.send('album:options', { look: 'cd', spin: !albumUi.spin }) },
    ] },
    { label: 'Lyrics / about the artist', type: 'checkbox', checked: infoUi.open, accelerator: 'CmdOrCtrl+Shift+L', click: () => win.webContents.send('info:options', { open: !infoUi.open }) },
    sleepMenu(),
    { label: 'Mini mode', accelerator: 'CmdOrCtrl+Shift+M', click: () => win.webContents.send('mini:toggle') },
    { label: 'Widget', submenu: [
      { label: 'Off (full player)', type: 'radio', checked: widget === 'off', click: () => setWidget('off', true) },
      { label: 'Small: timer + visualizer', type: 'radio', checked: widget === 'small', accelerator: 'CmdOrCtrl+Shift+W', click: () => setWidget('small', true) },
      { label: 'Large: timer + playlist', type: 'radio', checked: widget === 'large', accelerator: 'CmdOrCtrl+Alt+W', click: () => setWidget('large', true) },
      { type: 'separator' },
      { label: 'Stay on top of other windows', type: 'checkbox', checked: readCfg().widgetTop !== false, click: () => { writeCfg({ widgetTop: readCfg().widgetTop === false }); applyOnTop(); buildMenu(); } },
    ] },
    { type: 'separator' },
    { label: 'Skins', submenu: skinsMenu() },
    { label: 'Pin on top', type: 'checkbox', checked: pinned, click: () => setPinned(!pinned) },
    { label: 'Size', submenu: [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((z) => ({ label: `${z}x`, type: 'radio', checked: z === zoom, click: () => { zoom = z; writeCfg({ zoom, zoomSet: 2 }); applySize(); } })) },
    { type: 'separator' },
    { label: eqLabel, type: 'checkbox', checked: eqOn, click: toggleEq },
    ...(isWin || isMac ? [{ label: 'Visualizer follows the music', type: 'checkbox', checked: vizOn, click: async () => { vizOn = !vizOn; vizFailed = false; writeCfg({ viz: vizOn }); await applyAudio(); } }] : []),
    { label: readCfg().spotRefresh ? 'Disconnect Spotify queue' : 'Connect Spotify queue…', click: () => (readCfg().spotRefresh ? disconnectSpotifyQueue() : connectSpotifyQueue()) },
    { type: 'separator' },
    { label: 'Settings', submenu: [
      { label: 'Global hotkeys (Ctrl+Alt+←/→/↓/↑, PgUp)', type: 'checkbox', checked: cfgOn('hotkeys', true), click: () => { toggleCfg('hotkeys', true)(); registerHotkeys(); } },
      { label: 'Snap to screen edges', type: 'checkbox', checked: cfgOn('snap', true), click: toggleCfg('snap', true) },
      { label: 'Song-change notifications', type: 'checkbox', checked: cfgOn('toasts', false), click: toggleCfg('toasts', false) },
      ...(isWin ? [{ label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings({ path: process.execPath }).openAtLogin,
        click: (mi) => { try { app.setLoginItemSettings({ openAtLogin: mi.checked, path: process.execPath, args: [app.getAppPath()] }); } catch (e) { log('login item failed: ' + e.message); } buildMenu(); } }] : []),
      { type: 'separator' },
      { label: 'Go back to an earlier version', submenu: (() => {
        const vs = updater.savedVersions(versionsDir()).filter((v) => v !== app.getVersion());
        return vs.length ? vs.map((v) => ({ label: `Minapp ${v}`, click: () => goBackTo(v) })) : [{ label: 'None saved yet (kept from the next update on)', enabled: false }];
      })() },
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
      ...(inMacBundle ? [{ label: 'Uninstall Minapp…', click: () => { const u = path.join(app.getPath('userData'), 'Uninstall Minapp.command'); if (fs.existsSync(u)) shell.openPath(u); } }] : []),
    ] },
    ...(isWin ? [{ label: 'Check Spotify connection…', click: checkSpotify }] : []),
    { type: 'separator' },
    { label: isMac ? 'Hide window' : 'Hide to tray', accelerator: 'Control+Alt+Up', registerAccelerator: false, click: () => win.hide() },
    { label: 'Quit', click: () => app.quit() },
  ];
}
// the progress bar's own pause / resume / stop buttons
ipcMain.on('download:ctl', (_e, a) => {
  if (!downloading) return;
  if (a === 'cancel') library.cancel(); else library.pause(a === 'pause');
  buildMenu();
});
ipcMain.on('menu:show', () => {
  if (win) Menu.buildFromTemplate(menuItems()).popup({ window: win });
});

function buildMenu() {
  if (!win || win.isDestroyed()) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Minapp', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Player', submenu: menuItems() },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'paste' }] },
  ]));
  // Windows: the frameless player has no menu bar, so the same menu lives in the tray icon
  if (isWin) {
    try {
      if (!tray) {
        tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 16, height: 16 }));
        tray.setToolTip('Minapp');
        tray.on('click', toggleVisible);
      }
      tray.setContextMenu(Menu.buildFromTemplate(menuItems()));
    } catch (e) { log('tray failed: ' + e.message); }
  }
}

// Keep a remembered position only if it is still on a connected screen.
function restorePos(pos) {
  if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
  const ok = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return pos.x > a.x - 100 && pos.x < a.x + a.width - 60 && pos.y >= a.y - 4 && pos.y < a.y + a.height - 40;
  });
  if (ok) win.setPosition(Math.round(pos.x), Math.round(pos.y));
}

app.on('activate', () => { if (win && !win.isVisible()) { win.show(); win.focus(); } });
app.on('second-instance', () => { if (win) { if (!win.isVisible()) win.show(); if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  // start the Spotify helper right now, in parallel with the window loading, instead of on the first poll
  if (isWin && !process.env.SKIN_FAKE) { try { psStart(); } catch (e) { log('helper pre-start failed: ' + e.message); } }
  const cfg = readCfg();
  zoom = cfg.zoomSet === 2 && cfg.zoom ? cfg.zoom : 1; // older versions saved a bigger default
  vizOn = cfg.viz !== false;
  eqPref = cfg.eqPref === 'capture' ? 'capture' : 'apo';
  win = new BrowserWindow({
    width: Math.round(275 * zoom), height: Math.round(116 * zoom), useContentSize: true,
    frame: false, transparent: true, hasShadow: false, resizable: false, backgroundColor: '#00000000', title: 'Minapp',
    icon: path.join(__dirname, isWin ? 'icon.ico' : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  restorePos(cfg.pos);
  // dropping a file on the window must never navigate away from the player
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('render-process-gone', (_e, d) => { log('renderer gone: ' + d.reason); if (d.reason !== 'clean-exit') win.webContents.reload(); });
  installCaptureHandler();
  setInterval(capWatchdog, 8000);
  if (isMac && app.dock) { try { app.dock.setIcon(nativeImage.createFromPath(path.join(__dirname, 'icon.png'))); } catch {} }
  setInterval(() => { if (source === 'spotify') refreshSpotifyQueue(); }, 15000); // plus an immediate refresh whenever the song changes or a skip happens
  pinned = !!cfg.onTop;
  widget = cfg.widget === 'small' || cfg.widget === 'large' ? cfg.widget : 'off';
  applyOnTop();
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    applySize();
    setTimeout(applyAudio, 1200); // start the visualizer / restore the equalizer once the page is up
  });
  win.on('closed', () => app.quit());
  win.on('hide', savePos);
  app.on('before-quit', savePos);
  // Equalizer comes back on its own only where it is safe: YouTube capture, or the Equalizer APO route.
  // The experimental mute-and-replay capture is always opt-in.
  if (cfg.eq && ((cfg.source === 'youtube' && cfg.yt) || (cfg.eqPref !== 'capture' && apoDir() && apoEnsureInclude().ok))) eqOn = true;
  buildMenu();
  if (ytApi.signedIn()) ytApi.refreshPlaylists();
  registerHotkeys();
  win.webContents.once('did-finish-load', () => setTimeout(whatsNew, 1500));
  // quiet checks for a new release: shortly after start, then every 30 minutes, and when the player is brought to the front
  // (at most every 5 minutes). The light bulb and the menu then show "Update available". Repeat checks are tiny (ETag).
  let lastQuiet = 0;
  const quietCheck = () => { if (Date.now() - lastQuiet < 3e5) return; lastQuiet = Date.now(); checkForUpdate(false); };
  setTimeout(quietCheck, 15000);
  setInterval(quietCheck, 18e5).unref();
  win.on('focus', quietCheck);
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // start on YouTube again only if the last session ended there and a link is saved
  if (cfg.source === 'youtube' && cfg.yt) setSource('youtube');
  else if (cfg.source === 'ytmusic') setSource('ytmusic');
  else if (cfg.source === 'local') setSource('local');
  else if (eqOn) setTimeout(() => { writeApo(true); }, 1500);
  watchSkinLibrary();
  ipcMain.on('viz:bars', (_e, b) => widgetBridge.setBars(b));
  widgetBridge.init({
    doCmd, log,
    // a picture of the player's main window (top-left 275x116 of the page, scaled by the Size setting) for the widget
    capture: async () => {
      if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return null;
      const img = await win.webContents.capturePage({ x: 0, y: 0, width: Math.round(275 * zoom), height: Math.round(116 * zoom) }, { stayHidden: true });
      return img.isEmpty() ? null : img.toPNG();
    },
  }); // macOS desktop widget (mac/widget); a no-op elsewhere
});
app.on('window-all-closed', () => app.quit());
