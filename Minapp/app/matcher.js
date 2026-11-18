// Song matching for copying playlists between services (Spotify, YouTube, SoundCloud).
// Instead of taking the first search result, every candidate is scored on artist, title and length, and the best one wins.
// Scores: 0..1. "sure" = very likely the right song, "maybe" = probably, but worth a look, "none" = nothing close enough.

const strip = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const norm = (s) => strip(s).replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, '');
// words that say "this is a different version of the song": only a problem if the wanted song does not say it too
const VERSIONS = ['live', 'remix', 'cover', 'karaoke', 'instrumental', 'acoustic', 'demo', 'sped up', 'slowed', 'reverb', 'nightcore', 'bootleg', 'mashup', 'edit', 'extended', '8d', 'tribute', 'medley', 'reprise', 'a cappella', 'acapella', 'radio edit', 'remastered'];
const verRe = (w) => new RegExp('(^|[^\\p{L}\\p{N}])' + w.replace(' ', '[\\s-]*') + '($|[^\\p{L}\\p{N}])', 'iu');
const VER_RES = VERSIONS.map((w) => [w, verRe(w)]);
const versionsOf = (s) => new Set(VER_RES.filter(([, re]) => re.test(strip(s))).map(([w]) => w));
// "(feat. X)", "[Official Video]", "- Remastered 2011" and similar are left out when comparing titles
const NOISE = /official|video|audio|lyric|visuali[sz]er|\bhd\b|\bhq\b|\b4k\b|remaster|explicit|\bversion\b|\bmono\b|\bstereo\b|feat\.?|\bft\.?|\bprod\b|bonus|deluxe|\bm\/v\b|\bmv\b|\bwith\b|\bfull\b|\bsingle\b|\balbum\b/i;
function coreTitle(t) {
  let s = strip(t).replace(/\s*[([{][^)\]}]*[)\]}]/g, (m) => (NOISE.test(m) ? '' : m));
  s = s.replace(/\s+[-–—]\s+(remaster(ed)?.*|\d{4}\b.*|single version|album version|radio edit|mono|stereo|official.*|.*\bversion)$/i, '');
  s = s.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
  return norm(s);
}
const toks = (s) => strip(s).replace(/&/g, ' and ').split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 0);
function dice(a, b) { // overlap of two words lists, 0..1
  if (!a.length || !b.length) return 0;
  const bs = new Map(); b.forEach((x) => bs.set(x, (bs.get(x) || 0) + 1));
  let hit = 0; a.forEach((x) => { if (bs.get(x) > 0) { hit++; bs.set(x, bs.get(x) - 1); } });
  return (2 * hit) / (a.length + b.length);
}
const artistNames = (a) => String(a || '').split(/\s*(?:,|;|&|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bwith\b|\/)\s*/i).map(norm).filter(Boolean);
// how well does the candidate's artist (or channel) fit the wanted one: 0..1
function artistFit(want, cand, candTitle) {
  const w = artistNames(want), c = artistNames(String(cand || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, ''));
  if (!w.length) return 0.5; // nothing to compare against
  if (w.some((x) => c.includes(x))) return 1;
  const cw = norm(cand), tt = norm(candTitle);
  if (w.some((x) => x.length > 2 && (cw.includes(x) || x.includes(cw) && cw.length > 3))) return 0.85;
  if (w.some((x) => x.length > 2 && tt.includes(x))) return 0.8; // "Artist - Song" uploaded by a channel with another name
  return 0;
}
// 0..1 for the two lengths (milliseconds); null when one is unknown
function durationFit(a, b) {
  if (!(a > 0) || !(b > 0)) return null;
  const d = Math.abs(a - b) / 1000;
  return d <= 3 ? 1 : d <= 6 ? 0.85 : d <= 12 ? 0.6 : d <= 25 ? 0.3 : 0;
}
// want: { artist, title, ms }   cand: { artist, title, ms }   ->  { score, why }
function score(want, cand) {
  const wt = coreTitle(want.title), ct = coreTitle(cand.title);
  // the candidate may carry the artist inside its title ("Artist - Song"): compare the title both ways
  const ctAlt = (() => { const p = String(cand.title || '').split(/\s+[-–—]\s+/); return p.length >= 2 ? coreTitle(p.slice(1).join(' - ')) : ''; })();
  let t = 0;
  for (const c of [ct, ctAlt].filter(Boolean)) {
    let s = 0;
    if (c === wt) s = 1;
    else if (wt && c && (c.includes(wt) || wt.includes(c)) && Math.min(c.length, wt.length) >= 4) s = 0.7 * Math.min(c.length, wt.length) / Math.max(c.length, wt.length) + 0.25;
    else s = 0.9 * dice(toks(String(want.title).replace(/\s*[([{][^)\]}]*[)\]}]/g, (m) => (NOISE.test(m) ? '' : m))), toks(String(cand.title).replace(/\s*[([{][^)\]}]*[)\]}]/g, (m) => (NOISE.test(m) ? '' : m))));
    t = Math.max(t, s);
  }
  const a = artistFit(want.artist, cand.artist, cand.title);
  const d = durationFit(want.ms, cand.ms);
  let s = d === null ? 0.58 * t + 0.42 * a : 0.5 * t + 0.28 * a + 0.22 * d;
  const why = [];
  // the title must really be the song: a wrong title never passes whatever the artist
  if (t < 0.5) s = Math.min(s, 0.45);
  // a live/remix/cover/karaoke version when the wanted song is not one
  const wv = versionsOf(want.title), cv = versionsOf(cand.title);
  for (const v of cv) if (!wv.has(v)) { s -= v === 'remastered' || v === 'edit' ? 0.04 : 0.18; why.push(v + ' version'); }
  for (const v of wv) if (!cv.has(v)) { s -= 0.1; why.push('not the ' + v + ' version'); }
  if (d === 0) why.push('different length');
  else if (d !== null && d <= 0.3) why.push('length is off');
  if (a === 0 && want.artist) why.push('different artist');
  return { score: Math.max(0, Math.min(1, s)), why };
}
// Choose the best of the candidates. { best, score, level, why, tried }
function pick(want, cands, { sure = 0.74, maybe = 0.52 } = {}) {
  let best = null, bs = -1, bwhy = [];
  for (const c of cands || []) {
    const r = score(want, c);
    // on a tie the earlier result (the search engine's own favourite) wins
    if (r.score > bs + 0.001) { best = c; bs = r.score; bwhy = r.why; }
  }
  if (!best) return { best: null, score: 0, level: 'none', why: [] };
  return { best, score: bs, level: bs >= sure ? 'sure' : bs >= maybe ? 'maybe' : 'none', why: bwhy };
}
// search lines to try one after the other, from the most exact to the loosest
function queries({ artist, title }) {
  const a = String(artist || '').trim(), t = String(title || '').trim();
  const plain = t.replace(/\s*[([{][^)\]}]*[)\]}]/g, (m) => (NOISE.test(m) ? '' : m)).replace(/\s+(feat\.?|ft\.?)\s+.*$/i, '').replace(/\s+[-–—]\s+(remaster.*|\d{4}.*)$/i, '').trim();
  const first = a.split(/\s*(?:,|;|&| x | feat\.? | ft\.? )\s*/i)[0].trim();
  const out = [`${a} ${t}`.trim(), `${a} ${plain}`.trim(), `${first} ${plain}`.trim(), plain].filter(Boolean);
  return [...new Set(out)];
}
// a "3:45" / "1:02:03" length to milliseconds
const lengthToMs = (s) => { const p = String(s || '').split(':').map(Number); return p.length > 1 && p.every(Number.isFinite) ? p.reduce((n, x) => n * 60 + x, 0) * 1000 : 0; };

module.exports = { score, pick, queries, norm, coreTitle, lengthToMs };
