/** A phone or tablet (no mouse): some defaults differ there. */
const TOUCH_DEVICE = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;

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
/** Which skin's own options the Skin section shows. */
function customSkinOn() { const c = Settings.get('skin.current'); return !c || c === 'default'; }
function womSkinOn() { return customSkinOn(); }

const SETTINGS_SCHEMA = [
  // ── Gameplay
  { s: 'Gameplay', g: 'Scrolling', k: 'gameplay.scrollSpeed', l: 'Scroll speed', t: 'range', d: 22, min: 1, max: 40, step: 1,
    fmt: v => `${v} (${Math.round(11485 / v)}ms)`, hint: 'How long notes are visible before reaching the receptors.' },
  { s: 'Gameplay', g: 'Scrolling', k: 'gameplay.scrollDirection', l: 'Scrolling direction', t: 'select', d: 'down', o: [['down', 'Down'], ['up', 'Up']] },
  { s: 'Gameplay', g: 'Scrolling', k: 'gameplay.scrollMode', l: 'Scroll speed changes', t: 'select', d: 'sv', o: [['sv', 'SV + BPM'], ['svonly', 'SV only'], ['constant', 'Constant']], hint: 'SV + BPM is how osu!mania scrolls.' },
  { s: 'Gameplay', g: 'Playfield', k: 'gameplay.laneWidth', l: 'Lane width', t: 'range', d: 1, min: 0.5, max: 2, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'Gameplay', g: 'Playfield', k: 'gameplay.hitPositionOffset', l: 'Receptor position', t: 'range', d: 0, min: -120, max: 60, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}`, hint: 'Moves the judgement line relative to the skin\'s HitPosition.' },
  { x: 1, s: 'Gameplay', g: 'Playfield', k: 'gameplay.stagePosition', l: 'Stage position', t: 'select', d: 'center', o: [['center', 'Centered'], ['skin', 'Skin (ColumnStart)'], ['left', 'Left'], ['right', 'Right']] },
  { x: 1, s: 'Gameplay', g: 'Playfield', k: 'gameplay.laneSpacing', l: 'Lane spacing', t: 'range', d: 0, min: 0, max: 20, step: 1, fmt: v => `${v}px` },
  { x: 1, s: 'Gameplay', g: 'Playfield', k: 'gameplay.stageOffset', l: 'Stage horizontal offset', t: 'range', d: 0, min: -40, max: 40, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}%` },
  { x: 1, s: 'Gameplay', g: 'Playfield', k: 'gameplay.stageOpacity', l: 'Stage background opacity', t: 'range', d: 1, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'Gameplay', g: 'Playfield', k: 'gameplay.noteOffset', l: 'Visual note offset', t: 'range', d: 0, min: -40, max: 40, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}px`, hint: 'Shifts where notes are drawn relative to the receptors (visual only).' },
  { x: 1, s: 'Gameplay', g: 'Background', k: 'gameplay.showBackground', l: 'Show beatmap background', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.bgDim', l: 'Background dim', t: 'range', d: 0.5, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.lightenBreaks', l: 'Lighten during breaks', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.video', l: 'Storyboard / video', t: 'bool', d: true },
  { x: 1, s: 'Gameplay', g: 'Background', k: 'gameplay.videoImport', l: 'Store videos when importing (.mp4 / .webm)', t: 'bool', d: true, hint: 'Videos can be large; turn off to save storage.' },
  { s: 'Gameplay', g: 'Background', k: 'gameplay.bgBlur', l: 'Background blur', t: 'range', d: 0.5, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.hitLighting', l: 'Hit lighting', t: 'bool', d: true },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.barLines', l: 'Bar lines', t: 'bool', d: true },
  { x: 1, s: 'Gameplay', g: 'Effects', k: 'gameplay.comboEffects', l: 'Combo effects', t: 'bool', d: true, hint: 'Combo pulse and milestone flashes.' },
  { s: 'Gameplay', g: 'Effects', k: 'gameplay.showJudgements', l: 'Show judgements', t: 'bool', d: true },
  { x: 1, s: 'Gameplay', g: 'Effects', k: 'gameplay.showMax', l: 'Show MAX (300g) judgements', t: 'bool', d: true },
  { x: 1, s: 'Gameplay', g: 'Effects', k: 'gameplay.earlyLate', l: 'Early / late indicator', t: 'range', d: 0, min: 0, max: 100, step: 5, fmt: v => v ? `≥ ${v}ms` : 'Off', hint: 'Shows EARLY or LATE under non-MAX judgements beyond this error.' },
  { x: 1, s: 'Gameplay', g: 'HUD', k: 'gameplay.progressDisplay', l: 'Song progress display', t: 'select', d: 'pie', o: [['pie', 'Pie chart'], ['bar', 'Bar'], ['both', 'Pie + bar'], ['none', 'Hidden']] },
  { x: 1, s: 'Gameplay', g: 'HUD', k: 'gameplay.showPp', l: 'Show performance points counter', t: 'bool', d: true },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.leaderboard', l: 'Always show gameplay leaderboard', t: 'bool', d: true, desc: 'Local scores on the left while you play (osu!lazer-style). Tab shows or hides it.' },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.showHealth', l: 'Show health display', t: 'bool', d: true },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.hitErrorMeter', l: 'Hit error meter', t: 'bool', d: true, hint: 'osu!lazer\'s bar at the bottom of the screen: how early or late each hit was, against the timing windows.' },
  { s: 'Gameplay', g: 'HUD', k: 'gameplay.judgementCounter', l: 'Show judgement counter', t: 'bool', d: false, hint: 'osu!lazer\'s judgement counter: how many of each judgement so far.' },
  { x: 1, s: 'Gameplay', g: 'HUD', k: 'gameplay.judgementCounterFlow', l: 'Judgement counter layout', t: 'select', d: 'vertical', o: [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], when: () => Settings.get('gameplay.judgementCounter') },
  { x: 1, s: 'Gameplay', g: 'HUD', k: 'gameplay.healthStyle', l: 'Health bar style', t: 'select', d: 'skinstage', o: [['skinstage', 'From the skin, beside the stage'], ['skin', 'From the skin, top left'], ['lazer', 'osu!lazer'], ['stage', 'Slim, beside stage']], hint: 'The skin\'s own health bar (its scorebar images) in the top-left corner like osu!lazer, or standing beside the stage like osu!stable mania. Skins without one use the osu!lazer bar.' },
  { x: 1, s: 'Gameplay', g: 'Judgement', k: 'gameplay.judgementMode', l: 'Timing windows', t: 'select', d: 'od', o: [['od', 'Beatmap OD'], ['custom', 'Custom OD'], ['ms', 'Custom (ms)']] },
  { x: 1, s: 'Gameplay', g: 'Judgement', k: 'gameplay.customOD', l: 'Custom OD', t: 'range', d: 8, min: 0, max: 10, step: 0.1, fmt: v => v.toFixed(1), when: () => Settings.get('gameplay.judgementMode') === 'custom' },
  { x: 1, s: 'Gameplay', g: 'Judgement', k: 'gameplay.windowsMs', l: 'Windows (ms): MAX / 300 / 200 / 100 / 50 / Miss', t: 'text', d: '16,40,73,103,127,164', when: () => Settings.get('gameplay.judgementMode') === 'ms' },
  { x: 1, s: 'Gameplay', g: 'Judgement', k: 'gameplay.accuracyMode', l: 'Accuracy', t: 'select', d: 'v2', o: [['v2', 'Weighted'], ['v1', 'Classic']], hint: 'Weighted counts MAX slightly above 300 (osu!lazer); Classic counts them the same.' },
  { x: 1, s: 'Gameplay', g: 'Flow', k: 'gameplay.unpauseDelay', l: 'Unpause countdown', t: 'range', d: 1200, min: 0, max: 3000, step: 100, fmt: v => v ? `${(v / 1000).toFixed(1)}s` : 'Instant' },
  { x: 1, s: 'Gameplay', g: 'Flow', k: 'gameplay.breakMin', l: 'Minimum break length', t: 'range', d: 10000, min: 10000, max: 30000, step: 1000, fmt: v => `${(v / 1000).toFixed(1)}s` },
  { x: 1, s: 'Gameplay', g: 'Flow', k: 'gameplay.retryOnFail', l: 'Automatically retry on fail', t: 'bool', d: false },
  { x: 1, s: 'Gameplay', g: 'Flow', k: 'gameplay.leadIn', l: 'Minimum lead-in', t: 'range', d: 2500, min: 500, max: 5000, step: 100, fmt: v => `${(v / 1000).toFixed(1)}s` },
  // ── Audio
  { s: 'Audio', g: 'Volume', k: 'audio.master', l: 'Master', t: 'range', d: 0.8, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Audio', g: 'Volume', k: 'audio.music', l: 'Music', t: 'range', d: 0.8, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Audio', g: 'Volume', k: 'audio.effects', l: 'Effect', t: 'range', d: 0.7, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'Audio', g: 'Volume', k: 'audio.ui', l: 'Interface sounds', t: 'range', d: 0.6, min: 0, max: 1, step: 0.01, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Audio', g: 'Offset', k: 'audio.offset', l: 'Audio offset', t: 'range', d: 0, min: -300, max: 300, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}ms`, hint: 'Positive if you hit late (notes will arrive later).', calibrate: true },
  { x: 1, s: 'Audio', g: 'Playback', k: 'audio.preservePitch', l: 'Preserve pitch for DT / HT / practice speed', t: 'bool', d: true },
  { x: 1, s: 'Audio', g: 'Playback', k: 'audio.previewAudio', l: 'Song select preview', t: 'bool', d: true },
  { x: 1, s: 'Audio', g: 'Playback', k: 'audio.uiSounds', l: 'Play interface sounds', t: 'bool', d: true },
  // ── Graphics
  { s: 'Graphics', g: 'Renderer', k: 'graphics.fpsLimit', l: 'Frame limiter', t: 'select', d: 0, o: [[0, 'VSync / Unlimited'], [60, '60 fps'], [120, '120 fps'], [144, '144 fps'], [165, '165 fps'], [240, '240 fps'], [360, '360 fps']], num: true },
  { x: 1, s: 'Graphics', g: 'Renderer', k: 'graphics.lowLatency', l: 'Low-latency playfield', t: 'bool', d: false, hint: 'Draws the playfield without waiting for the display\'s refresh. It can show a frame sooner, but the stage may tear, which makes notes look like they stutter. Applies from the next play.' },
  { s: 'Graphics', g: 'Renderer', k: 'graphics.showFps', l: 'Show FPS', t: 'bool', d: false, hint: 'Ctrl+F11 toggles it anywhere.' },
  { x: 1, s: 'Graphics', g: 'Renderer', k: 'graphics.autoScale', l: 'Automatic resolution', t: 'bool', d: true, hint: 'When a beatmap can\'t keep up (under ~45 fps), the playfield is drawn at a lower resolution until it can, and the device remembers it. After a smooth play it tries a little higher again.' },
  { x: 1, s: 'Graphics', g: 'Renderer', k: 'graphics.renderScale', l: 'Renderer scale', t: 'range', d: 1, min: 0.5, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { s: 'Graphics', g: 'Effects', k: 'graphics.performanceMode', l: 'Performance mode', t: 'bool', d: false, hint: 'Turns off particles, hit lighting, stage light and UI blur for low-end devices.' },
  { x: 1, s: 'Graphics', g: 'Effects', k: 'graphics.particles', l: 'Particles', t: 'bool', d: true },
  { x: 1, s: 'Graphics', g: 'Effects', k: 'graphics.effects', l: 'Interface blur & glow', t: 'bool', d: true },
  { x: 1, s: 'Graphics', g: 'Effects', k: 'graphics.bgQuality', l: 'Background quality', t: 'select', d: 'high', o: [['high', 'Full resolution'], ['low', 'Thumbnail (fast)']] },
  // ── Input
  { s: 'Input', g: 'Mouse', k: 'input.noWheelVolumeInGame', l: 'Disable mouse wheel adjusting volume during gameplay', t: 'bool', d: false },
  { s: 'Input', g: 'Keys', k: 'input.keybinds', l: 'Key binding configuration', t: 'keybinds', d: DEFAULT_KEYBINDS },
  { s: 'Input', g: 'Keys', k: 'input.shortcuts', l: 'Keyboard shortcuts', t: 'shortcuts', hint: 'Or press ? anywhere outside a text field.' },
  { s: 'Input', g: 'Display', k: 'input.keyOverlay', l: 'Always show key overlay', t: 'bool', d: false },
  { x: 1, s: 'Input', g: 'Latency', k: 'input.latency', l: 'Input latency compensation', t: 'range', d: 0, min: -50, max: 50, step: 1, fmt: v => `${v > 0 ? '+' : ''}${v}ms`, hint: 'Shifts only your key presses (not the audio or notes).' },
  { x: 1, s: 'Input', g: 'Display', k: 'input.fullscreenOnPlay', l: 'Fullscreen while playing (tap the game to go back)', t: 'bool', d: TOUCH_DEVICE },
  // ── Interface
  { s: 'Graphics', g: 'Layout', k: 'ui.scale', l: 'UI scaling', t: 'range', d: TOUCH_DEVICE ? 1.25 : 0.9, min: 0.75, max: 1.5, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'User Interface', g: 'Style', k: 'ui.animSpeed', l: 'Animation speed', t: 'range', d: 1, min: 0, max: 2, step: 0.1, fmt: v => v === 0 ? 'Off' : `${v.toFixed(1)}×` },
  { s: 'User Interface', g: 'General', k: 'ui.parallax', l: 'Parallax', t: 'bool', d: true },
  { s: 'User Interface', g: 'Main Menu', k: 'ui.mascot', l: 'Show Neru on the main menu', t: 'bool', d: true },
  { s: 'User Interface', g: 'Main Menu', k: 'ui.mascotImage', l: 'Main menu character image', t: 'mascot', hint: 'Any picture (PNG with a transparent background looks best).' },
  { s: 'User Interface', g: 'General', k: 'ui.unicodeMetadata', l: 'Prefer metadata in original language', t: 'bool', d: false },
  // ── Skin
  { s: 'Skin', g: 'Skin', k: 'skin.current', l: 'Current skin', t: 'skin', d: 'default' },
  { x: 1, s: 'Skin', g: 'Skin', k: 'skin.scale', l: 'Gameplay element size', t: 'range', d: 1, min: 0.5, max: 1.5, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'Skin', g: 'Skin', k: 'skin.dim', l: 'Stage dim', t: 'range', d: 0, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%`, hint: 'Darkens the skin\'s stage & column graphics.' },
  { x: 1, s: 'Skin', g: 'Skin', k: 'skin.extend4K', l: 'Play 4K skins at every key count', t: 'bool', d: true, hint: 'A skin made only for 4K lends its four columns to other key counts in mirrored patterns (7K plays as 1 2 1 2 4 3 4).' },
  { x: 1, s: 'User Interface', g: 'General', k: 'ui.lazerCursor', l: 'Use the osu!lazer cursor', t: 'bool', d: true },
  { s: 'User Interface', g: 'General', k: 'ui.cursorSize', l: 'Menu cursor size', t: 'range', d: 0.7, min: 0.5, max: 2, step: 0.05, fmt: v => `${v.toFixed(2)}x` },
  { x: 1, s: 'User Interface', g: 'General', k: 'ui.cursorRotate', l: 'Rotate cursor when dragging', t: 'bool', d: false },
  { x: 1, s: 'Skin', g: 'Skin', k: 'skin.effects', l: 'Column lighting on key press', t: 'bool', d: true },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.noteStyle', l: 'Note shape', t: 'select', d: 'bars', o: [['bars', 'Bars'], ['circles', 'Circles'], ['diamonds', 'Diamonds'], ['arrows', 'Arrows']], when: () => customSkinOn() },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.palette', l: 'Colours', t: 'select', d: 'theme', o: [['theme', 'Default'], ['ocean', 'Ocean'], ['sunset', 'Sunset'], ['neon', 'Neon'], ['mint', 'Mint'], ['mono', 'Monochrome'], ['custom', 'Custom hue']], when: () => customSkinOn() },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.hue', l: 'Custom hue', t: 'range', d: -1, min: -1, max: 360, step: 1, fmt: v => v < 0 ? 'Off' : `${v}°`, when: () => customSkinOn() && (Settings.get('skin.c.palette') === 'custom' || Settings.get('skin.hue') >= 0) },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.pattern', l: 'Colour pattern', t: 'select', d: 'type', o: [['type', 'osu! (by column type)'], ['rainbow', 'Rainbow'], ['single', 'One colour']] },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.noteSize', l: 'Note size', t: 'range', d: 1, min: 0.6, max: 1.4, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.round', l: 'Note roundness', t: 'range', d: 0.5, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.receptor', l: 'Receptors', t: 'select', d: 'outline', o: [['outline', 'Outline'], ['filled', 'Filled'], ['line', 'Hit line only']] },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.keyArea', l: 'Key area', t: 'select', d: 'gradient', o: [['gradient', 'Glow'], ['panel', 'Panel (lazer Argon)'], ['none', 'None']] },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.hold', l: 'Hold notes', t: 'select', d: 'glow', o: [['glow', 'Glowing beam'], ['solid', 'Solid']] },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.darkerHolds', l: 'Darker hold notes', t: 'bool', d: true },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.glow', l: 'Glow', t: 'range', d: 0.7, min: 0, max: 1, step: 0.05, fmt: v => `${Math.round(v * 100)}%` },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.lines', l: 'Column lines', t: 'bool', d: true },
  { x: 1, s: 'Skin', g: 'Custom skin', k: 'skin.c.border', l: 'Glowing stage border', t: 'bool', d: true },
  // the Custom skin (drawn as Web-Osu-Mania's skins): note type, colour, judgements, darker holds; the hidden ones come
  // over from a WOM backup
  { s: 'Skin', g: 'Custom skin', k: 'wom.style', l: 'Note type', t: 'select', d: 'bars', o: [['bars', 'Bars'], ['circles', 'Circles'], ['arrows', 'Arrows'], ['thickArrows', 'Thick Arrows'], ['diamonds', 'Diamonds']], when: () => customSkinOn() },
  { s: 'Skin', g: 'Custom skin', k: 'wom.hue', l: 'Colour', t: 'range', d: 212, min: 0, max: 360, step: 1, fmt: v => `${v}°`, hint: 'As Web-Osu-Mania: the inner columns take this colour, the outer ones stay white (and an odd middle one gets a contrasting colour).', when: () => womSkinOn() },
  { x: 1, s: 'Skin', k: 'wom.colorMode', d: 'simple' },
  { s: 'Skin', g: 'Custom skin', k: 'wom.judgements', l: 'Judgements', t: 'select', d: 'azureSnowfall', o: [['azureSnowfall', 'Azure Snowfall'], ['chocolate', '105°C Chocolate'], ['bangDream', 'BanG Dream!'], ['fnf', 'Friday Night Funkin\''], ['osuStable', 'osu!(stable)']], when: () => womSkinOn() },
  { s: 'Skin', g: 'Custom skin', k: 'wom.darkerHolds', l: 'Darker hold notes', t: 'bool', d: true, when: () => womSkinOn() },
  { x: 1, s: 'Skin', k: 'wom.customColors', d: null },
  { x: 1, s: 'Skin', k: 'wom.noteScale', d: 0.8 },
  { x: 1, s: 'Skin', k: 'wom.hitPositionOffset', d: 130 },
  { x: 1, s: 'Skin', k: 'wom.laneWidthAdjustment', d: 0 },
  { x: 1, s: 'Skin', k: 'wom.laneSpacing', d: 0 },
  { x: 1, s: 'Skin', k: 'wom.stagePosition', d: 0 },
  { x: 1, s: 'Skin', k: 'wom.stageOpacity', d: 0.5 },
  { x: 1, s: 'Skin', k: 'wom.stageSidesOpacity', d: 1 },
  { x: 1, s: 'Skin', k: 'wom.receptorOpacity', d: 1 },
  { x: 1, s: 'Skin', k: 'wom.receptorLighting', d: true },
  { x: 1, s: 'Skin', k: 'wom.hudY', d: 0.66 },
  { x: 1, s: 'Skin', k: 'wom.noteOffset', d: 0 },
  { x: 1, s: 'Skin', k: 'wom.earlyLate', d: 200 },
  { x: 1, s: 'Skin', g: 'Skin', k: 'skin.hd', l: 'Use high resolution (@2x) textures', t: 'select', d: 'auto', o: [['auto', 'Automatic'], ['always', 'Always'], ['never', 'Never']] },
  // ── Data / maintenance
  // beatmap sources, as in Web-Osu-Mania's "Sources" settings
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.downloadSource', l: 'Beatmap provider', t: 'select', d: 'mino', o: [['mino', 'Mino (catboy.best)'], ['nerinyan', 'NeriNyan'], ['sayobot', 'SayoBot'], ['osudirect', 'osu.direct'], ['nekoha', 'Nekoha'], ['custom', 'Custom…']], hint: 'Where beatmaps are downloaded from (Web-Osu-Mania\'s providers). If it fails, the others are tried.' },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.customDownload', l: 'Custom download URL', t: 'text', d: '', hint: 'Put $setId where the beatmap set number goes, e.g. https://api.nerinyan.moe/d/$setId', when: () => Settings.get('online.downloadSource') === 'custom' },
  { s: 'Maintenance', g: 'Beatmap sources', k: 'online.proxyDownloads', l: 'Proxy beatmap downloads', t: 'bool', d: false, hint: 'As Web-Osu-Mania: download through this site\'s server instead of straight from the provider. Turn it on if downloads are blocked where you are.' },
  { x: 1, s: 'Maintenance', g: 'Beatmap sources', k: 'online.previewSource', l: 'Audio preview source', t: 'select', d: 'official', o: [['official', 'Official osu!'], ['beatconnect', 'Beatconnect'], ['sayobot', 'SayoBot'], ['custom', 'Custom…']] },
  { x: 1, s: 'Maintenance', g: 'Beatmap sources', k: 'online.customPreview', l: 'Custom preview URL', t: 'text', d: '', hint: 'e.g. https://b.ppy.sh/preview/$setId.mp3', when: () => Settings.get('online.previewSource') === 'custom' },
  { x: 1, s: 'Maintenance', g: 'Beatmap sources', k: 'online.coverSource', l: 'Cover image source', t: 'select', d: 'official', o: [['official', 'Official osu!'], ['sayobot', 'SayoBot'], ['custom', 'Custom…']] },
  { x: 1, s: 'Maintenance', g: 'Beatmap sources', k: 'online.customCover', l: 'Custom cover URL', t: 'text', d: '', hint: 'e.g. https://assets.ppy.sh/beatmaps/$setId/covers/cover.jpg', when: () => Settings.get('online.coverSource') === 'custom' },
  { s: 'Maintenance', g: 'Replays', k: 'replays.autosave', l: 'Save replays automatically', t: 'select', d: 'pb', o: [['pb', 'Personal bests'], ['all', 'All passes'], ['off', 'Never']] },
  { s: 'Maintenance', g: 'Data', k: 'data', l: 'Data management', t: 'data' },
  // hidden (not in UI)
  { k: 'debug.overlay', d: false }, { k: 'ui.dashSort', d: 'lastVisit' }, { k: 'ui.dashStyle', d: 'card' }, { k: 'ui.allSettings', d: false }, { k: 'songselect.sort', d: 'title' }, { k: 'songselect.group', d: 'none' },
  { k: 'songselect.detailTab', d: 'ranking' }, { k: 'songselect.lbSort', d: 'score' }, { k: 'songselect.lbMods', d: false },
  { k: 'songselect.keys', d: [] }, { k: 'songselect.starsMin', d: 0 }, { k: 'songselect.lastDiff', d: {} }, { k: 'ui.chatHeight', d: 0.4 }, { k: 'medals.unlocked', d: {} }, { k: 'medals.backfilled', d: false }, { k: 'songselect.lbScope', d: 'local' }, { k: 'songselect.starsMax', d: 10.1 }, { k: 'songselect.mods', d: [] }, { k: 'songselect.collection', d: '' },
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
    delete v['ui.theme']; // (the accent colour setting is gone: always Kori purple)
    // v5: menu blur is baked once into the background image, so Chromebook mode (which used to switch it off) gets it too
    // the default interface size became 80% (100% felt zoomed in); move people still on the old default along
    if (!v['migr.uiScale80']) { if (v['ui.scale'] === 1) v['ui.scale'] = 0.8; v['migr.uiScale80'] = true; }
    // the skin's health bar sits beside the stage, where osu!mania puts it (it used to default to the top-left corner)
    if (!v['migr.hpStage']) { if (v['gameplay.healthStyle'] === 'skin') v['gameplay.healthStyle'] = 'skinstage'; v['migr.hpStage'] = true; }
    if (!v['migr.uiScale90']) { if (v['ui.scale'] === 0.8 || v['ui.scale'] === 1) v['ui.scale'] = 0.9; v['migr.uiScale90'] = true; }
    // (phones: 125% by default — a phone that kept the old 90% default moves up to it)
    // (on a computer the game no longer goes fullscreen by itself: it's back to off, the new default there)
    if (!v['migr.fsPc']) { if (!TOUCH_DEVICE) delete v['input.fullscreenOnPlay']; v['migr.fsPc'] = true; }
    if (!v['migr.uiScaleTouch']) { if (TOUCH_DEVICE && v['ui.scale'] === 0.9) delete v['ui.scale']; v['migr.uiScaleTouch'] = true; }
    // the Custom skin's colour is Web-Osu-Mania's simple mode (white outer columns, the colour inside), even for
    // backups imported with per-column colours
    if (!v['migr.womSimple']) { if (v['wom.colorMode'] === 'custom') v['wom.colorMode'] = 'simple'; v['migr.womSimple'] = true; }
    // downloads work as Web-Osu-Mania's: one chosen provider (Mino by default), straight from the browser unless proxied
    if (!v['migr.womDl']) { if (v['online.downloadSource'] === 'auto') delete v['online.downloadSource']; delete v['online.proxyDownloads']; v['migr.womDl'] = true; }
    if (!v['migr.cbBlur']) { if (v['graphics.performanceMode'] && v['graphics.menuBlur'] === 0) v['graphics.menuBlur'] = 12; v['migr.cbBlur'] = true; }
    // a Chromebook that never picked a device (or skipped setup before it asked) gets the Chromebook settings, once
    if (!v['migr.crosAuto']) {
      v['migr.crosAuto'] = true;
      if (typeof IS_CHROMEBOOK !== 'undefined' && IS_CHROMEBOOK && !v['setup.device'] && typeof SETUP_DEVICES !== 'undefined') {
        Object.assign(v, SETUP_DEVICES.chromebook.values()); v['setup.device'] = 'chromebook';
      }
    }
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
    r.style.setProperty('--ui-scale', 1); // (UI scaling scales the whole app: see Zoom.update)
    if (typeof Zoom !== 'undefined' && Zoom.z !== undefined) Zoom.update();
    const sp = this.get('ui.animSpeed');
    r.style.setProperty('--anim', sp <= 0 ? 0 : (1 / sp));
    r.dataset.theme = 'kori';
    r.classList.toggle('no-effects', !this.get('graphics.effects'));
    r.classList.toggle('no-anim', sp <= 0);
    r.classList.toggle('perf', !!this.get('graphics.performanceMode')); // (lighter menus: see .perf in the styles)
  },
};
