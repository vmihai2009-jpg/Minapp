// SoundCloud through its own website's address (api-v2): the same one soundcloud.com uses in the browser.
// No developer key is needed: the public "client id" is read from the site itself, like other free tools do.
// A signed-in account adds the user's own playlists, likes, and the better stream a paid (Go+) account gets.
const API = 'https://api-v2.soundcloud.com';
// a browser name that matches this computer: SoundCloud's bot filter blocks a Mac name on Windows and any "Electron" tag
const OS = process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : process.platform === 'darwin' ? 'Macintosh; Intel Mac OS X 10_15_7' : 'X11; Linux x86_64';
const UA = `Mozilla/5.0 (${OS}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${(process.versions.chrome || '126.0.0.0')} Safari/537.36`;

// the pieces of a chopped-up stream: { init (AAC only), segs: [address...] }
function parsePlaylist(text, base) {
  const abs = (u) => new URL(u, base).toString();
  const out = { init: '', segs: [] };
  for (const l of String(text).split(/\r?\n/)) {
    const m = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(l);
    if (m) out.init = abs(m[1]); else if (l && !l.startsWith('#')) out.segs.push(abs(l.trim()));
  }
  return out;
}

// page: { run(code) } runs code inside a real soundcloud.com page (the signed-in one): requests made there look like normal browsing
function create({ log, getToken, page }) {
  let cid = '', cidAt = 0;
  const streams = new Map(); // track id -> { url, at }

  async function clientId(force) {
    if (cid && !force && Date.now() - cidAt < 6 * 3600e3) return cid;
    if (page) { // the page itself carries the access key it uses
      try {
        const id = await page.run(`(() => { const h = (window.__sc_hydration || []).find((x) => x.hydratable === 'apiClient'); return h && h.data && h.data.id || ''; })()`);
        if (/^[A-Za-z0-9]{20,40}$/.test(id || '')) { cid = id; cidAt = Date.now(); return cid; }
      } catch (e) { log('soundcloud page key: ' + e.message); }
    }
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
  let appVer = '';
  async function appVersion() {
    if (appVer || !page) return appVer;
    try { const j = JSON.parse(await page.run(`fetch('https://soundcloud.com/versions.json').then((r) => r.text()).catch(() => '')`)); appVer = String(j.app || ''); } catch {}
    return appVer;
  }
  const authHeaders = () => { const t = getToken(); return t ? { Authorization: 'OAuth ' + t } : {}; };

  async function api(path, params = {}, opts = {}) {
    let challenged = false;
    for (let k = 0; k < 2; k++) {
      const u = new URL(/^https?:/.test(path) ? path : API + path);
      for (const [a, b] of Object.entries(params)) u.searchParams.set(a, b);
      u.searchParams.set('client_id', await clientId(k > 0));
      if (page && !u.searchParams.has('app_version')) { const v = await appVersion(); if (v) u.searchParams.set('app_version', v); u.searchParams.set('app_locale', 'en'); }
      const headers = { Accept: 'application/json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders() };
      const body = opts.body ? JSON.stringify(opts.body) : undefined;
      let r;
      if (page) {
        const x = await page.run(`fetch(${JSON.stringify(String(u))}, { method: ${JSON.stringify(opts.method || 'GET')}, headers: ${JSON.stringify(headers)}, body: ${JSON.stringify(body || null)}, credentials: 'include' }).then(async (r) => ({ status: r.status, text: await r.text() })).catch((e) => ({ status: 0, text: String(e) }))`);
        r = { status: x.status, ok: x.status >= 200 && x.status < 300, json: async () => JSON.parse(x.text), _text: x.text };
        if (!x.status) throw new Error('SoundCloud page request failed: ' + String(x.text).slice(0, 100));
      } else r = await fetch(u, { method: opts.method || 'GET', headers: { 'User-Agent': UA, ...headers }, body, signal: AbortSignal.timeout(20000) });
      // SoundCloud's security check ("prove you are human") on some actions: the person solves it in a window, then the request is repeated
      if (r.status === 403 && page && page.challenge && !challenged && /captcha-delivery\.com/.test(r._text || '')) {
        const m = /https:[^"'\s\\]+captcha-delivery\.com[^"'\s\\]*/.exec(String(r._text).replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
        challenged = true;
        if (m) { await page.challenge(m[0]); k--; continue; }
      }
      if ((r.status === 401 || r.status === 403) && k === 0 && !opts.noRetry) continue; // the access key may have rotated: read it again
      const where = `${opts.method || 'GET'} ${u.pathname}`, snip = String(r._text || '').replace(/\s+/g, ' ').slice(0, 160);
      if (r.status === 401) { const e = new Error(`SoundCloud says the sign-in has expired (${where}: HTTP 401 ${snip})`); e.auth = true; throw e; }
      if (r.status === 403) { const e = new Error(`SoundCloud refused the request (${where}: HTTP 403 ${snip})`); e.blocked = true; throw e; }
      if (r.status === 404) { const e = new Error('Not found on SoundCloud'); e.notFound = true; throw e; }
      if (!r.ok) throw new Error(`SoundCloud answered HTTP ${r.status} (${where}) ${snip}`);
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
  // a stream address: { url, hls (true: a playlist of small pieces, to be joined), mime }. A whole-file MP3 when SoundCloud has one,
  // else the chopped-up stream (MP3 pieces, or AAC pieces); Opus is skipped (it does not play here)
  async function stream(id, fresh) {
    const c = streams.get(id);
    if (c && !fresh && Date.now() - c.at < 15 * 60e3) return c.out;
    const t = await api('/tracks/' + id);
    const tcs = (t.media && t.media.transcodings) || [];
    const proto = (x, p) => x.format && x.format.protocol === p;
    const prog = tcs.find((x) => proto(x, 'progressive'));
    const hlsMp3 = tcs.find((x) => proto(x, 'hls') && /mpeg/.test(x.format.mime_type || ''));
    const hlsAac = tcs.find((x) => proto(x, 'hls') && /mp4/.test(x.format.mime_type || ''));
    const hlsOpus = tcs.find((x) => proto(x, 'hls') && /opus|ogg/.test(x.format.mime_type || ''));
    const tc = prog || hlsMp3 || hlsAac || hlsOpus;
    if (!tc) {
      const offered = tcs.length ? tcs.map((x) => `${x.format && x.format.protocol} ${x.format && x.format.mime_type}`).join('; ') : 'no formats at all';
      const e = new Error(`SoundCloud offers no playable stream for "${t.title}" (policy ${t.policy || 'unknown'}, formats: ${offered}). Tracks of this kind are often only playable in SoundCloud's own apps or with Go+.`);
      e.noStream = true; throw e;
    }
    const j = await api(tc.url, { track_authorization: t.track_authorization || '' });
    if (!j.url) throw new Error('SoundCloud gave no stream address');
    const out = { url: j.url, hls: tc !== prog, mime: tc === hlsAac ? 'audio/mp4; codecs="mp4a.40.2"' : tc === hlsOpus ? 'audio/ogg; codecs="opus"' : 'audio/mpeg' };
    streams.set(id, { out, at: Date.now() });
    return out;
  }
  // make a private playlist on the account from track ids
  async function makePlaylist(title, ids) {
    const u = await whoAmI();
    if (!u) { const e = new Error('Sign in to SoundCloud first'); e.auth = true; throw e; }
    const first = ids.slice(0, 500);
    // the same body the website sends when it makes a playlist
    const r = await api('/playlists', {}, { method: 'POST', body: { playlist: { _resource_id: 'f-' + Math.random().toString(36).slice(2, 10), _resource_type: 'playlist', title, sharing: 'private', tracks: first } } });
    return { id: r.id, added: first.length };
  }
  // a step-by-step check for the menu: [{ step, ok, note }]
  async function selfTest() {
    const out = [], t = async (step, f) => { try { out.push({ step, ok: true, note: String(await f()) }); } catch (e) { out.push({ step, ok: false, note: e.message }); } };
    await t('Access key', async () => (await clientId(true)).slice(0, 4) + '…');
    await t('Search (no sign-in needed)', async () => (await search('daft punk', 3)).length + ' results');
    await t('Your account', async () => { me = null; const u = await whoAmI(); return u ? u.username : 'not signed in'; });
    await t('Your playlists', async () => { const p = await playlists(); return p.signedIn ? p.items.length + ' lists' : 'not signed in'; });
    return out;
  }
  return { selfTest, clientId, api, playlists, tracksOf, describeLink, search, stream, makePlaylist, whoAmI, forget, track };
}
module.exports = { create, UA, parsePlaylist };
