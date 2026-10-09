const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, screen, clipboard, session, desktopCapturer, shell, globalShortcut, Notification } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const path = require('path');

const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
// Portable: keep settings next to the app (a "data" folder) instead of in %APPDATA% / Library.
try {
  const dataDir = path.join(path.dirname(__dirname), 'data');
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
let win, ytWin = null, zoom = 1, lastSize = { w: 275, h: 116 };
let source = 'spotify';
let ytState = { status: 'closed' };
let ytServer = null, ytPort = 0;

const cfgPath = () => path.join(app.getPath('userData'), 'config.json');
const readCfg = () => { try { return JSON.parse(fs.readFileSync(cfgPath(), 'utf8')); } catch { return {}; } };
const writeCfg = (p) => { try { fs.writeFileSync(cfgPath(), JSON.stringify({ ...readCfg(), ...p })); } catch (e) { log('could not save settings: ' + e.message); } };

// ---------- logging ----------
const bridgeLogPath = () => path.join(app.getPath('userData'), 'bridge.log');
function log(msg) {
  try {
    const p = bridgeLogPath();
    try { if (fs.statSync(p).size > 400 * 1024) fs.renameSync(p, p + '.old'); } catch {}
    fs.appendFileSync(p, `${new Date().toISOString()} [app] ${msg}\n`);
  } catch {}
}
const bridgeLog = log;
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
    return s & "|||" & (name of t) & "|||" & (artist of t) & "|||" & (duration of t) & "|||" & player position & "|||" & sound volume & "|||" & (id of t) & "|||" & shuffling & "|||" & repeating
  end tell
else
  return "closed"
end if`;

async function macState() {
  const out = await osa(STATE_SCRIPT);
  if (!out || out === 'closed' || out === 'stopped') return { status: out || 'closed' };
  const [status, title, artist, dur, pos, vol, id, shuf, rep] = out.split('|||');
  const num = (x) => parseFloat(String(x).replace(',', '.')) || 0;
  const st = { status, title, artist, id, duration: num(dur) / 1000, position: num(pos), volume: num(vol) };
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
let psProc = null, psReady = null, psInfo = null, psSeq = 0, psBuf = '', lastRaw = '';
let psFails = 0, psFailUntil = 0, psTimeouts = 0;
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
  if (!psProc) {
    if (Date.now() < psFailUntil) return '';
    psStart();
  }
  const ok = await Promise.race([psReady, new Promise((r) => setTimeout(() => r(false), 40000))]);
  if (!ok || !psProc) return '';
  const id = String(++psSeq);
  const proc = psProc;
  return new Promise((res) => {
    const t = setTimeout(() => {
      psPending.delete(id); res('');
      // a helper that stops answering is restarted rather than left hanging forever
      if (++psTimeouts >= 3) { psTimeouts = 0; log('helper unresponsive, restarting'); try { proc.kill(); } catch {} }
    }, timeoutMs);
    psPending.set(id, (r) => { clearTimeout(t); psTimeouts = 0; res(r); });
    try { proc.stdin.write(`${id} ${line}\n`); } catch { clearTimeout(t); psPending.delete(id); res(''); }
  });
}
app.on('before-quit', () => { try { psProc && psProc.kill(); } catch {} });

async function winState() {
  const raw = await psCall('state');
  lastRaw = raw;
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
  if (source === 'youtube') { if (ytWin) ytWin.webContents.send('yt:cmd', cmd, arg); return; }
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
function setPinned(v) {
  pinned = !!v;
  if (win) {
    if (pinned) win.setAlwaysOnTop(true, 'screen-saver'); else win.setAlwaysOnTop(false);
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
let eqOn = false, eqPref = 'apo', eqWarned = false, eqState = null;
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
const apoActive = () => eqOn && source !== 'youtube' && eqPref === 'apo';

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
  if (eqSeen && !wasOn && s.on !== false && !eqOn && (source === 'youtube' || (isWin && eqPref === 'apo' && apoDir() && apoEnsureInclude().ok))) { eqOn = true; applyAudio(); }
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
      if (m && m.src === 'youtube' && ytWin) {
        const frame = ytWin.webContents.mainFrame;
        callback({ video: frame, audio: frame, enableLocalEcho: m.kind === 'viz' });
      } else if (m && m.src === 'system' && isWin) {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        callback({ video: sources[0], audio: m.kind === 'eq' ? 'loopbackWithMute' : 'loopback' });
      } else {
        callback({});
      }
    } catch (e) { log('capture handler failed: ' + e.message); callback({}); }
  });
}

async function runCapture(mode) {
  capMode = mode;
  // executeJavaScript(..., true) counts as a user gesture, which getDisplayMedia needs
  return win.webContents.executeJavaScript(`window.__audioApply ? window.__audioApply(${JSON.stringify(mode)}) : 'not ready'`, true);
}

function desiredMode() {
  const src = source === 'youtube' ? 'youtube' : 'system';
  let mode = null;
  if (eqOn && (src === 'youtube' || eqPref === 'capture')) mode = { kind: 'eq', src };
  else if (vizOn && !vizFailed) mode = { kind: 'viz', src };
  if (mode && mode.src === 'youtube' && !ytWin) mode = null;
  if (mode && mode.src === 'system' && !isWin) mode = null;
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
    log('audio capture failed (' + (mode && mode.kind) + '): ' + why);
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
  if (source === 'youtube') { eqOn = true; return applyAudio(); }
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
  if (r.response === 1) { eqPref = 'capture'; eqOn = true; eqWarned = true; return applyAudio(); }
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
let lastNowId = null;
function onNowPlaying(st) {
  const playing = st.status === 'playing';
  const label = st.title ? `${st.artist ? st.artist + ' - ' : ''}${st.title}` : '';
  try {
    if (win && !win.isDestroyed()) win.setTitle(label || 'Minapp');
    if (tray) tray.setToolTip((label ? label + '\n' : '') + 'Minapp');
  } catch {}
  updateThumbar(playing);
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
let spotAccess = null, spotExpires = 0, spotBackoffUntil = 0, spotQueueBusy = false, spotLastId = null;
let spotifyQueue = { items: [], err: '' };
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
        scope: 'user-read-playback-state user-read-currently-playing',
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
    message: 'Spotify queue connected',
    detail: spotifyQueue.err ? `Connected, but Spotify answered: ${spotifyQueue.err}` : 'Open the playlist (PL) window to see what is coming up.',
  });
}
function disconnectSpotifyQueue() {
  writeCfg({ spotRefresh: null, spotClientId: null });
  spotAccess = null; spotifyQueue = { items: [], err: '' };
  buildMenu();
}

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

async function setSource(s) {
  try {
    try { await runCapture(null); } catch {}
    if (s === 'youtube') {
      if (!readCfg().yt && !(await chooseYouTube())) { await applyAudio(); return; }
      source = 'youtube'; writeCfg({ source });
      await spotifyCmd('pause');
      await openYouTube(readCfg().yt);
    } else {
      source = 'spotify'; writeCfg({ source });
      if (ytWin) { ytWin.webContents.send('yt:cmd', 'pause'); ytWin.hide(); }
      await applyAudio();
    }
  } catch (e) {
    dialog.showMessageBox({ type: 'error', message: 'Could not switch source', detail: String((e && e.message) || e) });
  }
  buildMenu();
}

ipcMain.on('yt:state', (_e, s) => { ytState = s || { status: 'closed' }; });

// the renderer talks to whichever source is active
ipcMain.handle('spotify:state', async () => {
  if (source === 'youtube') {
    const st = ytWin ? { ...ytState } : { status: 'closed' };
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
ipcMain.on('win:size', (_e, w, h) => { lastSize = { w, h }; applySize(); });

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
ipcMain.on('app:quit', () => app.quit());
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

function skinsMenu() {
  const cur = readCfg().skin;
  const skins = listSkins();
  return [
    { label: 'Load skin…', accelerator: 'CmdOrCtrl+O', click: pickSkin },
    { label: 'Random skin', enabled: skins.length > 1, click: () => { const o = skins.filter((f) => path.join(skinsDir(), f) !== cur); useSkinFile(path.join(skinsDir(), o[Math.floor(Math.random() * o.length)])); } },
    { label: 'Default skin', click: () => { writeCfg({ skin: null }); win.webContents.reload(); } },
    { type: 'separator' },
    ...(skins.length
      ? skins.slice(0, 40).map((f) => ({ label: f.replace(/\.(wsz|zip)$/i, ''), type: 'radio', checked: path.join(skinsDir(), f) === cur, click: () => useSkinFile(path.join(skinsDir(), f)) }))
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
    'Control+Alt+W': () => toggleVisible(),
    'Control+Alt+V': () => { if (source === 'youtube') setYtHidden(!readCfg().ytHidden); },
  };
  for (const [k, fn] of Object.entries(keys)) {
    try { if (!globalShortcut.register(k, fn)) log('hotkey taken by another app: ' + k); } catch (e) { log('hotkey failed: ' + k); }
  }
}
function toggleVisible() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) win.hide(); else { win.show(); win.focus(); }
}

// ---------- menus ----------
const toggleCfg = (key, dflt) => () => { writeCfg({ [key]: !(readCfg()[key] === undefined ? dflt : readCfg()[key]) }); buildMenu(); };
const cfgOn = (key, dflt) => (readCfg()[key] === undefined ? dflt : !!readCfg()[key]);

// One list drives the skin's pop-up menu (O button / right-click), the tray icon and the Player menu.
function menuItems() {
  const send = (id) => () => win.webContents.send('window:toggle', id);
  const eqLabel = eqOn
    ? (source === 'youtube' || eqPref === 'capture' ? 'Equalizer sound (on)' : 'Equalizer sound (on, via Equalizer APO)')
    : 'Equalizer sound';
  return [
    { label: 'Source', enabled: false },
    { label: 'Spotify', type: 'radio', checked: source === 'spotify', click: () => setSource('spotify') },
    { label: 'YouTube', type: 'radio', checked: source === 'youtube', click: () => setSource('youtube'), accelerator: 'CmdOrCtrl+Shift+S' },
    { label: 'Show YouTube video', type: 'checkbox', checked: !cfgOn('ytHidden', false), click: () => setYtHidden(!readCfg().ytHidden) },
    { label: 'YouTube link…', accelerator: 'CmdOrCtrl+Shift+Y', click: async () => { if (await chooseYouTube()) await setSource('youtube'); } },
    { label: 'Open Spotify', click: () => shell.openExternal('spotify:') },
    { type: 'separator' },
    { label: 'Playlist (queue)', click: send('playlist') },
    { label: 'Equalizer window', click: send('equalizer') },
    { label: 'Milkdrop', accelerator: 'CmdOrCtrl+Shift+K', click: () => win.webContents.send('milkdrop:toggle') },
    { label: 'Mini mode', accelerator: 'CmdOrCtrl+Shift+M', click: () => win.webContents.send('mini:toggle') },
    { type: 'separator' },
    { label: 'Skins', submenu: skinsMenu() },
    { label: 'Pin on top', type: 'checkbox', checked: pinned, click: () => setPinned(!pinned) },
    { label: 'Size', submenu: [1, 1.5, 2, 3].map((z) => ({ label: `${z}x`, type: 'radio', checked: z === zoom, click: () => { zoom = z; writeCfg({ zoom, zoomSet: 2 }); applySize(); } })) },
    { type: 'separator' },
    { label: eqLabel, type: 'checkbox', checked: eqOn, click: toggleEq },
    ...(isWin ? [{ label: 'Visualizer follows the music', type: 'checkbox', checked: vizOn, click: async () => { vizOn = !vizOn; vizFailed = false; writeCfg({ viz: vizOn }); await applyAudio(); } }] : []),
    { label: readCfg().spotRefresh ? 'Disconnect Spotify queue' : 'Connect Spotify queue…', click: () => (readCfg().spotRefresh ? disconnectSpotifyQueue() : connectSpotifyQueue()) },
    { type: 'separator' },
    { label: 'Settings', submenu: [
      { label: 'Global hotkeys (Ctrl+Alt+←/→/↓, W, V)', type: 'checkbox', checked: cfgOn('hotkeys', true), click: () => { toggleCfg('hotkeys', true)(); registerHotkeys(); } },
      { label: 'Snap to screen edges', type: 'checkbox', checked: cfgOn('snap', true), click: toggleCfg('snap', true) },
      { label: 'Song-change notifications', type: 'checkbox', checked: cfgOn('toasts', false), click: toggleCfg('toasts', false) },
      ...(isWin ? [{ label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings({ path: process.execPath }).openAtLogin,
        click: (mi) => { try { app.setLoginItemSettings({ openAtLogin: mi.checked, path: process.execPath, args: [app.getAppPath()] }); } catch (e) { log('login item failed: ' + e.message); } buildMenu(); } }] : []),
      { type: 'separator' },
      { label: 'Open data folder', click: () => shell.openPath(app.getPath('userData')) },
    ] },
    ...(isWin ? [{ label: 'Check Spotify connection…', click: checkSpotify }] : []),
    { type: 'separator' },
    { label: 'Hide to tray', accelerator: 'Control+Alt+W', registerAccelerator: false, click: () => win.hide() },
    { label: 'Quit', click: () => app.quit() },
  ];
}
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
  if (pinned) win.setAlwaysOnTop(true, 'screen-saver');
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
  registerHotkeys();
  app.on('will-quit', () => globalShortcut.unregisterAll());
  // start on YouTube again only if the last session ended there and a link is saved
  if (cfg.source === 'youtube' && cfg.yt) setSource('youtube');
  else if (eqOn) setTimeout(() => { writeApo(true); }, 1500);
});
app.on('window-all-closed', () => app.quit());
