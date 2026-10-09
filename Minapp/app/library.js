// Local library: playlists are folders of audio files under <data>/library, plus the optional yt-dlp download
// (personal use only: the helper is fetched on first use, after the user confirms).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

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

  // onProgress(text). Resolves { ok, folder, count, errors }.
  function runYtDlp(url, isList, onProgress) {
    return new Promise((resolve) => {
      const out = isList ? '%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s' : 'Singles/%(title)s.%(ext)s';
      const args = ['-f', 'bestaudio[ext=m4a]/bestaudio', isList ? '--yes-playlist' : '--no-playlist', '--ignore-errors', '--no-overwrites',
        '--windows-filenames', '--no-mtime', '--newline', '--no-colors', '--print', 'after_move:filepath', '-o', out, '-P', dir, '--', url];
      const p = spawn(bin(), args, { windowsHide: true });
      const files = []; let err = '', buf = '';
      const line = (l) => {
        l = l.trim(); if (!l) return;
        if (path.isAbsolute(l) && AUDIO.test(l)) { files.push(l); return; }
        const m = /Downloading item (\d+) of (\d+)/.exec(l); if (m) onProgress(`Downloading ${m[1]} of ${m[2]}…`);
      };
      p.stdout.on('data', (d) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop(); parts.forEach(line); });
      p.stderr.on('data', (d) => { err += d; if (err.length > 4000) err = err.slice(-4000); });
      p.on('error', (e) => resolve({ ok: false, files, error: e.message }));
      p.on('close', (code) => { line(buf); resolve({ ok: files.length > 0, files, error: err.split(/\r?\n/).filter((l) => /ERROR/.test(l)).pop() || (code ? 'yt-dlp exited with code ' + code : '') }); });
    });
  }
  async function download(url, isList, onProgress, fresh) {
    if (!haveBin() || fresh) { onProgress('Fetching yt-dlp…'); await fetchBin(); }
    return runYtDlp(url, isList, onProgress);
  }
  return { dir, playlists, tracks, importFiles, audioIn, download, haveBin, safeName };
}
module.exports = { create, AUDIO };
