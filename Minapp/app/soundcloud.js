// SoundCloud through its own website's address (api-v2): the same one soundcloud.com uses in the browser.
// No developer key is needed: the public "client id" is read from the site itself, like other free tools do.
// A signed-in account adds the user's own playlists, likes, and the better stream a paid (Go+) account gets.
const API = 'https://api-v2.soundcloud.com';
// a browser name that matches this computer: SoundCloud's bot filter blocks a Mac name on Windows and any "Electron" tag
const OS = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
const UA = `Mozilla/5.0 (${OS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${(process.versions.chrome || '126.0.0.0')} Safari/537.36`;

function create({ log, getToken }) {
  let cid = '', cidAt = 0;
  const streams = new Map(); // track id -> { url, at }

  async function clientId(force) {
    if (cid && !force && Date.now() - cidAt < 6 * 3600e3) return cid;
    const home = await (await fetch('https://soundcloud.com/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).text();
    const scripts = [...home.matchAll(/<script[^>]+src="(https:\/\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
    for (const s of scripts.slice(0, 8)) {
      try {
        const js = await (await fetch(s, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) })).text();
        const m = /client_id\s*[:=]\s*"([A-Za-z0-9]{32})"/.exec(js);
        if (m) { cid = m[1]; cidAt = Date.now(); return cid; }
      } catch {}
    }
    throw new Error('Could not reach SoundCloud (no access key found on its site)');
  }
  const authHeaders = () => { const t = getToken(); return t ? { Authorization: 'OAuth ' + t } : {}; };

  async function api(path, params = {}, opts = {}) {
    for (let k = 0; k < 2; k++) {
      const u = new URL(/^https?:/.test(path) ? path : API + path);
      for (const [a, b] of Object.entries(params)) u.searchParams.set(a, b);
      u.searchParams.set('client_id', await clientId(k > 0));
      const r = await fetch(u, { method: opts.method || 'GET', headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() }, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: AbortSignal.timeout(20000) });
      if ((r.status === 401 || r.status === 403) && k === 0 && !opts.noRetry) continue; // the access key may have rotated: read it again
      if (r.status === 401 || r.status === 403) { const e = new Error('SoundCloud did not allow it (HTTP ' + r.status + ')'); e.auth = true; throw e; }
      if (r.status === 404) { const e = new Error('Not found on SoundCloud'); e.notFound = true; throw e; }
      if (!r.ok) throw new Error('SoundCloud answered HTTP ' + r.status);
      return r.status === 204 ? {} : r.json();
    }
  }
  // every page of a list answer ({ collection, next_href })
  async function pages(path, params, max = 20) {
    const out = [];
    let next = null;
    for (let k = 0; k < max; k++) {
      const j = await api(next || path, next ? {} : { limit: 50, linked_partitioning: 1, ...params });
      out.push(...(j.collection || []));
      next = j.next_href || null;
      if (!next) break;
    }
    return out;
  }
  // a track in the shape Minapp uses
  const track = (t) => t && t.id && t.title ? {
    id: t.id, title: t.title, artist: (t.publisher_metadata && t.publisher_metadata.artist) || (t.user && t.user.username) || '',
    url: t.permalink_url || '', art: String(t.artwork_url || (t.user && t.user.avatar_url) || '').replace('-large.', '-t200x200.'),
    ms: t.duration || 0, downloadable: !!t.downloadable, playable: t.policy !== 'BLOCK',
  } : null;
  // tracks of a list often arrive as bare ids: look the rest up 50 at a time
  async function fill(items) {
    const missing = items.filter((t) => t && t.id && !t.title).map((t) => t.id);
    const got = new Map();
    for (let i = 0; i < missing.length; i += 50) {
      try { for (const t of await api('/tracks', { ids: missing.slice(i, i + 50).join(',') })) got.set(t.id, t); } catch (e) { log('soundcloud fill: ' + e.message); }
    }
    return items.map((t) => (t && !t.title ? got.get(t.id) : t)).map(track).filter(Boolean);
  }

  let me = null;
  async function whoAmI() { if (!getToken()) return null; if (!me) me = await api('/me', {}, { noRetry: false }); return me; }
  const forget = () => { me = null; };

  // the user's lists: [{ id, name, n }]
  async function playlists() {
    const u = await whoAmI();
    if (!u) return { signedIn: false, items: [] };
    const own = await pages(`/users/${u.id}/playlists_without_albums`, {}, 6).catch(() => []);
    const liked = await pages(`/users/${u.id}/playlist_likes`, {}, 4).catch(() => []);
    const items = [{ id: 'likes', name: 'Liked tracks', n: u.public_favorites_count || 0 }];
    for (const p of own) items.push({ id: String(p.id), name: p.title, n: p.track_count || 0 });
    for (const x of liked) { const p = x.playlist; if (p && p.id && !items.some((i) => i.id === String(p.id))) items.push({ id: String(p.id), name: p.title, n: p.track_count || 0 }); }
    return { signedIn: true, user: u.username, items };
  }
  // the songs of a list: 'likes', a list id, or a pasted soundcloud.com link
  async function tracksOf(id) {
    if (id === 'likes') {
      const u = await whoAmI(); if (!u) return [];
      return (await pages(`/users/${u.id}/track_likes`, {}, 30)).map((x) => track(x.track)).filter(Boolean);
    }
    let pl;
    if (/^https?:/.test(id)) {
      const r = await api('/resolve', { url: id });
      if (r.kind === 'track') return [track(r)].filter(Boolean);
      if (r.kind === 'user') return (await pages(`/users/${r.id}/tracks`, {}, 20)).map(track).filter(Boolean);
      pl = r;
    } else pl = await api('/playlists/' + encodeURIComponent(id), { representation: 'full' });
    return fill(pl.tracks || []);
  }
  // a pasted link -> { name, n } so it can be listed
  async function describeLink(url) {
    const r = await api('/resolve', { url });
    return { name: r.title || r.username || 'SoundCloud', n: r.track_count || (r.kind === 'track' ? 1 : 0), kind: r.kind };
  }
  async function search(q, limit = 15) {
    const j = await api('/search/tracks', { q, limit });
    return (j.collection || []).map(track).filter(Boolean);
  }
  // a stream the player can play directly (a plain MP3 address; the HLS and Opus streams do not play in a simple audio tag)
  async function stream(id) {
    const c = streams.get(id);
    if (c && Date.now() - c.at < 15 * 60e3) return c.url;
    const t = await api('/tracks/' + id);
    const tc = ((t.media && t.media.transcodings) || []).find((x) => x.format && x.format.protocol === 'progressive');
    if (!tc) { const e = new Error('SoundCloud offers no direct stream for this track'); e.noStream = true; throw e; }
    const j = await api(tc.url, { track_authorization: t.track_authorization || '' });
    if (!j.url) throw new Error('SoundCloud gave no stream address');
    streams.set(id, { url: j.url, at: Date.now() });
    return j.url;
  }
  // make a private playlist on the account from track ids
  async function makePlaylist(title, ids) {
    const u = await whoAmI();
    if (!u) { const e = new Error('Sign in to SoundCloud first'); e.auth = true; throw e; }
    const first = ids.slice(0, 500);
    const r = await api('/playlists', {}, { method: 'POST', body: { playlist: { title, sharing: 'private', tracks: first } } });
    return { id: r.id, added: first.length };
  }
  return { clientId, api, playlists, tracksOf, describeLink, search, stream, makePlaylist, whoAmI, forget, track };
}
module.exports = { create, UA };
