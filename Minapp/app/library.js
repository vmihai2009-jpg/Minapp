// Local library: playlists are folders of audio files under <data>/library, plus the optional yt-dlp download
// (personal use only: the helper is fetched on first use, after the user confirms).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const AUDIO = /\.(mp3|m4a|aac|opus|ogg|oga|webm|wav|flac)$/i;
const safeName = (n) => String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80) || 'Playlist';

// yt-dlp.exe is a self-unpacking program that runs the real downloader as a second process: killing only the first
// left the download running (Pause and Stop did nothing). Take down the whole tree.
function killTree(p) {
  if (!p || p.exitCode !== null) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }); } catch { try { p.kill(); } catch {} }
  } else {
    try { process.kill(-p.pid, 'SIGTERM'); } catch { try { p.kill(); } catch {} }
  }
}

function create({ dir, binDir, log }) {
  const playlists = () => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, count: tracks(d.name).length })).sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  };
  const tracks = (name) => {
    const p = path.join(dir, safeName(name));
    try {
      return fs.readdirSync(p).filter((f) => AUDIO.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => ({ path: path.join(p, f), title: f.replace(AUDIO, '').replace(/^\d{1,3} - /, ''), artist: name }));
    } catch { return []; }
  };
  // copy files into a playlist folder; returns how many were added
  const importFiles = (name, files) => {
    const p = path.join(dir, safeName(name));
    fs.mkdirSync(p, { recursive: true });
    let n = 0;
    for (const f of files) {
      if (!AUDIO.test(f)) continue;
      const to = path.join(p, path.basename(f));
      if (fs.existsSync(to)) continue;
      try { fs.copyFileSync(f, to); n++; } catch (e) { log('import failed: ' + e.message); }
    }
    return n;
  };
  const audioIn = (folder) => {
    try { return fs.readdirSync(folder).filter((f) => AUDIO.test(f)).map((f) => path.join(folder, f)); } catch { return []; }
  };

  // ----- covers and details of downloaded songs -----
  const base = (f) => f.replace(AUDIO, '');
  const IMG = ['.jpg', '.jpeg', '.png', '.webp'];
  // yt-dlp's details file is large (every format it saw): keep the few fields Minapp shows in a small file, drop the rest
  function keepDetails(file) {
    const info = base(file) + '.info.json';
    try {
      const j = JSON.parse(fs.readFileSync(info, 'utf8'));
      fs.writeFileSync(base(file) + '.minapp.json', JSON.stringify({ album: j.album || '', artist: j.artist || j.creator || j.uploader || '', title: j.track || j.title || '' }));
    } catch {}
    try { fs.unlinkSync(info); } catch {}
  }
  const artFor = (file) => { for (const e of IMG) { const f = base(file) + e; if (fs.existsSync(f)) return f; } return ''; };
  const detailsFor = (file) => { try { return JSON.parse(fs.readFileSync(base(file) + '.minapp.json', 'utf8')) || {}; } catch { return {}; } };

  // ----- yt-dlp -----
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp_linux';
  const bin = () => path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  async function fetchBin() {
    fs.mkdirSync(binDir, { recursive: true });
    const r = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + asset);
    if (!r.ok) throw new Error('Could not download yt-dlp (HTTP ' + r.status + ')');
    const tmp = bin() + '.part';
    fs.writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, bin());
  }
  const haveBin = () => fs.existsSync(bin());

  // ----- ffmpeg (only for "Save as MP3"): a static build from the npm registry, checked against its published hash -----
  const ffBin = () => path.join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  const haveFf = () => fs.existsSync(ffBin());
  const ffPkg = () => '@ffmpeg-installer/' + (process.platform === 'win32' ? 'win32-x64'
    : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64') : 'linux-x64');
  async function fetchFf() {
    fs.mkdirSync(binDir, { recursive: true });
    const meta = await (await fetch('https://registry.npmjs.org/' + ffPkg() + '/latest')).json();
    const r = await fetch(meta.dist.tarball);
    if (!r.ok) throw new Error('Could not download the MP3 converter (HTTP ' + r.status + ')');
    const buf = Buffer.from(await r.arrayBuffer());
    const [algo, want] = String(meta.dist.integrity || '').split('-');
    if (!want || crypto.createHash(algo).update(buf).digest('base64') !== want) throw new Error('The MP3 converter download was damaged. Try again.');
    const tmp = fs.mkdtempSync(path.join(binDir, 'ff-'));
    try {
      const tgz = path.join(tmp, 'ff.tgz'); fs.writeFileSync(tgz, buf);
      const name = 'package/' + path.basename(ffBin());
      await new Promise((ok, no) => {
        const t = spawn(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xzf', tgz, '-C', tmp, name], { windowsHide: true });
        t.on('error', no); t.on('close', (c) => (c ? no(new Error('Could not unpack the MP3 converter')) : ok()));
      });
      const got = path.join(tmp, name);
      fs.chmodSync(got, 0o755);
      fs.renameSync(got, ffBin());
    } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
  }

  // One yt-dlp run. onProgress(text, info) where info = { phase, i, n, title, pct, saved, wait }.
  // Resolves { ok, files, error, rateLimited, total }.
  // YouTube throttles a session that fetches hundreds of videos quickly, so every request is spaced out. When it
  // answers with a rate-limit anyway, the run stops at once (rateLimited) and download() waits and resumes.
  const RATE = /rate-limited|HTTP Error 429|Too Many Requests/i;
  let child = null, cancelled = false, paused = false, wake = null;
  const cur = { i: 0, n: 0, title: '', pct: 0, saved: 0 }; // what the progress bar shows
  function runYtDlp(url, isList, onProgress, archive, mp3) {
    return new Promise((resolve) => {
      const out = isList ? '%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s' : 'Singles/%(title)s.%(ext)s';
      const args = ['-f', 'bestaudio[ext=m4a]/bestaudio', isList ? '--yes-playlist' : '--no-playlist', '--ignore-errors', '--no-overwrites',
        '--windows-filenames', '--no-mtime', '--newline', '--no-colors',
        // be gentle with YouTube: pause between video lookups and downloads, and retry flaky requests
        '--sleep-requests', '1.5', '--sleep-interval', '2', '--max-sleep-interval', '6',
        '--retries', '5', '--extractor-retries', '3', '--retry-sleep', 'http:exp=1:30', '--retry-sleep', 'extractor:exp=2:60',
        // remembers finished videos, so a resumed run does not look every one of them up again
        '--download-archive', archive,
        // machine-readable lines for the progress bar: which song (n of total) and how far into it
        '--progress', '--progress-template', 'download:MINAPP_PCT %(progress._percent_str)s',
        '--print', 'before_dl:MINAPP_ITEM %(playlist_index|1)s/%(n_entries|1)s %(title)s',
        // MP3 320 kbps constant bit rate with title/artist tags: plays in every DJ app and keeps beat grids stable
        ...(mp3 ? ['-x', '--audio-format', 'mp3', '--audio-quality', '320K', '--embed-metadata', '--ffmpeg-location', ffBin()] : []),
        // the cover (YouTube thumbnail) saved next to each song, plus its details (album, artist) for the album panel;
        // MP3s also get the cover embedded, so DJ apps and Finder / Explorer show it too
        '--write-thumbnail', '--write-info-json', '--no-write-playlist-metafiles',
        ...(mp3 ? ['--convert-thumbnails', 'jpg', '--embed-thumbnail'] : []),
        '--print', 'after_move:filepath', '-o', out, '-P', dir, '--', url];
      // own process group off Windows, so a stop can take down yt-dlp and everything it started
      const p = spawn(bin(), args, { windowsHide: true, detached: process.platform !== 'win32' });
      child = p;
      const files = []; let err = '', buf = '', ebuf = '', rateLimited = false, total = 0;
      const emit = () => onProgress(`Downloading ${cur.i} of ${cur.n}: ${cur.title}`, { phase: 'downloading', ...cur });
      const line = (l) => {
        l = l.trim(); if (!l) return;
        let m;
        if ((m = /^MINAPP_ITEM (\d+)\/(\d+) (.*)$/.exec(l))) { cur.i = +m[1]; cur.n = total = +m[2]; cur.title = m[3]; cur.pct = 0; emit(); return; }
        if ((m = /^MINAPP_PCT\s*([\d.]+)%/.exec(l))) { const v = +m[1]; if (Math.abs(v - cur.pct) >= 1 || v >= 100) { cur.pct = v; emit(); } return; }
        if (path.isAbsolute(l) && AUDIO.test(l)) { files.push(l); keepDetails(l); cur.saved++; cur.pct = 100; emit(); }
      };
      const eline = (l) => {
        if (RATE.test(l) && !rateLimited) { rateLimited = true; killTree(p); }
      };
      p.stdout.on('data', (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(line); });
      p.stderr.on('data', (d) => {
        err += d; if (err.length > 4000) err = err.slice(-4000);
        ebuf += d; const parts = ebuf.split(/\r?\n/); ebuf = parts.pop(); parts.forEach(eline);
      });
      p.on('error', (e) => resolve({ ok: false, files, error: e.message, rateLimited, total }));
      let done = false;
      p.on('exit', (code) => setTimeout(() => finish(code), 1500));
      p.on('close', (code) => finish(code));
      const finish = (code) => {
        if (done) return; done = true;
        child = null; line(buf); eline(ebuf);
        const quiet = rateLimited || cancelled || paused;
        resolve({ ok: files.length > 0, files, rateLimited, total, error: err.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop() || (code && !quiet ? 'yt-dlp exited with code ' + code : '') });
      };
    });
  }
  // Waits 5, 15 and 30 minutes (YouTube's cool-down is up to an hour) and resumes each time. Pause stops yt-dlp
  // and Resume starts it again: the resume list and yt-dlp's own .part files make it carry on where it was.
  // Resolves { ok, files (saved by this call), error, rateLimited (true: ended before the playlist was complete), total }.
  const WAITS = [5, 15, 30];
  const sleep = (ms) => new Promise((r) => { wake = r; setTimeout(r, ms); });
  async function download(url, isList, onProgress, fresh, mp3) {
    cancelled = false; paused = false; Object.assign(cur, { i: 0, n: 0, title: '', pct: 0, saved: 0 });
    if (!haveBin() || fresh) { onProgress('Fetching yt-dlp…', { phase: 'preparing', ...cur, title: 'Fetching yt-dlp…' }); await fetchBin(); }
    if (mp3 && !haveFf()) { onProgress('Fetching the MP3 converter…', { phase: 'preparing', ...cur, title: 'Fetching the MP3 converter...' }); await fetchFf(); }
    onProgress('Reading the playlist…', { phase: 'preparing', ...cur, title: isList ? 'Reading the playlist…' : 'Reading the video…' });
    fs.mkdirSync(binDir, { recursive: true });
    const archive = path.join(binDir, 'archive-' + crypto.createHash('sha1').update(url + (mp3 ? '#mp3' : '')).digest('hex').slice(0, 12) + '.txt');
    const files = []; let total = 0, res;
    const stopped = () => ({ ok: files.length > 0, files, error: 'Stopped.', rateLimited: true, total, cancelled: true });
    for (let round = 0; ; ) {
      while (paused && !cancelled) { onProgress('Download paused', { phase: 'paused', ...cur }); await sleep(1000); }
      if (cancelled) return stopped();
      res = await runYtDlp(url, isList, onProgress, archive, mp3);
      files.push(...res.files); total = res.total || total;
      if (cancelled) return stopped();
      if (paused) continue; // stopped by Pause, not by YouTube: wait above, then carry on in the same round
      if (!res.rateLimited) { try { fs.unlinkSync(archive); } catch {} break; } // finished: forget the resume list
      if (round >= WAITS.length) break;
      const end = Date.now() + WAITS[round++] * 60000;
      while (Date.now() < end && !cancelled) {
        const s = Math.ceil((end - Date.now()) / 1000), wait = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        onProgress(`YouTube asked to slow down. Resuming in ${wait} (${files.length} saved so far)`, { phase: 'waiting', ...cur, wait });
        await sleep(1000);
      }
      if (cancelled) return stopped();
    }
    return { ok: files.length > 0, files, error: res.error, rateLimited: !!res.rateLimited, total };
  }
  // ----- covers for songs saved before Minapp kept them -----
  // every song in the library that has no picture next to it
  const withoutCover = () => playlists().flatMap((p) => tracks(p.name)).filter((t) => !artFor(t.path));
  // Looks each song up on YouTube by its title and saves the picture and details of the first match next to it.
  // Nothing is downloaded again. Resolves { found, missed, total, cancelled, rateLimited }.
  async function fillCovers(onProgress) {
    cancelled = false; paused = false;
    const list = withoutCover();
    const out = { found: 0, missed: 0, total: list.length, cancelled: false, rateLimited: false };
    if (!list.length) return out;
    if (!haveBin()) { onProgress('Fetching yt-dlp…', { phase: 'preparing', i: 0, n: list.length, title: 'Fetching yt-dlp…', pct: 0 }); await fetchBin(); }
    for (let i = 0; i < list.length; i++) {
      while (paused && !cancelled) { onProgress('Paused', { phase: 'paused', i: i + 1, n: list.length, title: list[i].title, pct: 0 }); await sleep(1000); }
      if (cancelled) { out.cancelled = true; break; }
      const t = list[i];
      onProgress(`Cover ${i + 1} of ${list.length}: ${t.title}`, { phase: 'downloading', i: i + 1, n: list.length, title: 'Cover: ' + t.title, pct: 50, saved: out.found });
      const limited = await new Promise((resolve) => {
        const args = ['--skip-download', '--no-playlist', '--write-thumbnail', '--write-info-json', '--no-colors', '--sleep-requests', '1.5',
          '--retries', '3', '-o', base(t.path).replace(/%/g, '%%') + '.%(ext)s', '--', 'ytsearch1:' + t.title];
        const p = spawn(bin(), args, { windowsHide: true, detached: process.platform !== 'win32' });
        child = p; let err = '', done = false;
        const end = () => { if (done) return; done = true; child = null; resolve(RATE.test(err)); };
        p.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
        p.stdout.on('data', () => {});
        p.on('error', end); p.on('close', end);
      });
      if (paused) { i--; continue; } // stopped by Pause: the same song again after Resume
      keepDetails(t.path);
      if (artFor(t.path)) out.found++; else out.missed++;
      if (limited) { out.rateLimited = true; break; }
      if (!cancelled && i < list.length - 1) await sleep(1500); // be gentle with YouTube
    }
    if (cancelled) out.cancelled = true;
    return out;
  }
  const cancel = () => { cancelled = true; paused = false; try { child && killTree(child); } catch {} if (wake) wake(); };
  // pause(true) stops yt-dlp until pause(false); a pause during a rate-limit wait is just shown, the wait keeps counting
  const pause = (on) => { paused = !!on; if (paused) { try { child && killTree(child); } catch {} } else if (wake) wake(); };
  const isPaused = () => paused;
  return { dir, playlists, tracks, importFiles, audioIn, download, cancel, pause, isPaused, haveBin, haveFf, safeName, artFor, detailsFor, withoutCover, fillCovers };
}
module.exports = { create, AUDIO };
