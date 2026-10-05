import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';
const { Storyboard } = load(['00-util.js', '10b-storyboard.js']);
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

const OSB = `[Events]
//Background and Video events
//Storyboard Layer 0 (Background)
Sprite,Background,Centre,"sb/bg.jpg",320,240
 F,0,1000,2000,0,1,0
 M,0,1000,2000,100,100,200,200
 MX,0,3000,4000,0,50
Sprite,Fail,Centre,"sb/fail.png",0,0
 F,0,0,1000,1
Sprite,Foreground,TopLeft,"$dir/star.png",0,0
 L,10000,3
  F,0,0,100,0,1
  S,0,100,200,1,2
Animation,Overlay,Centre,"sb/anim.png",320,240,4,50,LoopForever
 C,0,0,500,255,0,0,0,0,255
 P,0,0,,A

[Variables]
$dir=sb/x
`;

test('storyboards: sprites, layers, variables, chained values, loops and animation frames', () => {
  const files = Storyboard.files([OSB]);
  assert.ok(files.has('sb/bg.jpg') && files.has('sb/x/star.png') && files.has('sb/anim0.png') && files.has('sb/anim3.png'));
  assert.ok(!files.has('sb/anim4.png'));
  const s = Storyboard.parse([OSB]);
  assert.equal(s.length, 3, 'the Fail layer is left out');
  const [bg, star, anim] = s;
  // F 0→1 over 1000–2000, then 1→0 over 2000–3000 (osu!'s chained shorthand)
  same(bg.by.F.map(c => [c.s, c.e, c.a[0], c.b[0]]), [[1000, 2000, 0, 1], [2000, 3000, 1, 0]]);
  assert.equal(Storyboard.value(bg.by.F, 1500)[0], 0.5);
  assert.equal(Storyboard.value(bg.by.F, 500)[0], 0, 'before the first: its start value');
  // M feeds both X and Y; MX only X
  assert.equal(Storyboard.value(bg.by.X, 1500)[0], 150);
  assert.equal(Storyboard.value(bg.by.X, 3500)[0], 25);
  assert.equal(Storyboard.value(bg.by.Y, 3500)[0], 200);
  assert.equal(bg.start, 1000); assert.equal(bg.end, 4000);
  // the loop: 3 passes of a 200ms body from 10000
  assert.equal(star.file, 'sb/x/star.png');
  same(star.by.F.map(c => c.s), [10000, 10200, 10400]);
  assert.equal(star.start, 10000); assert.equal(star.end, 10600);
  assert.equal(anim.anim.frames, 4);
  same(anim.by.C.map(c => [c.a, c.b]), [[[255, 0, 0], [0, 0, 255]]]);
  assert.equal(anim.by.P[0].a, 'A');
});
