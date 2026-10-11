// YouTube / YouTube Music sign-in. One persistent browser profile ("persist:youtube") is shared by the YouTube
// player window, the YouTube Music window and the browse window below, so signing in once covers all three and
// survives restarts. Google refuses sign-in from browsers it recognises as embedded (Electron announces itself in
// the user agent), so that profile presents itself as plain Chrome.
const { BrowserWindow, session } = require('electron');
const path = require('path');

const PARTITION = 'persist:youtube';
const LOGIN_URL = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=' + encodeURIComponent('https://www.youtube.com/feed/playlists');
const PLAYLISTS_URL = 'https://www.youtube.com/feed/playlists';

function create({ log, onChange, icon }) {
  const ses = session.fromPartition(PARTITION);
  ses.setUserAgent(ses.getUserAgent().replace(/\s*(Electron|minapp)\/\S+/gi, ''));
  let signedIn = false, win = null, timer = null;

  async function refresh() {
    let now = false;
    try { now = (await ses.cookies.get({ name: 'SAPISID' })).length > 0; } catch {}
    if (now !== signedIn) { signedIn = now; log('[youtube] signed ' + (now ? 'in' : 'out')); if (onChange) onChange(); }
  }
  ses.cookies.on('changed', () => { clearTimeout(timer); timer = setTimeout(refresh, 800); });
  refresh();

  // The real youtube.com in a window of its own, with a "Play in Minapp" button added to every page.
  function open() {
    const url = signedIn ? PLAYLISTS_URL : LOGIN_URL;
    if (win) { win.loadURL(url); win.show(); win.focus(); return; }
    win = new BrowserWindow({
      width: 1000, height: 760, title: 'YouTube: pick something for Minapp to play', icon,
      webPreferences: { partition: PARTITION, preload: path.join(__dirname, 'ytbrowse-preload.js'), contextIsolation: true },
    });
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(({ url: u }) => { win.loadURL(u); return { action: 'deny' }; });
    win.on('closed', () => { win = null; refresh(); });
    win.loadURL(url);
  }

  async function signOut() {
    if (win) win.close();
    try { await ses.clearStorageData(); await ses.clearCache(); } catch (e) { log('[youtube] sign-out: ' + e.message); }
    await refresh();
  }

  return { partition: PARTITION, isSignedIn: () => signedIn, open, signOut, close: () => { if (win) win.close(); } };
}

module.exports = { create, PARTITION };
