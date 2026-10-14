// The install worker (see ImportWorkers in src/js/07a-import-workers.js): the game's own parser, checks and star rating
// in a background thread. build.mjs puts src/js 00, 03, 03b, 08 and 09a before this and the whole into the page.
self.onmessage = e => {
  const { id, text, available } = e.data;
  try { postMessage({ id, ok: true, info: inspectBeatmap(BeatmapParser.parse(text), available) }); }
  catch (err) { postMessage({ id, ok: false, error: String((err && err.message) || err), beatmapError: err instanceof BeatmapError }); }
};
