/* Plays on the game server. A play goes up as the game reports it (acceptPlay): its score, accuracy, combo, grade,
 * star rating and pp taken as they are, with the beatmap's details from its file (the file's hash is the beatmap's id).
 * verifyPlay is the judge for a play sent the old way, as its key presses only: played through the same judging
 * engine the game uses, under the standard rules (the beatmap's own OD, the default accuracy). The same file runs in
 * the game and, bundled by build.mjs, on the server (worker/verify-bundle.js). */

/** Mods that change the notes themselves (No Long Notes, Invert): their star rating is the changed notes'. */
const convertsNotes = mods => mods.includes('NLN') || mods.includes('IN');

const VERIFY = {
  MAX_EVENTS: 600000,      // numbers in a replay (t, col, down per key event)
  MIN_HOLD: 5,             // ms a key is held at the least (a press and release closer than that isn't a finger)
  MAX_RATE: 2, MIN_RATE: 0.5,
  BOT_UR: 15, BOT_NOTES: 100, // an unstable rate below this over at least this many hits is a script, not a person
};

/** Judge a play. `osuText`: the beatmap file; `play`: { mods, modConfig, seed, events }. Returns the result, or
 *  { error } when the play can't count (not a pass, unranked mods, impossible input). `noFail`: a multiplayer play,
 *  which plays on after health runs out (as the game does there) — it comes back `failed`, an F worth 0pp. */
function verifyPlay(osuText, play, { noFail = false } = {}) {
  const fail = error => ({ error });
  if (typeof osuText !== 'string' || !play || typeof play !== 'object') return fail('bad play');
  let bm;
  try { bm = BeatmapParser.parse(osuText); } catch (e) { return fail('the beatmap could not be read'); }
  // mods: only real ones, and only ranked ones (no Auto, no Autopilot-like helpers)
  const mods = ModSystem.normalize(Array.isArray(play.mods) ? play.mods.map(String) : []);
  // (a key mod converts an osu! map to that many columns)
  const keyMod = bm.mode === 0 ? ModSystem.keyMod(mods) : 0;
  let keys, notes;
  try { keys = BeatmapParser.keyCount(bm, keyMod); notes = BeatmapParser.toManiaNotes(bm, keyMod); } catch (e) { return fail('not a playable beatmap'); }
  if (!(keys >= 1 && keys <= 18)) return fail('not an osu!mania beatmap');
  if (!notes.length) return fail('the beatmap has no notes');
  const cfg = play.modConfig && typeof play.modConfig === 'object' ? play.modConfig : {};
  const modConfig = {};
  for (const k of ['rate', 'od', 'hp', 'acc', 'cover', 'percy', 'flSize', 'coDir']) if (Number.isFinite(Number(cfg[k]))) modConfig[k] = Number(cfg[k]);
  if (!ModSystem.isRanked(mods, modConfig)) return fail('unranked mods');
  const rate = ModSystem.rate(mods, modConfig);
  if (!(rate >= VERIFY.MIN_RATE && rate <= VERIFY.MAX_RATE)) return fail('speed out of range');
  const seed = Number.isFinite(Number(play.seed)) ? Number(play.seed) | 0 : 0;
  // input: [t, col, down] triples, in time order, each column alternating press / release
  const ev = play.events;
  if (!Array.isArray(ev) || ev.length % 3 || ev.length > VERIFY.MAX_EVENTS) return fail('bad input');
  const down = new Array(keys).fill(-1);
  let last = -Infinity;
  for (let i = 0; i < ev.length; i += 3) {
    const t = ev[i], col = ev[i + 1], d = ev[i + 2];
    if (!Number.isFinite(t) || !Number.isInteger(col) || col < 0 || col >= keys || (d !== 0 && d !== 1)) return fail('bad input');
    if (t < last - 0.001) return fail('input out of order');
    last = t;
    if (d === 1) { if (down[col] >= 0) return fail('impossible input'); down[col] = t; }
    else { if (down[col] < 0) return fail('impossible input'); if ((t - down[col]) / rate < VERIFY.MIN_HOLD) return fail('impossible input'); down[col] = -1; }
  }
  // the play itself, judged as the game judges it — standard windows for the beatmap and mods
  const red = BeatmapParser.timing(bm).red;
  const playNotes = prepareNotes(notes, keys, mods, seed, { red });
  const windows = timingWindows({ od: bm.od, mods, odOverride: modConfig.od, rules: RULES });
  const engine = new GameplayEngine({ notes: playNotes, keys, windows, rate, mods, hp: bm.hp, accuracyMode: 'v2', noFail,
    breaks: mods.includes('IN') ? [] : bm.events.breaks, modConfig, rules: RULES });
  for (let i = 0; i < ev.length; i += 3) {
    engine.advance(ev[i]);
    engine.input(ev[i + 1], ev[i + 2] === 1, ev[i]);
  }
  const end = maxOf(playNotes, n => n.end) + 10000;
  engine.advance(end);
  // (multiplayer: health running out marks the play failed, though it played on)
  const failed = noFail ? engine.health.min <= 0 : engine.health.failed && !mods.includes('NF');
  if (failed && !noFail) return fail('the play failed');
  const sum = engine.summary();
  // a script pressing every key at exactly the right moment: no person hits a hundred notes that evenly
  const judged = sum.counts.slice(0, 5).reduce((a, b) => a + b, 0);
  if (judged >= VERIFY.BOT_NOTES && sum.unstableRate < VERIFY.BOT_UR) return fail('inhuman timing');
  const starNotes = convertsNotes(mods) ? playNotes : notes;
  const stars = DifficultyCalculator.calculate(starNotes, keys, rate);
  const pp = failed ? 0 : OsuMath.pp(stars, sum.counts, mods);
  const grade = ScoreSystem.gradeFor(sum.accuracy, failed, mods, sum.counts);
  return {
    score: Math.round(sum.scoreStd != null ? sum.scoreStd : sum.score), accuracy: sum.accuracy, maxCombo: sum.maxCombo, counts: sum.counts,
    grade, stars, pp, mods, keys, rate, unstableRate: sum.unstableRate, failed,
    beatmapSetId: Number(bm.metadata && bm.metadata.BeatmapSetID) || -1,
    beatmapId: Number(bm.metadata && bm.metadata.BeatmapID) || -1, title: (bm.metadata && bm.metadata.Title) || '', artist: (bm.metadata && bm.metadata.Artist) || '', version: (bm.metadata && bm.metadata.Version) || '',
  };
}

/** A beatmap file's [Metadata] section ({ Title, Artist, Version, BeatmapID, BeatmapSetID, … }) without reading the
 *  rest of the file — or null without one. */
function osuMetadata(text) {
  const at = text.search(/^\[Metadata\][ \t]*\r?$/m);
  if (at < 0) return null;
  const end = text.indexOf('\n[', at + 10), md = {};
  for (const line of text.slice(at, end < 0 ? undefined : end).split(/\r?\n/).slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) md[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return md;
}
/** A play as the game reports it (`res`: its result), taken as it is: tidied into the shape verifyPlay gives, with the
 *  beatmap's details from its file. Auto's plays aren't anyone's, and a fail only counts in multiplayer (`noFail`),
 *  as an F worth 0pp. */
function acceptPlay(osuText, res, { noFail = false } = {}) {
  if (typeof osuText !== 'string' || !res || typeof res !== 'object') return { error: 'bad play' };
  // (its details are all a play taken as it is needs from the file: read from its [Metadata] alone — every note of a long
  // map read through took longer than the server is given for a few plays at once)
  let bm = { metadata: osuMetadata(osuText) };
  if (!bm.metadata) try { bm = BeatmapParser.parse(osuText); } catch (e) { return { error: 'the beatmap could not be read' }; }
  const num = (v, lo, hi, d = 0) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const mods = ModSystem.normalize(Array.isArray(res.mods) ? res.mods.map(String) : []);
  if (mods.includes('AT')) return { error: 'Auto\'s play' };
  const failed = !!res.failed;
  if (failed && !noFail) return { error: 'the play failed' };
  const counts = Array.from({ length: 6 }, (_, i) => Math.round(num(Array.isArray(res.counts) ? res.counts[i] : 0, 0, 1e6)));
  const grade = failed ? 'F' : ['XH', 'X', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D'].includes(res.grade) ? res.grade : 'D';
  const md = bm.metadata || {};
  return {
    score: Math.round(num(res.score, 0, 1e9)), accuracy: num(res.accuracy, 0, 1), maxCombo: Math.round(num(res.maxCombo, 0, 1e6)), counts,
    grade, stars: num(res.stars, 0, 100), pp: failed || !ModSystem.isRanked(mods) ? 0 : num(res.pp, 0, 1e5), mods,
    keys: Math.round(num(res.keys, 1, 18, 4)), rate: num(res.rate, VERIFY.MIN_RATE, VERIFY.MAX_RATE, 1), unstableRate: num(res.unstableRate, 0, 1e4), failed,
    beatmapSetId: Number(md.BeatmapSetID) || -1, beatmapId: Number(md.BeatmapID) || -1, title: md.Title || '', artist: md.Artist || '', version: md.Version || '',
  };
}
