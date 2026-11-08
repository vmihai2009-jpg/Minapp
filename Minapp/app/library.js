// Local library: playlists are folders of audio files under <data>/library, plus the optional yt-dlp download
// (personal use only: the helper is fetched on first use, after the user confirms).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');

const AUDIO = /\.(mp3|m4a|aac|opus|ogg|oga|webm|wav|flac)$/i;
const safeName = (n) => String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(0, 80) || 'Playlist';

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

  // One yt-dlp run. onProgress(text, info) where info = { phase, i, n, title, pct, saved, wait }.
  // Resolves { ok, files, error, rateLimited, total }.
  // YouTube throttles a session that fetches hundreds of videos quickly, so every request is spaced out. When it
  // answers with a rate-limit anyway, the run stops at once (rateLimited) and download() waits and resumes.
  const RATE = /rate-limited|HTTP Error 429|Too Many Requests/i;
  let child = null, cancelled = false, paused = false, wake = null;
  const cur = { i: 0, n: 0, title: '', pct: 0, saved: 0 }; // what the progress bar shows
  function runYtDlp(url, isList, onProgress, archive) {
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
        '--print', 'after_move:filepath', '-o', out, '-P', dir, '--', url];
      const p = spawn(bin(), args, { windowsHide: true });
      child = p;
      const files = []; let err = '', buf = '', ebuf = '', rateLimited = false, total = 0;
      const emit = () => onProgress(`Downloading ${cur.i} of ${cur.n}: ${cur.title}`, { phase: 'downloading', ...cur });
      const line = (l) => {
        l = l.trim(); if (!l) return;
        let m;
        if ((m = /^MINAPP_ITEM (\d+)\/(\d+) (.*)$/.exec(l))) { cur.i = +m[1]; cur.n = total = +m[2]; cur.title = m[3]; cur.pct = 0; emit(); return; }
        if ((m = /^MINAPP_PCT\s*([\d.]+)%/.exec(l))) { const v = +m[1]; if (Math.abs(v - cur.pct) >= 1 || v >= 100) { cur.pct = v; emit(); } return; }
        if (path.isAbsolute(l) && AUDIO.test(l)) { files.push(l); cur.saved++; cur.pct = 100; emit(); }
      };
      const eline = (l) => {
        if (RATE.test(l) && !rateLimited) { rateLimited = true; try { p.kill(); } catch {} }
      };
      p.stdout.on('data', (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(line); });
      p.stderr.on('data', (d) => {
        err += d; if (err.length > 4000) err = err.slice(-4000);
        ebuf += d; const parts = ebuf.split(/\r?\n/); ebuf = parts.pop(); parts.forEach(eline);
      });
      p.on('error', (e) => resolve({ ok: false, files, error: e.message, rateLimited, total }));
      p.on('close', (code) => {
        child = null; line(buf); eline(ebuf);
        const quiet = rateLimited || cancelled || paused;
        resolve({ ok: files.length > 0, files, rateLimited, total, error: err.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop() || (code && !quiet ? 'yt-dlp exited with code ' + code : '') });
      });
    });
  }
  // Waits 5, 15 and 30 minutes (YouTube's cool-down is up to an hour) and resumes each time. Pause stops yt-dlp
  // and Resume starts it again: the resume list and yt-dlp's own .part files make it carry on where it was.
  // Resolves { ok, files (saved by this call), error, rateLimited (true: ended before the playlist was complete), total }.
  const WAITS = [5, 15, 30];
  const sleep = (ms) => new Promise((r) => { wake = r; setTimeout(r, ms); });
  async function download(url, isList, onProgress, fresh) {
    cancelled = false; paused = false; Object.assign(cur, { i: 0, n: 0, title: '', pct: 0, saved: 0 });
    if (!haveBin() || fresh) { onProgress('Fetching yt-dlp…', { phase: 'preparing', ...cur, title: 'Fetching yt-dlp…' }); await fetchBin(); }
    onProgress('Reading the playlist…', { phase: 'preparing', ...cur, title: isList ? 'Reading the playlist…' : 'Reading the video…' });
    fs.mkdirSync(binDir, { recursive: true });
    const archive = path.join(binDir, 'archive-' + crypto.createHash('sha1').update(url).digest('hex').slice(0, 12) + '.txt');
    const files = []; let total = 0, res;
    const stopped = () => ({ ok: files.length > 0, files, error: 'Stopped.', rateLimited: true, total, cancelled: true });
    for (let round = 0; ; ) {
      while (paused && !cancelled) { onProgress('Download paused', { phase: 'paused', ...cur }); await sleep(1000); }
      if (cancelled) return stopped();
      res = await runYtDlp(url, isList, onProgress, archive);
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
  const cancel = () => { cancelled = true; paused = false; try { child && child.kill(); } catch {} if (wake) wake(); };
  // pause(true) stops yt-dlp until pause(false); a pause during a rate-limit wait is just shown, the wait keeps counting
  const pause = (on) => { paused = !!on; if (paused) { try { child && child.kill(); } catch {} } else if (wake) wake(); };
  const isPaused = () => paused;
  return { dir, playlists, tracks, importFiles, audioIn, download, cancel, pause, isPaused, haveBin, safeName };
}
module.exports = { create, AUDIO };
