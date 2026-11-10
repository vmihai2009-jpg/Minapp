// Words for the info panel: a song's lyrics (from lrclib.net, timed to the music where it has them) and a short
// "about the artist" (the opening of the artist's Wikipedia page). Both are free services that need no account.
const UA = 'Minapp (desktop music player)';
const cache = new Map(); // answers are remembered while the app runs
const MUSIC = /\b(band|singer|musician|rapper|songwriter|dj|disc jockey|composer|duo|trio|group|producer|vocalist|guitarist|pianist|drummer|bassist|orchestra|ensemble|choir|recording artist|music)/i;

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// YouTube titles and Spotify "remaster" suffixes get in the way of a match: reduce to the plain artist and song
const NOISE = /official|video|audio|lyric|visuali[sz]er|\bhd\b|\bhq\b|\b4k\b|remaster|explicit|version|\bedit\b|\bmix\b|\bmono\b|\bstereo\b|\blive\b|feat\.?|\bft\.?|\bprod\b|bonus|deluxe|\bm\/v\b|\bmv\b/i;
function clean(artist, title) {
  let a = String(artist || '').trim(), t = String(title || '').trim();
  a = a.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  t = t.replace(/\s*[([{][^)\]}]*[)\]}]/g, (m) => (NOISE.test(m) ? '' : m));
  const dash = t.split(/\s+[-–—]\s+/);
  if (dash.length > 1 && NOISE.test(dash[dash.length - 1]) && dash.length > 1) { dash.pop(); t = dash.join(' - '); }
  const parts = t.split(/\s+[-–—]\s+/);
  const n = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  // "Artist - Song" in the title: use it unless the artist we were given is itself part of the song name
  if (parts.length === 2 && !(a && n(parts[1]).includes(n(a)) && !n(parts[0]).includes(n(a)))) { a = parts[0]; t = parts[1]; }
  t = t.replace(/\s+(feat\.?|ft\.?)\s+.*$/i, '').replace(/^["“]|["”]$/g, '').trim();
  // "A, B" and "A & B" may be one name (Earth, Wind & Fire) or several artists: the whole name is tried first
  const first = a.split(/\s*(?:,|;|&| x | feat\.? | ft\.? )\s*/i)[0].trim();
  return { artist: a, first: first && first !== a ? first : '', title: t };
}

function parseSynced(lrc) {
  const out = [];
  for (const line of String(lrc || '').split(/\r?\n/)) {
    const m = /^\s*\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(line);
    if (m) out.push({ t: Number(m[1]) * 60 + Number(m[2]), s: m[3].trim() });
  }
  return out.length ? out : null;
}

async function lyrics({ artist, title, duration }) {
  const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const base = 'https://lrclib.net/api/';
  let hit = null;
  const dur = Number.isFinite(duration) && duration > 20 && duration < 3600 ? Math.round(duration) : 0;
  if (artist && dur) hit = await getJson(base + 'get?' + q({ artist_name: artist, track_name: title, duration: dur }));
  if (!hit) {
    let list = artist ? await getJson(base + 'search?' + q({ track_name: title, artist_name: artist })) : null;
    if (!list || !list.length) list = await getJson(base + 'search?' + q({ q: `${artist} ${title}`.trim() }));
    if (Array.isArray(list) && list.length) {
      const score = (x) => (x.syncedLyrics ? 0 : 100) + (x.plainLyrics || x.syncedLyrics || x.instrumental ? 0 : 1000) + (dur && x.duration ? Math.min(60, Math.abs(x.duration - dur)) : 30);
      hit = list.slice().sort((x, y) => score(x) - score(y))[0];
    }
  }
  if (!hit) return { status: 'none' };
  if (hit.instrumental) return { status: 'ok', instrumental: true, text: '', synced: null };
  // timed lines only help when they belong to the same recording (same length, give or take)
  const sameCut = !dur || !hit.duration || Math.abs(hit.duration - dur) <= 4;
  const synced = sameCut ? parseSynced(hit.syncedLyrics) : null;
  const text = String(hit.plainLyrics || (hit.syncedLyrics || '').replace(/^\s*\[[^\]]*\]\s?/gm, '') || '').trim();
  if (!text && !synced) return { status: 'none' };
  return { status: 'ok', synced, text };
}

async function wikiIntro(name) {
  const s = await getJson('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(name.replace(/ /g, '_')) + '?redirect=true');
  if (!s || s.type !== 'standard' || !s.extract) return null;
  if (!MUSIC.test(`${s.description || ''} ${s.extract}`)) return null;
  let text = s.extract;
  try { // the whole opening section rather than its first paragraph
    const j = await getJson('https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&titles=' + encodeURIComponent(s.title));
    const page = j && j.query && j.query.pages && Object.values(j.query.pages)[0];
    if (page && page.extract && page.extract.length > text.length) text = page.extract;
  } catch {}
  return { status: 'ok', name: s.title, about: s.description || '', text: text.trim() };
}
async function about({ artist }) {
  if (!artist) return { status: 'none' };
  const direct = await wikiIntro(artist);
  if (direct) return direct;
  const j = await getJson('https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=4&srsearch=' + encodeURIComponent(`${artist} musician OR band OR singer`));
  for (const r of (j && j.query && j.query.search) || []) {
    const hit = await wikiIntro(r.title);
    if (hit) return hit;
  }
  return { status: 'none' };
}

// kind: 'lyrics' or 'artist'. Never throws: { status: 'ok' | 'none' | 'error', ... }
async function songInfo(kind, song) {
  const c = clean(song && song.artist, song && song.title);
  if (!c.title && kind === 'lyrics') return { status: 'none' };
  const key = kind === 'artist' ? 'a|' + c.artist.toLowerCase() : `l|${c.artist}|${c.title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  let res;
  try {
    const ask = (artist) => (kind === 'artist' ? about({ artist }) : lyrics({ artist, title: c.title, duration: Number(song && song.duration) }));
    res = await ask(c.artist);
    if (res.status === 'none' && c.first) res = await ask(c.first);
  }
  catch (e) { return { status: 'error', message: String((e && e.message) || e) }; } // not remembered: the next try may work
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  cache.set(key, res);
  return res;
}

module.exports = { songInfo, clean, parseSynced };
