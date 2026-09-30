/* SettingsManager — schema-driven settings. The schema drives both defaults and the Settings UI,
 * so every visible control maps to a real stored value that some system reads. */

const DEFAULT_KEYBINDS = {
  1: [['Space']],
  2: [['KeyF'], ['KeyJ']],
  3: [['KeyF'], ['Space'], ['KeyJ']],
  4: [['KeyD'], ['KeyF'], ['KeyJ'], ['KeyK']],
  5: [['KeyD'], ['KeyF'], ['Space'], ['KeyJ'], ['KeyK']],
  6: [['KeyS'], ['KeyD'], ['KeyF'], ['KeyJ'], ['KeyK'], ['KeyL']],
  7: [['KeyS'], ['KeyD'], ['KeyF'], ['Space'], ['KeyJ'], ['KeyK'], ['KeyL']],
  8: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  9: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['Space'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  10: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyV'], ['KeyN'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  // 11K–18K: Web-Osu-Mania's defaults (MIT © 2024 Danny Duong)
  11: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyV'], ['Space'], ['KeyN'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  12: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyC'], ['KeyV'], ['KeyN'], ['KeyM'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  13: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyC'], ['KeyV'], ['Space'], ['KeyN'], ['KeyM'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  14: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyX'], ['KeyC'], ['KeyV'], ['KeyN'], ['KeyM'], ['Comma'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  15: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyX'], ['KeyC'], ['KeyV'], ['Space'], ['KeyN'], ['KeyM'], ['Comma'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  16: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyZ'], ['KeyX'], ['KeyC'], ['KeyV'], ['KeyN'], ['KeyM'], ['Comma'], ['Period'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  17: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyZ'], ['KeyX'], ['KeyC'], ['KeyV'], ['Space'], ['KeyN'], ['KeyM'], ['Comma'], ['Period'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
  18: [['KeyA'], ['KeyS'], ['KeyD'], ['KeyF'], ['KeyG'], ['KeyZ'], ['KeyX'], ['KeyC'], ['KeyV'], ['KeyN'], ['KeyM'], ['Comma'], ['Period'], ['KeyH'], ['KeyJ'], ['KeyK'], ['KeyL'], ['Semicolon']],
};
const MAX_KEYS = 18;

function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
  if (code.startsWith('Pad')) return '🎮' + code.slice(3);
  return ({
    Space: 'Space', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl',
    ControlRight: 'RCtrl', AltLeft: 'LAlt', AltRight: 'RAlt', CapsLock: 'Caps', Tab: 'Tab', Enter: 'Enter', ArrowLeft: '←',
    ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', MetaLeft: 'LMeta', MetaRight: 'RMeta', IntlBackslash: '\\',
  })[code] || code;
}

/** [section, key, label, type, default, options] */
const SETTINGS_SCHEMA = [
  // ── Gameplay
  { s: 'Gameplay', g: 'Scrolling', k: 'gameplay.scrollSpeed', l: 'Scroll speed', t: 'range', d: 22, min: 1, max: 40, step: 1,
    fmt: v => `${v} (${Math.round(11485 / v)}ms)`, hint: 'How long notes are visible before reaching the receptors.' },
  { s: 'Gameplay', g: 'Scrolling', k: 'gameplay.scrollDirection', l: 'Scroll direction', t: 'select', d: 'down', o: [['down', 'Down'], ['up', 'Up']] },
  { s: 'Gameplay', g: 'Scrolling', k: 'gameplay.scrollMode', l: 'Scroll speed changes', t: 'select', d: 'sv', o: [['sv', 'SV + BPM'], ['svonly', 'SV only'], ['constant', 'Constant']], hint: 'SV + BPM is how osu!mania scrolls.' },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.laneWidth', l: 'Lane width', t: 'range', d: 1, min: 0.5, max: 2, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.hitPositionOffset', l: 'Receptor position', t: 'range', d: 0, min: -120, max: 60, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}`, hint: 'Moves the judgement line relative to the skin\'s HitPosition.' },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.stagePosition', l: 'Stage position', t: 'select', d: 'center', o: [['center', 'Centered'], ['skin', 'Skin (ColumnStart)'], ['left', 'Left'], ['right', 'Right']] },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.laneSpacing', l: 'Lane spacing', t: 'range', d: 0, min: 0, max: 20, step: 1, fmt: v => `${v}` },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.stageOffset', l: 'Stage horizontal offset', t: 'range', d: 0, min: -40, max: 40, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}%` },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.stageOpacity', l: 'Stage background opacity', t: 'range', d: 1, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.noteOffset', l: 'Visual note offset', t: 'range', d: 0, min: -40, max: 40, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}`, hint: 'Shifts where notes are drawn relative to the receptors (visual only).' },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.showBackground', l: 'Show beatmap background', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.bgDim', l: 'Background dim', t: 'range', d: 0.5, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.lightenBreaks', l: 'Lighten background during breaks', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.video', l: 'Background video', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.videoImport', l: 'Store videos when importing (.mp4 / .webm)', t: 'bool', d: true, hint: 'Videos can be large; turn off to save storage.' },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.bgBlur', l: 'Background blur', t: 'range', d: 0.5, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.hitLighting', l: 'Hit lighting', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.comboEffects', l: 'Combo effects', t: 'bool', d: true, hint: 'Combo pulse and milestone flashes.' },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.showJudgements', l: 'Show judgements', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.showMax', l: 'Show MAX (300g) judgements', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.earlyLate', l: 'Early / late indicator', t: 'range', d: 0, min: 0, max: 100, step: 5, fmt: v => v ? `≥ ${v}ms` : 'Off', hint: 'Shows EARLY or LATE under non-MAX judgements beyond this error.' },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.progressDisplay', l: 'Song progress', t: 'select', d: 'pie', o: [['pie', 'Pie chart'], ['bar', 'Bar'], ['both', 'Pie + bar'], ['none', 'Hidden']] },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.showPp', l: 'Live pp counter', t: 'bool', d: true },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.leaderboard', l: 'In-game leaderboard', t: 'bool', d: true, desc: 'Local scores on the left while you play (osu!lazer-style). Tab shows or hides it.' },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.showHealth', l: 'Health bar', t: 'bool', d: true },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.scoring', l: 'Score display', t: 'select', d: 'classic', o: [['classic', 'Classic (ScoreV1)'], ['standardised', 'osu!lazer standardised']], hint: 'Classic is osu!stable\'s ScoreV1 for mania. Standardised is osu!lazer\'s: 150,000 for combo and 850,000 for accuracy, so accuracy counts most. Every play records both, and leaderboards and personal bests follow this choice (scores from before it existed keep their classic score). Multiplayer matches always use classic.' },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.healthStyle', l: 'Health bar style', t: 'select', d: 'skin', o: [['skin', 'From the skin'], ['skinstage', 'Skin, beside stage'], ['lazer', 'osu!lazer'], ['stage', 'Slim, beside stage']], hint: 'The skin\'s own health bar (its scorebar images) in the top-left corner like osu!lazer, or standing beside the stage like osu!stable mania. Skins without one use the osu!lazer bar.' },
  { s: 'Gameplay', g: 'Judgement', k: 'gameplay.judgementMode', l: 'Timing windows', t: 'select', d: 'od', o: [['od', 'Beatmap OD'], ['custom', 'Custom OD'], ['ms', 'Custom (ms)']] },
  { s: 'Gameplay', g: 'Judgement', k: 'gameplay.customOD', l: 'Custom OD', t: 'range', d: 8, min: 0, max: 10, step: 0.1, fmt: v => v.toFixed(1), when: () => Settings.get('gameplay.judgementMode') === 'custom' },
  { s: 'Gameplay', g: 'Judgement', k: 'gameplay.windowsMs', l: 'Windows (ms): Marv / Perf / Great / Good / Bad / Miss', t: 'text', d: '16,40,73,103,127,164', when: () => Settings.get('gameplay.judgementMode') === 'ms' },
  { s: 'Gameplay', g: 'Judgement', k: 'gameplay.accuracyMode', l: 'Accuracy', t: 'select', d: 'v2', o: [['v2', 'Weighted'], ['v1', 'Classic']], hint: 'Weighted counts MAX slightly above 300 (osu!lazer); Classic counts them the same.' },
  { s: 'Gameplay', g: 'Flow', k: 'gameplay.unpauseDelay', l: 'Unpause countdown', t: 'range', d: 1200, min: 0, max: 3000, step: 100, fmt: v => v ? `${(v / 1000).toFixed(1)}s` : 'Instant' },
  { s: 'Gameplay', g: 'Flow', k: 'gameplay.breakMin', l: 'Minimum break length', t: 'range', d: 10000, min: 10000, max: 30000, step: 1000, fmt: v => `${(v / 1000).toFixed(1)}s` },
  { s: 'Gameplay', g: 'Flow', k: 'gameplay.retryOnFail', l: 'Retry automatically on fail', t: 'bool', d: false },
  { s: 'Gameplay', g: 'Judgement', k: 'gameplay.leadIn', l: 'Minimum lead-in', t: 'range', d: 1500, min: 500, max: 5000, step: 100, fmt: v => `${(v / 1000).toFixed(1)}s` },
  // ── Audio
  { s: 'Audio', g: 'Volume', k: 'audio.master', l: 'Master', t: 'range', d: 0.8, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Audio', g: 'Volume', k: 'audio.music', l: 'Music', t: 'range', d: 0.8, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Audio', g: 'Volume', k: 'audio.effects', l: 'Effects', t: 'range', d: 0.7, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Audio', g: 'Volume', k: 'audio.ui', l: 'Interface sounds', t: 'range', d: 0.6, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Audio', g: 'Offset', k: 'audio.offset', l: 'Audio offset', t: 'range', d: 0, min: -300, max: 300, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}ms`, hint: 'Positive if you hit late (notes will arrive later).', calibrate: true },
  { s: 'Audio', g: 'Playback', k: 'audio.preservePitch', l: 'Preserve pitch for DT / HT / practice speed', t: 'bool', d: true },
  { s: 'Audio', g: 'Playback', k: 'audio.previewAudio', l: 'Song select preview', t: 'bool', d: true },
  { s: 'Audio', g: 'Playback', k: 'audio.uiSounds', l: 'Interface sounds', t: 'bool', d: true },
  // ── Graphics
  { s: 'Graphics', g: 'Renderer', k: 'graphics.fpsLimit', l: 'Frame limiter', t: 'select', d: 0, o: [[0, 'VSync / Unlimited'], [60, '60 fps'], [120, '120 fps'], [144, '144 fps'], [165, '165 fps'], [240, '240 fps'], [360, '360 fps']], num: true },
  { s: 'Graphics', g: 'Renderer', k: 'graphics.showFps', l: 'Show FPS counter', t: 'bool', d: false },
  { s: 'Graphics', g: 'Renderer', k: 'graphics.renderScale', l: 'Rendering scale', t: 'range', d: 1, min: 0.5, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Graphics', g: 'Effects', k: 'graphics.performanceMode', l: 'Performance mode', t: 'bool', d: false, hint: 'Turns off particles, hit lighting, stage light and UI blur for low-end devices.' },
  { s: 'Graphics', g: 'Effects', k: 'graphics.particles', l: 'Particles', t: 'bool', d: true },
  { s: 'Graphics', g: 'Effects', k: 'graphics.effects', l: 'Interface blur & glow', t: 'bool', d: true },
  { s: 'Graphics', g: 'Effects', k: 'graphics.bgQuality', l: 'Background quality', t: 'select', d: 'high', o: [['high', 'Full resolution'], ['low', 'Thumbnail (fast)']] },
  { s: 'Graphics', g: 'Effects', k: 'graphics.menuBlur', l: 'Menu background blur', t: 'range', d: 12, min: 0, max: 40, step: 1, fmt: v => `${v}px` },
  // ── Input
  { s: 'Input', g: 'Keys', k: 'input.keybinds', l: 'Key configuration', t: 'keybinds', d: DEFAULT_KEYBINDS },
  { s: 'Input', g: 'Keys', k: 'input.shortcuts', l: 'Keyboard shortcuts', t: 'shortcuts', hint: 'Or press ? anywhere outside a text field.' },
  { s: 'Input', g: 'Display', k: 'input.keyOverlay', l: 'Input display (key counter)', t: 'bool', d: false },
  { s: 'Input', g: 'Latency', k: 'input.latency', l: 'Input latency compensation', t: 'range', d: 0, min: -50, max: 50, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}ms`, hint: 'Shifts only your key presses (not the audio or notes).' },
  { s: 'Input', g: 'Display', k: 'input.fullscreenOnPlay', l: 'Enter fullscreen when playing', t: 'bool', d: false },
  // ── Interface
  { s: 'Interface', g: 'Layout', k: 'ui.scale', l: 'UI scale', t: 'range', d: 1, min: 0.75, max: 1.5, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Interface', g: 'Style', k: 'ui.theme', l: 'Accent colour', t: 'select', d: 'kori', o: [['kori', 'Kori purple'], ['neru', 'Neru yellow'], ['teto', 'Teto red'], ['miku', 'Miku teal']] },
  { s: 'Interface', g: 'Style', k: 'ui.animSpeed', l: 'Animation speed', t: 'range', d: 1, min: 0, max: 2, step: 0.1, fmt: v => v === 0 ? 'Off' : `${v.toFixed(1)}×` },
  { s: 'Interface', g: 'Style', k: 'ui.parallax', l: 'Background parallax', t: 'bool', d: true },
  { s: 'Interface', g: 'Style', k: 'ui.mascot', l: 'Show Neru on the main menu', t: 'bool', d: true },
  { s: 'Interface', g: 'Style', k: 'ui.mascotImage', l: 'Main menu character image', t: 'mascot', hint: 'Any picture (PNG with a transparent background looks best).' },
  { s: 'Interface', g: 'Layout', k: 'ui.unicodeMetadata', l: 'Show song metadata in its original language', t: 'bool', d: false },
  // ── Skin
  { s: 'Skin', g: 'Skin', k: 'skin.current', l: 'Current skin', t: 'skin', d: 'default' },
  { s: 'Skin', g: 'Skin', k: 'skin.scale', l: 'Skin element scale (judgements & combo)', t: 'range', d: 1, min: 0.5, max: 1.5, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Skin', g: 'Skin', k: 'skin.dim', l: 'Stage dim', t: 'range', d: 0, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%`, hint: 'Darkens the skin\'s stage & column graphics.' },
  { s: 'Skin', g: 'Skin', k: 'skin.effects', l: 'Stage light on key press', t: 'bool', d: true },
  { s: 'Skin', g: 'Built-in skin', k: 'skin.noteStyle', l: 'Note style (Custom skin)', t: 'select', d: 'bars', o: [['bars', 'Bars'], ['circles', 'Circles'], ['diamonds', 'Diamonds'], ['arrows', 'Arrows']] },
  { s: 'Skin', g: 'Built-in skin', k: 'skin.hue', l: 'Note colour (Custom skin)', t: 'range', d: -1, min: -1, max: 360, step: 1, fmt: v => v < 0 ? 'Accent colour' : `hue ${v}` },
  { s: 'Skin', g: 'Built-in skin', k: 'skin.darkerHolds', l: 'Darker hold notes', t: 'bool', d: true },
  { s: 'Skin', g: 'Skin', k: 'skin.hd', l: 'High resolution (@2x) assets', t: 'select', d: 'auto', o: [['auto', 'Automatic'], ['always', 'Always'], ['never', 'Never']] },
  // ── Data / maintenance
  // beatmap sources, as in Web-Osu-Mania's "Sources" settings
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.downloadSource', l: 'Download source', t: 'select', d: 'auto', o: [['auto', 'Automatic'], ['mino', 'Mino'], ['nerinyan', 'NeriNyan'], ['sayobot', 'SayoBot'], ['osudirect', 'osu.direct'], ['nekoha', 'Nekoha'], ['custom', 'Custom…']], hint: 'Where beatmaps are downloaded from. The chosen one is tried first, then the others.' },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.customDownload', l: 'Custom download URL', t: 'text', d: '', hint: 'Put $setId where the beatmap set number goes, e.g. https://api.nerinyan.moe/d/$setId', when: () => Settings.get('online.downloadSource') === 'custom' },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.proxyDownloads', l: 'Download through this site\'s server', t: 'bool', d: true, hint: 'Downloads go through the game\'s own server, which tries every mirror for you. Turn it off to download straight from the mirror.' },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.previewSource', l: 'Audio preview source', t: 'select', d: 'official', o: [['official', 'Official osu!'], ['beatconnect', 'Beatconnect'], ['sayobot', 'SayoBot'], ['custom', 'Custom…']] },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.customPreview', l: 'Custom preview URL', t: 'text', d: '', hint: 'e.g. https://b.ppy.sh/preview/$setId.mp3', when: () => Settings.get('online.previewSource') === 'custom' },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.coverSource', l: 'Cover image source', t: 'select', d: 'official', o: [['official', 'Official osu!'], ['sayobot', 'SayoBot'], ['custom', 'Custom…']] },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.customCover', l: 'Custom cover URL', t: 'text', d: '', hint: 'e.g. https://assets.ppy.sh/beatmaps/$setId/covers/cover.jpg', when: () => Settings.get('online.coverSource') === 'custom' },
  { s: 'Maintenance', g: 'Replays', k: 'replays.autosave', l: 'Automatically save replays', t: 'select', d: 'pb', o: [['pb', 'Personal bests'], ['all', 'All passes'], ['off', 'Never']] },
  { s: 'Maintenance', g: 'Data', k: 'data', l: 'Data management', t: 'data' },
  // hidden (not in UI)
  { k: 'debug.overlay', d: false }, { k: 'ui.allSettings', d: false }, { k: 'songselect.sort', d: 'title' }, { k: 'songselect.group', d: 'none' },
  { k: 'songselect.keys', d: [] }, { k: 'songselect.filter', d: 'all' }, { k: 'songselect.mods', d: [] }, { k: 'songselect.collection', d: '' },
  { k: 'last.map', d: null }, { k: 'practice.speed', d: 1 },
  { k: 'mods.config', d: { acc: 0.9, od: 8, hp: 8, rate: 1.2, cover: 0.5, percy: 150 } },
];

const Settings = {
  values: {},
  schema: new Map(SETTINGS_SCHEMA.map(s => [s.k, s])),
  PERF_OFF: new Set(['graphics.particles', 'gameplay.hitLighting', 'skin.effects', 'graphics.effects', 'gameplay.comboEffects', 'audio.uiSounds']),
  _saveT: 0,
  async load() {
    const stored = await DB.kvGet('settings', {});
    this.values = stored && typeof stored === 'object' ? stored : {};
    // v2: osu!lazer look — the old purple default becomes the pink lazer default.
    if (!this.values['ui.v2']) { if (this.values['ui.theme'] === 'kori') delete this.values['ui.theme']; this.values['ui.v2'] = true; }
    // v3: background blur is a percentage (was px); breaks are 10s or longer
    const v = this.values;
    if (v['gameplay.bgBlur'] > 1) v['gameplay.bgBlur'] = Math.min(1, v['gameplay.bgBlur'] / 30);
    if (v['gameplay.breakMin'] < 10000) delete v['gameplay.breakMin'];
    // v4: the accent colours are Kori, Neru, Teto and Miku only
    if (v['ui.theme'] && !['kori', 'neru', 'teto', 'miku'].includes(v['ui.theme'])) delete v['ui.theme'];
    this.applyUI();
  },
  get(k) {
    if (this.values['graphics.performanceMode'] && Settings.PERF_OFF.has(k)) return false;
    if (k in this.values) return this.values[k];
    const s = this.schema.get(k);
    return s ? (typeof s.d === 'object' && s.d !== null ? structuredClone(s.d) : s.d) : undefined;
  },
  async set(k, v) {
    this.values[k] = v;
    Bus.emit('settings:changed', k, v);
    if (k.startsWith('audio.')) AudioManager.applyVolumes();
    if (k.startsWith('ui.') || k.startsWith('graphics.')) this.applyUI();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => DB.kvSet('settings', this.values).catch(e => console.error(e)), 250);
  },
  async flush() { clearTimeout(this._saveT); await DB.kvSet('settings', this.values); },
  reset(k) { delete this.values[k]; Bus.emit('settings:changed', k, this.get(k)); this.set(k, this.get(k)); },
  export() { return structuredClone(this.values); },
  async import(obj) { if (obj && typeof obj === 'object') { this.values = { ...obj }; await this.flush(); this.applyUI(); AudioManager.applyVolumes(); Bus.emit('settings:changed', '*'); } },

  keybinds(keys) {
    const all = this.get('input.keybinds') || {};
    const kb = all[keys] || DEFAULT_KEYBINDS[keys] || [];
    const out = [];
    for (let i = 0; i < keys; i++) out.push((kb[i] && kb[i].length) ? [...kb[i]] : [...(DEFAULT_KEYBINDS[keys]?.[i] || [])]);
    return out;
  },
  setKeybinds(keys, binds) {
    const all = { ...(this.get('input.keybinds') || {}) };
    all[keys] = binds; this.set('input.keybinds', all);
  },

  applyUI() {
    const r = document.documentElement;
    r.style.setProperty('--ui-scale', this.get('ui.scale'));
    const sp = this.get('ui.animSpeed');
    r.style.setProperty('--anim', sp <= 0 ? 0 : (1 / sp));
    r.dataset.theme = this.get('ui.theme');
    r.classList.toggle('no-effects', !this.get('graphics.effects'));
    r.classList.toggle('no-anim', sp <= 0);
  },
};
