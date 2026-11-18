// node tools/test-matcher.js : checks the song matching used when copying playlists
const assert = require('assert');
const m = require('../app/matcher');
const S = (a, t, s) => ({ artist: a, title: t, ms: s * 1000 });
let n = 0; const ok = (name, f) => { f(); n++; console.log('ok', name); };
const lvl = (want, cands) => m.pick(want, cands);
ok('official audio beats live version', () => {
  const r = lvl(S('Daft Punk', 'One More Time', 320), [S('Daft Punk', 'One More Time (Live at Coachella)', 410), S('Daft Punk - Topic', 'One More Time', 320), S('SomeFan', 'One More Time cover', 300)]);
  assert.strictEqual(r.best.artist, 'Daft Punk - Topic'); assert.strictEqual(r.level, 'sure');
});
ok('artist in the video title', () => {
  const r = lvl(S('Radiohead', 'Creep', 238), [S('Radiohead', 'Creep (Official Video)', 239)]);
  assert.strictEqual(r.level, 'sure');
});
ok('uploader channel differs, title holds artist', () => {
  const r = lvl(S('Fleetwood Mac', 'Dreams', 257), [S('Music Vault', 'Fleetwood Mac - Dreams (Official Audio)', 258)]);
  assert.strictEqual(r.level, 'sure');
});
ok('karaoke rejected when the real one exists', () => {
  const r = lvl(S('Queen', 'Bohemian Rhapsody', 355), [S('Sing King', 'Bohemian Rhapsody (Karaoke Version)', 355), S('Queen Official', 'Queen - Bohemian Rhapsody (Official Video Remastered)', 359)]);
  assert.strictEqual(r.best.artist, 'Queen Official');
});
ok('remix wanted -> remix chosen', () => {
  const r = lvl(S('Fred again..', 'Delilah (pull me out of this) - Extended Mix', 400), [S('Fred again..', 'Delilah (pull me out of this)', 230), S('Fred again..', 'Delilah (pull me out of this) (Extended Mix)', 401)]);
  assert.strictEqual(r.best.ms, 401000);
});
ok('wrong song, same artist -> none', () => {
  const r = lvl(S('Radiohead', 'Creep', 238), [S('Radiohead', 'Karma Police', 264), S('Radiohead', 'Paranoid Android', 387)]);
  assert.strictEqual(r.level, 'none');
});
ok('remaster suffix on Spotify title', () => {
  const r = lvl(S('The Beatles', 'Here Comes The Sun - Remastered 2009', 185), [S('The Beatles', 'Here Comes The Sun - 2019 Mix', 186), S('The Beatles', 'Here Comes The Sun', 185)]);
  assert.strictEqual(r.level, 'sure');
});
ok('accents and symbols', () => {
  const r = lvl(S('Beyoncé', 'Halo', 261), [S('Beyonce', 'Halo', 261)]);
  assert.strictEqual(r.level, 'sure');
});
ok('multi artist', () => {
  const r = lvl(S('Calvin Harris, Rihanna', 'This Is What You Came For', 222), [S('Calvin Harris', 'This Is What You Came For (Official Video) ft. Rihanna', 223)]);
  assert.strictEqual(r.level, 'sure');
});
ok('right title, no length, other artist -> maybe at best', () => {
  const r = lvl(S('Nirvana', 'Lithium', 257), [S('Random Guy', 'Lithium', 0)]);
  assert.notStrictEqual(r.level, 'sure');
});
ok('queries fall back', () => {
  const q = m.queries({ artist: 'Calvin Harris, Rihanna', title: 'This Is What You Came For (feat. Rihanna) - Remastered 2015' });
  assert(q.length >= 3 && q.includes('This Is What You Came For'), q.join('|'));
});
ok('length parse', () => { assert.strictEqual(m.lengthToMs('3:45'), 225000); assert.strictEqual(m.lengthToMs('1:02:03'), 3723000); });
console.log(n + ' checks passed');
