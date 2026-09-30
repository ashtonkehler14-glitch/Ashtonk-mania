// Generates synthetic test fixtures: a multi-difficulty .osz (4K/7K/8K/9K + broken diff) and a
// Kori-style .osk (custom mania/ paths, per-key [Mania] sections, @2x assets, lighting frames).
import { writeFileSync, mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
const out = new URL('./fixtures/', import.meta.url);
mkdirSync(out, { recursive: true });

const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };

function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b, a] = fn(x, y); const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function wav(seconds, bpm, sr = 22050) {
  const n = Math.floor(seconds * sr), data = Buffer.alloc(n * 2);
  const beat = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / sr, ph = t % beat;
    let v = Math.sin(2 * Math.PI * 110 * t) * 0.08 + (ph < 0.03 ? Math.sin(2 * Math.PI * 1000 * ph) * Math.exp(-ph * 120) * 0.6 : 0);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), i * 2);
  }
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16);
  hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
  hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  return Buffer.concat([hdr, data]);
}
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, content, store] of files) {
    const data = Buffer.from(content); const comp = store ? data : zlib.deflateRawSync(data); const nm = Buffer.from(name);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(store ? 0 : 8, 8);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    parts.push(lh, nm, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(store ? 0 : 8, 10);
    ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, nm); off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ── beatmap set
const BPM = 150, beat = 400;
function osu(keys, version, gen, { audio = 'audio.wav', extraTP = '' } = {}) {
  const x = c => Math.floor((c + 0.5) * 512 / keys);
  const objs = gen(keys).map(o => o.end ? `${x(o.col)},192,${o.t},128,${o.hs || 0},${o.end}:0:0:0:0:` : `${x(o.col)},192,${o.t},1,${o.hs || 0},0:0:0:0:`);
  return `osu file format v14

[General]
AudioFilename: ${audio}
AudioLeadIn: 0
PreviewTime: 4000
Mode: 3
SampleSet: Soft

[Metadata]
Title:Ashtonk Test Anthem
TitleUnicode:Ashtonk Test Anthem
Artist:The Test Suite
ArtistUnicode:The Test Suite
Creator:Ashton
Version:${version}
Source:fixtures
Tags:neru test stream jack ln
BeatmapID:0
BeatmapSetID:-1

[Difficulty]
HPDrainRate:7
CircleSize:${keys}
OverallDifficulty:8
ApproachRate:5
SliderMultiplier:1.4
SliderTickRate:1

[Events]
0,0,"bg.png",0,0
2,9000,10000

[TimingPoints]
400,${beat},4,2,0,70,1,0
${extraTP}
[HitObjects]
${objs.join('\n')}
`;
}
const pattern = keys => {
  const o = []; let t = 1200;
  // single notes (stairs)
  for (let i = 0; i < keys * 2; i++) { o.push({ col: i % keys, t }); t += beat / 2; }
  // chords
  for (let i = 0; i < 4; i++) { o.push({ col: 0, t }, { col: keys - 1, t }); if (keys > 2) o.push({ col: Math.floor(keys / 2), t }); t += beat; }
  // jacks
  for (let i = 0; i < 4; i++) { o.push({ col: 1 % keys, t }); t += beat / 2; }
  // stream
  for (let i = 0; i < 16; i++) { o.push({ col: (i * 3) % keys, t, hs: i % 4 === 0 ? 4 : 0 }); t += beat / 4; }
  // long notes, overlapping
  o.push({ col: 0, t, end: t + beat * 2 }); o.push({ col: keys - 1, t: t + beat / 2, end: t + beat * 3 });
  if (keys > 2) o.push({ col: 1, t: t + beat, end: t + beat * 1.5 });
  t += beat * 4;
  // after break section
  t = Math.max(t, 10400);
  for (let i = 0; i < keys * 3; i++) { o.push({ col: (keys - 1 - (i % keys)), t }); t += beat / 2; }
  o.push({ col: 0, t, end: t + beat }); t += beat * 2;
  return o;
};
const bg = png(320, 180, (x, y) => [40 + x / 4, 20 + y / 3, 90 + x / 3, 255]);
const audio = wav(20, BPM);
const set = zip([
  ['Ashton - Test [4K Normal].osu', osu(4, '4K Normal', pattern)],
  ['Ashton - Test [7K Hard].osu', osu(7, '7K Hard', pattern, { extraTP: `6000,-50,4,2,0,70,0,0\n7000,${beat / 2},4,2,0,70,1,0\n8000,${beat},4,2,0,70,1,0\n` })],
  ['Ashton - Test [8K Insane].osu', osu(8, '8K Insane', pattern)],
  ['Ashton - Test [9K Expert].osu', osu(9, '9K Expert', pattern)],
  ['Ashton - Test [Broken].osu', osu(4, 'Broken', pattern, { audio: 'missing.mp3' })],
  ['audio.wav', audio], ['bg.png', bg], ['soft-hitfinish.wav', wav(0.2, 600)],
]);
writeFileSync(new URL('test-set.osz', out), set);
// a set that "exists online" (osu! ids 424242 / 4242420) for the explorer and multiplayer search tests
const online = (v, id) => osu(4, v, pattern).replace(/Title(Unicode)?:.*/g, m => m.split(':')[0] + ':Online Anthem').replace('BeatmapID:0', `BeatmapID:${id}`).replace('BeatmapSetID:-1', 'BeatmapSetID:424242');
writeFileSync(new URL('online-set.osz', out), zip([['Online [Easy].osu', online('Online Easy', 4242420)], ['Online [Hard].osu', online('Online Hard', 4242421)], ['audio.wav', wav(20, BPM)]]));
writeFileSync(new URL('corrupt.osz', out), Buffer.from('this is not a zip file at all'));
writeFileSync(new URL('standard.osz', out), zip([['std.osu', osu(4, 'Std', pattern).replace('Mode: 3', 'Mode: 0').replace(/Title:.*/g, 'Title:Standard Only')], ['audio.wav', wav(1, 120)]]));

// ── Kori-style skin (stand-in: same structure/conventions, generated art)
const purple = [170, 110, 255, 255], black = [8, 6, 12, 255];
const rect = (w, h, fill, border = null, bw = 3) => png(w, h, (x, y) => (border && (x < bw || y < bw || x >= w - bw || y >= h - bw)) ? border : fill);
const skinIni = `[General]
Name: Kori 3.0 (test stand-in)
Author: Fixture Generator
Version: 2.7

[Colours]
Combo1: 170,110,255

[Fonts]
ScorePrefix: score
ComboPrefix: score

${[4, 7].map(k => `[Mania]
Keys: ${k}
ColumnStart: 200
ColumnWidth: ${Array(k).fill(k === 4 ? 60 : 44).join(',')}
ColumnLineWidth: ${Array(k + 1).fill(0).join(',')}
ColumnSpacing: ${Array(k - 1).fill(2).join(',')}
HitPosition: 395
ScorePosition: 240
ComboPosition: 150
JudgementLine: 0
LightFramePerSecond: 30
ColourLight${k}: 190,130,255
StageHint: mania/hint
StageLeft: mania/basic_sb
StageRight: mania/basic_sb
LightingN: mania/lightingN
LightingL: mania/lightingL
Hit300g: mania/300g
Hit0: mania/miss
${Array.from({ length: k }, (_, i) => `KeyImage${i}: mania/key
KeyImage${i}D: mania/keyD
NoteImage${i}: mania/${i % 3}
NoteImage${i}H: mania/H
NoteImage${i}L: mania/L
NoteImage${i}T: mania/T`).join('\n')}
`).join('\n')}`;
const skinFiles = [
  ['skin.ini', skinIni],
  ['mania/key.png', rect(64, 90, black, purple)], ['mania/key@2x.png', rect(128, 180, black, purple, 6)],
  ['mania/keyD.png', rect(64, 90, purple)], ['mania/keyD@2x.png', rect(128, 180, purple)],
  ['mania/0.png', rect(64, 24, [240, 230, 255, 255], black)], ['mania/1.png', rect(64, 24, purple, black)], ['mania/2.png', rect(64, 24, [120, 60, 220, 255], black)],
  ['mania/H.png', rect(64, 24, [255, 214, 90, 255], black)], ['mania/T.png', rect(64, 12, [255, 214, 90, 255], black)],
  ['mania/L.png', rect(64, 32, [170, 110, 255, 140])],
  ['mania/hint.png', rect(128, 8, [255, 255, 255, 200])], ['mania/basic_sb.png', rect(6, 64, purple)],
  ['mania/lightingN-0.png', rect(96, 96, [255, 255, 255, 220])], ['mania/lightingN-1.png', rect(96, 96, [255, 255, 255, 140])], ['mania/lightingN-2.png', rect(96, 96, [255, 255, 255, 60])],
  ['mania/lightingL.png', rect(96, 96, [255, 255, 255, 180])],
  ['mania/300g.png', rect(160, 40, [255, 230, 120, 255])], ['mania/miss.png', rect(120, 40, [255, 60, 80, 255])],
  ...Array.from({ length: 10 }, (_, d) => [`score-${d}.png`, rect(24, 34, [255, 255, 255, 255], purple)]),
  ['normal-hitnormal.wav', wav(0.08, 600)], ['combobreak.wav', wav(0.3, 200)],
];
writeFileSync(new URL('Kori-test.osk', out), zip(skinFiles.map(([n, c], i) => [n, c, i % 2 === 0])));

// A Web-Osu-Mania backup (Settings → Backup & Restore): the online set as a stored beatmap, settings, a high score
// on its Hard difficulty, and a collection holding it.
{
  const { readFileSync } = await import('node:fs');
  const womSettings = { state: { version: 1, volume: 0.6, musicVolume: 0.5, sfxVolume: 0.3, scrollSpeed: 27, backgroundDim: 0.9, backgroundBlur: 0.2, audioOffset: 12, upscroll: true, show300g: false,
    keybinds: { keyModes: [[['Space', null]], [['KeyF', null], ['KeyJ', null]], [['KeyF', null], ['Space', null], ['KeyJ', null]], [['KeyA', 'KeyZ'], ['KeyS', null], ['KeyK', null], ['KeyL', null]]], pause: 'Escape', retry: 'Backquote', toggleHud: null } }, version: 0 };
  const womScores = { state: { highScores: { 424242: { 4242421: [{ timestamp: 1700000000000, mods: ['Double Time', 'Mirror'], replayId: 'r1', results: { score: 912345, accuracy: 0.9712, maxCombo: 321, 320: 300, 300: 40, 200: 5, 100: 2, 50: 1, 0: 3 } }] }, 999: { 9990: [{ timestamp: 1, mods: [], replayId: 'r2', results: { score: 1, accuracy: 1, maxCombo: 1, 320: 1, 300: 0, 200: 0, 100: 0, 50: 0, 0: 0 } }] } } }, version: 1 };
  const womCollections = { 'WOM favourites': [{ id: 424242, title: 'Online', artist: 'Test' }, { id: 999, title: 'Missing', artist: 'Nobody' }] };
  writeFileSync(new URL('wom-backup.zip', out), zip([
    ['settings.json', JSON.stringify(womSettings)], ['highScores.json', JSON.stringify(womScores)], ['collections.json', JSON.stringify(womCollections)],
    ['beatmapFiles/424242 Test - Online.osz', readFileSync(new URL('online-set.osz', out)), false], ['replayFiles/r1.womr', Buffer.from('x')],
  ]));
}
console.log('fixtures written');
