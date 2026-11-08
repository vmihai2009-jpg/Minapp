// In-app updates from GitHub Releases. A release carries Minapp-Windows-vX.Y.Z.zip and Minapp-Mac-vX.Y.Z.zip (built by
// .github/workflows/release.yml). Minapp only replaces its own code (the app folder); settings, skins, the library and the
// downloaded player engine are untouched.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO = 'vmihai2009-jpg/Winamp-port';
const ver = (v) => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function newer(a, b) { // is version a newer than b?
  const x = ver(a), y = ver(b);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); }
  return false;
}
const platformKey = () => (process.platform === 'win32' || (process.env.MINAPP_UPDATE_URL && process.platform === 'linux') ? 'Windows' : process.platform === 'darwin' ? 'Mac' : null);
// MINAPP_UPDATE_URL points the check at a local test server (used only by Minapp's own tests)
const TEST = process.env.MINAPP_UPDATE_URL;
const trusted = (u) => { try { const h = new URL(u); if (TEST && h.hostname === '127.0.0.1') return true; return h.protocol === 'https:' && /(^|\.)github\.com$|(^|\.)githubusercontent\.com$/.test(h.hostname); } catch { return false; } };

// Resolves { current, latest, newer, notes, page, asset: {name,url,size}|null } or throws.
async function check(current, fetchImpl = fetch) {
  const r = await fetchImpl(TEST || `https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Minapp-updater' } });
  if (r.status === 404) return { current, latest: current, newer: false, none: true };
  if (!r.ok) throw new Error('GitHub answered HTTP ' + r.status);
  const rel = await r.json();
  const latest = String(rel.tag_name || '').replace(/^v/i, '');
  const key = platformKey();
  const a = key && (rel.assets || []).find((x) => new RegExp(`^Minapp-${key}-v[\\d.]+\\.zip$`, 'i').test(x.name) && trusted(x.browser_download_url));
  return { current, latest, newer: newer(latest, current), notes: String(rel.body || '').slice(0, 1200), page: rel.html_url,
    asset: a ? { name: a.name, url: a.browser_download_url, size: a.size } : null };
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let err = ''; p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (c) => (c ? reject(new Error(`${cmd} failed: ${err.trim().slice(-300)}`)) : resolve()));
  });
}
const unzip = (zip, to) => (process.platform === 'win32' ? run('tar.exe', ['-xf', zip, '-C', to]) : process.platform === 'darwin' ? run('ditto', ['-x', '-k', zip, to]) : run('unzip', ['-q', zip, '-d', to]));

// Copies one file or folder over the installed one. Unchanged files are left alone. Windows refuses to overwrite a
// file that is in use (the Core Audio helper DLL is loaded while Minapp runs), but it does allow renaming it: the old
// copy is moved aside as *.old and removed at the next start (cleanupOld).
function copyOver(from, to) {
  if (fs.statSync(from).isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) copyOver(path.join(from, f), path.join(to, f));
    return;
  }
  try { if (fs.readFileSync(from).equals(fs.readFileSync(to))) return; } catch {}
  try { fs.copyFileSync(from, to); }
  catch (e) {
    if (!fs.existsSync(to)) throw e;
    const old = to + '.' + Date.now() + '.old';
    fs.renameSync(to, old);
    fs.copyFileSync(from, to);
  }
}
function cleanupOld(appDir) {
  try { for (const f of fs.readdirSync(appDir)) if (/\.\d+\.old$/.test(f)) { try { fs.unlinkSync(path.join(appDir, f)); } catch {} } } catch {}
}

// Downloads the release zip and copies its app code over appDir. onProgress(text). Never touches node_modules or data.
async function install(info, appDir, onProgress, fetchImpl = fetch) {
  if (!info.asset) throw new Error('This release has no download for your system.');
  fs.accessSync(appDir, fs.constants.W_OK); // fail early (e.g. a read-only install folder)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minapp-update-'));
  try {
    onProgress('Downloading update…');
    const r = await fetchImpl(info.asset.url, { headers: { 'User-Agent': 'Minapp-updater' } });
    if (!r.ok) throw new Error('Download failed (HTTP ' + r.status + ')');
    const buf = Buffer.from(await r.arrayBuffer());
    if (info.asset.size && buf.length !== info.asset.size) throw new Error('The download was incomplete. Try again.');
    const zip = path.join(tmp, 'update.zip'); fs.writeFileSync(zip, buf);
    onProgress('Unpacking…');
    const x = path.join(tmp, 'x'); fs.mkdirSync(x);
    await unzip(zip, x);
    const src = process.platform === 'darwin' ? path.join(x, 'Minapp-Mac', 'Minapp.app', 'Contents', 'Resources', 'app') : path.join(x, 'Minapp-Windows', 'app');
    const pj = path.join(src, 'package.json');
    if (!fs.existsSync(pj) || !fs.existsSync(path.join(src, 'main.js'))) throw new Error('The update file has an unexpected layout.');
    const nv = JSON.parse(fs.readFileSync(pj, 'utf8')).version;
    if (!newer(nv, info.current)) throw new Error('The update file is not newer than this version.');
    onProgress('Installing…');
    // package.json goes last, so an interruption leaves the old version number and the check simply offers the update again
    for (const f of fs.readdirSync(src)) {
      if (f === 'node_modules' || f === 'data' || f === 'package.json') continue;
      copyOver(path.join(src, f), path.join(appDir, f));
    }
    fs.copyFileSync(pj, path.join(appDir, 'package.json'));
    // Mac: the code lives inside the signed engine bundle, so give it a fresh ad-hoc signature like the launcher does
    const bundle = path.resolve(appDir, '..', '..', '..');
    if (process.platform === 'darwin' && bundle.endsWith('.app')) { try { await run('codesign', ['--force', '--deep', '--sign', '-', bundle]); } catch {} }
    return nv;
  } finally { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}
module.exports = { check, install, newer, cleanupOld, REPO };
