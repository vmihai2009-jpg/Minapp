// YouTube account through Google's official sign-in: the login happens in the user's normal browser (Google refuses
// logins inside embedded browsers), Minapp gets a token and uses it to list the user's own playlists and
// the videos in them. The videos are then played by the usual YouTube player, so private playlists work too.
const http = require('http');
const crypto = require('crypto');

const b64 = (b) => Buffer.from(b).toString('base64url');
// full YouTube access (read + make playlists): copying a Spotify playlist to the account needs to create one
const SCOPE = 'https://www.googleapis.com/auth/youtube';

const netFetch = globalThis.fetch;
const fetch = (url, opts = {}) => netFetch(url, { signal: AbortSignal.timeout(15000), ...opts }); // never wait forever on a hung connection

function create({ shell, dialog, readCfg, writeCfg, askText, getWin, log, onChange }) {
  let access = null, exp = 0, playlists = [], loading = false, err = '';

  const signedIn = () => !!readCfg().ytRefresh;

  async function tokenCall(params) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || ('HTTP ' + r.status));
    access = j.access_token; exp = Date.now() + ((j.expires_in || 3600) - 60) * 1000;
    if (j.refresh_token) writeCfg({ ytRefresh: j.refresh_token });
    if (j.scope) writeCfg({ ytScope: j.scope });
  }

  async function bearer() {
    if (access && Date.now() < exp) return access;
    const c = readCfg();
    await tokenCall({ grant_type: 'refresh_token', refresh_token: c.ytRefresh, client_id: c.ytClientId, client_secret: c.ytClientSecret });
    return access;
  }

  async function api(path, qs, body) {
    const r = await fetch('https://www.googleapis.com/youtube/v3/' + path + '?' + new URLSearchParams(qs), body
      ? { method: 'POST', headers: { Authorization: 'Bearer ' + await bearer(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : { headers: { Authorization: 'Bearer ' + await bearer() } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
    return j;
  }

  async function refreshPlaylists() {
    if (!signedIn() || loading) return;
    loading = true; err = '';
    try {
      const out = [];
      const ch = await api('channels', { part: 'contentDetails', mine: 'true' });
      const likes = ch.items && ch.items[0] && ch.items[0].contentDetails.relatedPlaylists.likes;
      if (likes) out.push({ id: likes, title: 'Liked videos' });
      let page = '';
      for (let i = 0; i < 4; i++) {
        const j = await api('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: '50', ...(page ? { pageToken: page } : {}) });
        for (const p of j.items || []) out.push({ id: p.id, title: p.snippet.title, count: p.contentDetails.itemCount });
        page = j.nextPageToken; if (!page) break;
      }
      playlists = out;
    } catch (e) { err = String((e && e.message) || e); log('[youtube] playlists: ' + err); }
    loading = false;
    onChange();
  }

  // the video ids of one playlist (first 200)
  async function videoIds(playlistId) {
    const ids = [];
    let page = '';
    for (let i = 0; i < 4; i++) {
      const j = await api('playlistItems', { part: 'contentDetails', playlistId, maxResults: '50', ...(page ? { pageToken: page } : {}) });
      for (const it of j.items || []) if (it.contentDetails && it.contentDetails.videoId) ids.push(it.contentDetails.videoId);
      page = j.nextPageToken; if (!page) break;
    }
    return ids;
  }

  // names of videos (50 per request, 1 unit of the daily allowance each)
  async function titles(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 50) {
      const j = await api('videos', { part: 'snippet', id: ids.slice(i, i + 50).join(',') });
      for (const v of j.items || []) out.push({ id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle });
    }
    return out;
  }
  // a private playlist on the account with these videos. Google allows about 10,000 "units" a day per key and each
  // added video costs 50, so roughly 190 songs a day: onProgress(i, n) after each; stops cleanly at the limit
  const canWrite = () => signedIn() && /auth\/youtube( |$)/.test(readCfg().ytScope || '');
  async function makePlaylist(title, ids, onProgress) {
    const p = await api('playlists', { part: 'snippet,status' }, { snippet: { title, description: 'Made by Minapp' }, status: { privacyStatus: 'private' } });
    let added = 0;
    for (const id of ids) {
      try { await api('playlistItems', { part: 'snippet' }, { snippet: { playlistId: p.id, resourceId: { kind: 'youtube#video', videoId: id } } }); added++; }
      catch (e) { if (/quota/i.test(e.message)) return { id: p.id, added, quota: true }; log('[youtube] add failed: ' + e.message); }
      onProgress(added, ids.length);
    }
    refreshPlaylists();
    return { id: p.id, added };
  }
  // the LIKE button for YouTube: the video goes into a private "Minapp likes" playlist (made the first time)
  let likesId = '';
  async function addToLikes(videoId) {
    if (!likesId) {
      const j = await api('playlists', { part: 'snippet', mine: 'true', maxResults: '50' });
      const hit = (j.items || []).find((p) => p.snippet && p.snippet.title === 'Minapp likes');
      likesId = hit ? hit.id : (await api('playlists', { part: 'snippet,status' }, { snippet: { title: 'Minapp likes', description: 'Songs liked in Minapp' }, status: { privacyStatus: 'private' } })).id;
    }
    await api('playlistItems', { part: 'snippet' }, { snippet: { playlistId: likesId, resourceId: { kind: 'youtube#video', videoId } } });
    refreshPlaylists();
  }

  async function ensureClient() {
    const c = readCfg();
    if (c.ytClientId && c.ytClientSecret) return c;
    const r = await dialog.showMessageBox(getWin(), {
      type: 'info', buttons: ['Open Google Cloud', 'I have my keys', 'Cancel'], defaultId: 0, cancelId: 2,
      message: 'One-time setup for your YouTube account',
      detail: 'Google needs a free key of your own (like the Spotify one):\n\n' +
        '1. In Google Cloud, create a project (any name).\n' +
        '2. APIs & Services > Library: enable "YouTube Data API v3".\n' +
        '3. OAuth consent screen: choose External, fill the required names, add your own Google address under Test users, then press "Publish app" (otherwise sign-in expires every 7 days).\n' +
        '4. Credentials > Create credentials > OAuth client ID > type "Desktop app".\n' +
        '5. Copy the Client ID and the Client secret, then choose "I have my keys".',
    });
    if (r.response === 2) return null;
    if (r.response === 0) { shell.openExternal('https://console.cloud.google.com/projectcreate'); return null; }
    const id = await askText({ title: 'Google Client ID', label: 'Paste the Client ID:', placeholder: '123…apps.googleusercontent.com', button: 'Next' });
    if (!id || !/\.apps\.googleusercontent\.com$/.test(id.trim())) {
      if (id) dialog.showMessageBox(getWin(), { type: 'warning', message: "That doesn't look like a Client ID", detail: 'It ends in .apps.googleusercontent.com.' });
      return null;
    }
    const secret = await askText({ title: 'Google Client secret', label: 'Paste the Client secret:', placeholder: 'GOCSPX-…', button: 'Sign in' });
    if (!secret) return null;
    writeCfg({ ytClientId: id.trim(), ytClientSecret: secret.trim() });
    return readCfg();
  }

  async function signIn() {
    const c = await ensureClient();
    if (!c) return;
    const verifier = b64(crypto.randomBytes(48));
    const challenge = b64(crypto.createHash('sha256').update(verifier).digest());
    const state = b64(crypto.randomBytes(12));
    let redirect = '';
    const code = await new Promise((resolve) => {
      let timer = null;
      const srv = http.createServer((req, resp) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/callback') { resp.writeHead(404); resp.end(); return; }
        const good = u.searchParams.get('state') === state && u.searchParams.get('code');
        resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        resp.end(good ? 'Signed in. You can close this tab and go back to the player.' : 'Something went wrong. Close this tab and try again.');
        clearTimeout(timer); srv.close(); resolve(good ? u.searchParams.get('code') : null);
      });
      srv.on('error', () => { clearTimeout(timer); resolve(null); });
      srv.listen(0, '127.0.0.1', () => {
        redirect = 'http://127.0.0.1:' + srv.address().port + '/callback';
        timer = setTimeout(() => { srv.close(); resolve(null); }, 180000);
        shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
          response_type: 'code', client_id: c.ytClientId, redirect_uri: redirect, scope: SCOPE,
          access_type: 'offline', prompt: 'consent', code_challenge_method: 'S256', code_challenge: challenge, state,
        }).toString());
      });
    });
    if (!code) return;
    try {
      await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: c.ytClientId, client_secret: c.ytClientSecret, code_verifier: verifier });
    } catch (e) {
      dialog.showMessageBox(getWin(), { type: 'warning', message: 'YouTube sign-in failed', detail: String((e && e.message) || e) });
      return;
    }
    onChange();
    await refreshPlaylists();
  }

  function signOut() {
    const t = readCfg().ytRefresh;
    writeCfg({ ytRefresh: null });
    access = null; playlists = []; err = '';
    if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {});
    onChange();
  }

  return { signedIn, signIn, signOut, refreshPlaylists, videoIds, titles, canWrite, makePlaylist, addToLikes, playlists: () => playlists, error: () => err, loading: () => loading };
}

module.exports = { create };
