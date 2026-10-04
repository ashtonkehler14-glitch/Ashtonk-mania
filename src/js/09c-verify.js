/* Score verification: the game server's own judge of a play. It never takes a player's word for a score — given the
 * beatmap file (checked against its hash by the server) and the play's recorded key presses, it plays them through
 * the same judging engine the game uses, under the standard rules (the beatmap's own OD, the default accuracy), and
 * works out the score, accuracy, combo, grade, star rating and pp itself. The same file runs in the game and, bundled
 * by build.mjs, on the server (worker/verify-bundle.js). */

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
  const keys = BeatmapParser.keyCount(bm);
  if (!(keys >= 1 && keys <= 18)) return fail('not an osu!mania beatmap');
  const notes = BeatmapParser.toManiaNotes(bm);
  if (!notes.length) return fail('the beatmap has no notes');
  // mods: only real ones, and only ranked ones (no Auto, no Autopilot-like helpers)
  const mods = ModSystem.normalize(Array.isArray(play.mods) ? play.mods.map(String) : []);
  if (!ModSystem.isRanked(mods)) return fail('unranked mods');
  const cfg = play.modConfig && typeof play.modConfig === 'object' ? play.modConfig : {};
  const modConfig = {};
  for (const k of ['rate', 'od', 'hp', 'acc', 'cover', 'percy']) if (Number.isFinite(Number(cfg[k]))) modConfig[k] = Number(cfg[k]);
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
  const end = Math.max(...playNotes.map(n => n.end)) + 10000;
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
