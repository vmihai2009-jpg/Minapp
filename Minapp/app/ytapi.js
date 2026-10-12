// YouTube account without any Google developer key: Google refuses logins inside embedded browsers, so Minapp
// borrows the YouTube login of a browser the user is already signed in to (Chrome, Firefox, ...). yt-dlp reads that
// browser's cookies on this computer only to list the user's playlists and the videos in private ones; the videos
// themselves are then played by the normal YouTube player.
const BROWSERS = [['chrome', 'Chrome'], ['safari', 'Safari'], ['firefox', 'Firefox'], ['brave', 'Brave'], ['edge', 'Edge']];

function create({ library, readCfg, writeCfg, dialog, getWin, log, onChange }) {
  let lists = [], loading = false, err = '';
  const browser = () => readCfg().ytBrowser || '';
  const note = (m) => log('[youtube] ' + m);

  async function run(url) {
    const r = await library.list(url, browser(), note);
    if (!r.ok) throw new Error(r.error || 'nothing found');
    return r.items;
  }

  function setBrowser(b) { writeCfg({ ytBrowser: b || null }); lists = []; err = ''; onChange(); }

  // the user's own playlists, plus Liked videos
  async function refreshPlaylists() {
    if (!browser() || loading) return;
    loading = true; err = ''; onChange();
    try {
      let items = [];
      try { items = await run('https://www.youtube.com/feed/playlists'); } catch (e) { err = String((e && e.message) || e); note('playlists: ' + err); }
      lists = [{ id: 'LL', title: 'Liked videos' }, ...items.filter((x) => x.id !== 'LL')];
      if (items.length) err = '';
    } finally { loading = false; onChange(); }
  }

  // the video ids of a playlist (first 200); private ones work when a browser login is chosen
  async function videoIds(playlistId) { return (await run('https://www.youtube.com/playlist?list=' + encodeURIComponent(playlistId))).map((x) => x.id); }

  return { BROWSERS, browser, setBrowser, refreshPlaylists, videoIds, playlists: () => lists, error: () => err, loading: () => loading };
}

module.exports = { create, BROWSERS };
