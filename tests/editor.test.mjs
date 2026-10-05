import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { EditorScreen } = load(['00-util.js', '17c-editor.js']);

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
