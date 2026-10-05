import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const L = load(['00-util.js', '17c-editor.js']), { EditorScreen } = L;
L.__ctx.Toast = { show() {} };

const OSU = `osu file format v14

[General]
AudioFilename: audio.mp3
Mode: 3

[Metadata]
Title:Old
Artist:Someone
Version:Hard

[Difficulty]
HPDrainRate:7
CircleSize:4
OverallDifficulty:8

[TimingPoints]
0,500,4,1,0,100,1,0

[HitObjects]
64,192,1000,1,0,0:0:0:0:
`;

test('editor: an .osu section is replaced in place, and key:value lines are set or added', () => {
  let t = EditorScreen.setKeys(OSU, 'Metadata', { Title: 'New title', Creator: 'Ash' });
  assert.match(t, /\[Metadata\]\nTitle:New title\nArtist:Someone\nVersion:Hard\nCreator:Ash\n\n\[Difficulty\]/);
  t = EditorScreen.setSection(t, 'HitObjects', ['1,192,2,1,0,0:0:0:0:', '3,192,4,128,0,9:0:0:0:0:']);
  assert.match(t, /\[HitObjects\]\n1,192,2,1,0,0:0:0:0:\n3,192,4,128,0,9:0:0:0:0:\n$/);
  t = EditorScreen.setSection(t, 'TimingPoints', ['100,400,4,1,0,100,1,0']);
  assert.match(t, /\[TimingPoints\]\n100,400,4,1,0,100,1,0\n\n\[HitObjects\]/);
  assert.match(EditorScreen.setSection('x', 'Events', ['a']), /^x\n\n\[Events\]\na\n$/, 'a missing section is added at the end');
  assert.match(EditorScreen.setKeys(t, 'Difficulty', { CircleSize: 7 }), /CircleSize:7/);
});

/** An editor state without the screen (the checks and kiai only need the notes, timing and details). */
function state(over = {}) {
  const E = Object.create(EditorScreen);
  Object.assign(E, { keys: 4, duration: 60000, divisor: 4, preview: 1000, bookmarks: [], rec: { bgFile: 'bg.jpg' },
    meta: { Title: 'T', Artist: 'A', Creator: 'C', Tags: 'x', Version: 'N' },
    red: [{ time: 0, beatLength: 500, meter: 4, uninherited: true, effects: 0 }], green: [],
    notes: [{ t: 0, col: 0, end: null }, { t: 40000, col: 1, end: null }] }, over);
  return E;
}

test('editor verify: a clean beatmap has no issues, and each check finds its problem', () => {
  assert.equal(state().issues().length, 0, JSON.stringify(state().issues()));
  const msgs = E => E.issues().map(i => `${i.sev}:${i.cat}`);
  assert.ok(msgs(state({ notes: [] })).includes('problem:Compose'), 'no notes');
  assert.ok(state({ notes: [{ t: 0, col: 0, end: 1000 }, { t: 500, col: 0, end: null }, { t: 40000, col: 1, end: null }] }).issues().some(i => /inside a hold note/.test(i.text)));
  const un = state({ notes: [{ t: 0, col: 0, end: null }, { t: 40013, col: 1, end: null }] }).issues();
  assert.ok(un.some(i => i.sev === 'problem' && /unsnapped by/.test(i.text) && i.t === 40013), 'unsnapped');
  assert.ok(state({ notes: [{ t: 0, col: 0, end: null }, { t: 10000, col: 1, end: null }] }).issues().some(i => /drain time/.test(i.text)));
  assert.ok(state({ rec: {} }).issues().some(i => /background/.test(i.text)));
  assert.ok(state({ preview: -1 }).issues().some(i => i.sev === 'warning' && /preview/.test(i.text)));
  assert.ok(state({ meta: { Title: 'Ünïcode', Artist: 'A', Creator: 'C', Tags: 'x' } }).issues().some(i => /romanised title/.test(i.text)));
  assert.ok(state({ notes: [{ t: 0, col: 0, end: null }, { t: 61000, col: 1, end: null }] }).issues().some(i => /after the song ends/.test(i.text)));
});

test('editor kiai: toggling adds effect points that start and stop it, keeping the scroll speed', () => {
  const E = state({ green: [{ time: 1000, beatLength: -50, meter: 4, uninherited: false, effects: 0 }] });
  E.setDirty = () => {};
  E.toggleKiai(2000); E.toggleKiai(4000);
  assert.equal(JSON.stringify(E.kiaiRanges()), '[[2000,4000]]');
  assert.equal(E.green.find(g => g.time === 2000).beatLength, -50, 'keeps the green line\'s speed');
  assert.ok(E.kiaiAt(3000) && !E.kiaiAt(5000));
  E.toggleKiai(2000);
  assert.equal(E.kiaiRanges().length, 0, 'a point there changes instead of adding another');
});

test('editor: bookmarks and the preview point are written into the .osu', () => {
  const E = state({ text: OSU, bookmarks: [500, 1500], preview: 2500, diffSet: { hp: 5, od: 5 } });
  const t = E.serialize();
  assert.match(t, /PreviewTime:2500/);
  assert.match(t, /\[Editor\]\nBookmarks:500,1500\n\n\[Metadata\]/, '[Editor] goes before [Metadata]');
});
