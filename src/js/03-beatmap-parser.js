/* BeatmapParser — independent .osu parser + Mania note conversion + difficulty calculation. */

const BeatmapParser = {
  /** Parse .osu text into a structured object. Throws BeatmapError on unusable input. */
  parse(text) {
    text = text.replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);
    const first = lines.find(l => l.trim());
    const vm = first ? /osu file format v(\d+)/i.exec(first) : null;
    const bm = {
      formatVersion: vm ? +vm[1] : 14,
      general: {}, editor: {}, metadata: {}, difficulty: {},
      events: { background: null, video: null, breaks: [], storyboard: false },
      timingPoints: [], hitObjects: [], colours: {},
    };
    if (!vm && !/\[HitObjects\]/i.test(text)) throw new BeatmapError('Invalid .osu file (missing header and [HitObjects])');
    let section = '';
    for (let raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('//')) continue;
      if (line[0] === '[' && line.endsWith(']')) { section = line.slice(1, -1).toLowerCase(); continue; }
      switch (section) {
        case 'general': case 'editor': case 'metadata': case 'difficulty': case 'colours': {
          const i = line.indexOf(':');
          if (i < 0) break;
          const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
          bm[section][k] = v;
          break;
        }
        case 'events': this._event(bm, raw); break;
        case 'timingpoints': {
          const p = line.split(',');
          if (p.length < 2) break;
          const time = parseFloat(p[0]), beatLength = parseFloat(p[1]);
          if (!isFinite(time) || !isFinite(beatLength)) break;
          bm.timingPoints.push({
            time, beatLength,
            meter: p[2] ? parseInt(p[2], 10) || 4 : 4,
            sampleSet: p[3] ? parseInt(p[3], 10) || 0 : 0,
            sampleIndex: p[4] ? parseInt(p[4], 10) || 0 : 0,
            volume: p[5] ? parseInt(p[5], 10) : 100,
            // like osu!: a negative beat length is always an SV (green) line, whatever the flag says
            uninherited: beatLength > 0 && (p[6] === undefined || p[6].trim() !== '0'),
            effects: p[7] ? parseInt(p[7], 10) || 0 : 0,
          });
          break;
        }
        case 'hitobjects': {
          const p = line.split(',');
          if (p.length < 4) break;
          const x = parseFloat(p[0]), y = parseFloat(p[1]), time = parseInt(p[2], 10), type = parseInt(p[3], 10);
          if (!isFinite(x) || !isFinite(time) || !isFinite(type)) break;
          const ho = { x, y, time, type, hitSound: parseInt(p[4], 10) || 0, endTime: 0, sample: null, raw: p };
          if (type & 128) {
            // Mania hold: endTime:hitSample
            const ex = (p[5] || '').split(':');
            ho.endTime = parseInt(ex[0], 10) || time;
            ho.sample = ex.slice(1);
          } else if (type & 8) {
            ho.endTime = parseInt(p[5], 10) || time;
            ho.sample = (p[6] || '').split(':');
          } else if (type & 2) {
            ho.slider = { slides: parseInt(p[6], 10) || 1, length: parseFloat(p[7]) || 0 };
            ho.sample = (p[10] || '').split(':');
          } else {
            ho.sample = (p[5] || '').split(':');
          }
          bm.hitObjects.push(ho);
          break;
        }
      }
    }
    // numeric conveniences
    const g = bm.general, d = bm.difficulty;
    bm.mode = parseInt(g.Mode || '0', 10);
    bm.audioFile = g.AudioFilename ? normPath(g.AudioFilename) : '';
    bm.previewTime = parseInt(g.PreviewTime ?? '-1', 10);
    bm.audioLeadIn = parseInt(g.AudioLeadIn || '0', 10) || 0;
    bm.sampleSetName = (g.SampleSet || 'Normal').toLowerCase();
    bm.od = parseFloat(d.OverallDifficulty ?? '5');
    bm.hp = parseFloat(d.HPDrainRate ?? '5');
    bm.cs = parseFloat(d.CircleSize ?? '4');
    bm.sliderMultiplier = parseFloat(d.SliderMultiplier ?? '1.4');
    bm.timingPoints.sort((a, b) => a.time - b.time || (b.uninherited - a.uninherited));
    bm.hitObjects.sort((a, b) => a.time - b.time);
    return bm;
  },

  _event(bm, raw) {
    const line = raw.trim();
    if (raw.startsWith(' ') || raw.startsWith('_')) { bm.events.storyboard = true; return; }
    const p = line.split(',');
    const type = p[0].trim();
    const file = s => s ? normPath(s.trim().replace(/^"|"$/g, '')) : null;
    if (type === '0' && p.length >= 3) bm.events.background = { file: file(p[2]), x: +p[3] || 0, y: +p[4] || 0 };
    else if ((type === '1' || type === 'Video') && p.length >= 3) bm.events.video = { file: file(p[2]), offset: +p[1] || 0 };
    else if ((type === '2' || type === 'Break') && p.length >= 3) bm.events.breaks.push({ start: +p[1], end: +p[2] });
    else if (/^(Sprite|Animation|Sample|3|4|5|6)$/.test(type)) bm.events.storyboard = true;
  },

  /** Key count for a mania map (CircleSize). */
  keyCount(bm) { return clamp(Math.round(bm.cs), 1, 18); },

  /** Convert parsed beatmap to mania notes. Returns [{col, time, end, isLN, hs, sample}] sorted by time. */
  toManiaNotes(bm) {
    if (bm.mode !== 3) throw new BeatmapError(`Not a mania beatmap (mode ${bm.mode}); only osu!mania difficulties are playable`);
    const keys = this.keyCount(bm);
    const notes = [];
    for (const ho of bm.hitObjects) {
      const col = clamp(Math.floor(ho.x * keys / 512), 0, keys - 1);
      const isLN = !!(ho.type & 128) && ho.endTime > ho.time;
      notes.push({ col, time: ho.time, end: isLN ? ho.endTime : ho.time, isLN, hs: ho.hitSound, sample: ho.sample || [] });
    }
    notes.sort((a, b) => a.time - b.time || a.col - b.col);
    // Drop exact duplicates in the same column (broken maps), and trim overlapping LNs.
    const lastEnd = new Array(keys).fill(-Infinity);
    const out = [];
    for (const n of notes) {
      if (n.time <= lastEnd[n.col]) continue;
      lastEnd[n.col] = n.isLN ? n.end : n.time;
      out.push(n);
    }
    return out;
  },

  /** Build timing helpers: uninherited (BPM) and effective scroll velocity per time. */
  timing(bm) {
    const tps = bm.timingPoints;
    const red = tps.filter(t => t.uninherited && t.beatLength > 0);
    if (!red.length) red.push({ time: 0, beatLength: 500, meter: 4, uninherited: true, sampleSet: 0, sampleIndex: 0, volume: 100 });
    // dominant BPM = the beat length that lasts longest (time-weighted)
    const lastTime = bm.hitObjects.length ? Math.max(...bm.hitObjects.slice(-50).map(h => Math.max(h.time, h.endTime))) : red[red.length - 1].time;
    const dur = new Map();
    for (let i = 0; i < red.length; i++) {
      const start = i === 0 ? Math.min(red[0].time, 0) : red[i].time;
      const end = i + 1 < red.length ? red[i + 1].time : Math.max(lastTime, red[i].time);
      const bl = Math.round(red[i].beatLength * 1000) / 1000;
      dur.set(bl, (dur.get(bl) || 0) + Math.max(0, end - start));
    }
    let dominant = red[0].beatLength, best = -1;
    for (const [bl, d] of dur) if (d > best) { best = d; dominant = bl; }
    const bpms = red.map(r => 60000 / r.beatLength);
    return {
      red, dominantBeatLength: dominant,
      bpm: 60000 / dominant, bpmMin: Math.min(...bpms), bpmMax: Math.max(...bpms),
    };
  },

  /** Scroll segments: [{time, pos, vel}] where pos is integrated scroll distance (ms-equivalent at 1x). */
  scrollSegments(bm, { useSV = true, useBPM = true } = {}) {
    const tps = bm.timingPoints;
    const { dominantBeatLength } = this.timing(bm);
    const segs = [];
    let curBeat = dominantBeatLength, curSV = 1;
    const changes = [];
    for (const tp of tps) {
      if (tp.uninherited) { curBeat = tp.beatLength; curSV = 1; }
      else curSV = tp.beatLength < 0 ? clamp(-100 / tp.beatLength, 0.01, 10) : 1;
      let vel = 1;
      if (useSV) vel *= curSV;
      if (useBPM) vel *= dominantBeatLength / curBeat;
      vel = clamp(vel, 0, 20);
      if (changes.length && changes[changes.length - 1].time === tp.time) changes[changes.length - 1].vel = vel;
      else changes.push({ time: tp.time, vel });
    }
    if (!changes.length || changes[0].time > -1e7) changes.unshift({ time: -1e7, vel: changes.length ? changes[0].vel : 1 });
    let pos = 0;
    for (let i = 0; i < changes.length; i++) {
      if (i > 0) pos += (changes[i].time - changes[i - 1].time) * changes[i - 1].vel;
      segs.push({ time: changes[i].time, pos, vel: changes[i].vel });
    }
    return segs;
  },

  /** Barline times (every measure of every uninherited section, omitting "omit first barline" effect). */
  barlines(bm, endTime) {
    const red = this.timing(bm).red;
    const out = [];
    for (let i = 0; i < red.length; i++) {
      const tp = red[i];
      const until = i + 1 < red.length ? red[i + 1].time : endTime + 1;
      const step = tp.beatLength * (tp.meter || 4);
      if (step < 50) continue;
      for (let k = (tp.effects & 8) ? 1 : 0; k < 100000; k++) {
        const t = tp.time + k * step;
        if (t >= until - 1) break;
        out.push(t);
      }
    }
    return out;
  },

  /** Compute summary stats + star rating for library display. */
  analyse(bm) {
    const notes = this.toManiaNotes(bm);
    const keys = this.keyCount(bm);
    const t = this.timing(bm);
    const first = notes.length ? notes[0].time : 0;
    const last = notes.length ? Math.max(...notes.slice(-keys * 4).map(n => n.end)) : 0;
    const lns = notes.filter(n => n.isLN).length;
    return {
      keys, noteCount: notes.length - lns, lnCount: lns, objectCount: notes.length,
      lnRatio: notes.length ? lns / notes.length : 0,
      firstNote: first, lastNote: last, length: last,
      drainLength: Math.max(0, last - first - bm.events.breaks.reduce((a, b) => a + (b.end - b.start), 0)),
      bpm: t.bpm, bpmMin: t.bpmMin, bpmMax: t.bpmMax,
      nps: notes.length / Math.max(1, (last - first) / 1000),
      stars: DifficultyCalculator.calculate(notes, keys, 1),
    };
  },
};

class BeatmapError extends Error {}

/** DifficultyCalculator — star rating via the osu!lazer mania strain model (see 09a-osu-math.js). */
const SR_VERSION = 2;
const DifficultyCalculator = {
  calculate(notes, keys, rate = 1) { return Math.round(ManiaStarRating.calculate(notes, keys, rate) * 100) / 100; },
};

/** BeatmapValidator: explain what is wrong with a difficulty instead of crashing. */
function validateBeatmap(bm, availableFiles) {
  const problems = [], warnings = [];
  if (bm.mode !== 3) problems.push(`Not an osu!mania difficulty (mode ${bm.mode})`);
  if (!bm.hitObjects.length) problems.push('No hit objects');
  if (!bm.timingPoints.some(t => t.uninherited && t.beatLength > 0)) problems.push('Missing timing points');
  if (!bm.audioFile) problems.push('No audio file specified');
  else if (availableFiles && !availableFiles.has(bm.audioFile.toLowerCase())) problems.push(`Missing audio: ${bm.audioFile}`);
  if (bm.events.background && availableFiles && !availableFiles.has(bm.events.background.file.toLowerCase())) warnings.push(`Missing background: ${bm.events.background.file}`);
  return { problems, warnings };
}
