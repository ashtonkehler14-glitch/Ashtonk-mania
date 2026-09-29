# Ashtonk!mania

A browser-based mania rhythm-game client: beatmap library, song select, gameplay, results, replays, practice, mods, skins, statistics and profiles. It's inspired by osu!mania and osu!lazer, but every system was written from scratch for this project. It is not affiliated with osu!.

**To play, open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari 16.4+).** The whole client is in that one file, with no install and no server. To get the most reliable storage and timing, serve the folder over `http://localhost` (for example `npx http-server .`) instead of opening it from disk.

## Hosting on Cloudflare

`wrangler.jsonc` deploys the game as a Cloudflare Worker named `beta-ashtonkmania`. Cloudflare serves static assets from `public/`, which contains only the built `index.html`.

* **From Git:** in the Cloudflare dashboard, go to Workers & Pages, connect the repo, leave the build command empty and set the deploy command to `npx wrangler deploy`.
* **From your machine:** run `npx wrangler deploy`.

After editing anything in `src/`, run `node build.mjs`. It updates both `index.html` and `public/index.html`.

## Getting started

1. Open `index.html`.
2. Drag your skin (for example `《NM》 Kori 3.0.osk`) onto the window. It's imported, its `skin.ini` is parsed, and it's selected straight away.
3. Drag one or more `.osz` beatmaps onto the window. You can also drop a folder of beatmaps, or loose `.osu` files together with their audio. The first playable difficulty opens in song select, and its preview starts playing.
4. Press **Enter** to play.

All data is stored locally in IndexedDB, so it survives a refresh. That includes beatmaps, skins, scores, replays, favorites, collections, settings and your profile.

## Keyboard

| Where | Keys |
|---|---|
| Global | `Ctrl+O` settings · `Alt+Enter` fullscreen · `Esc` back · `Ctrl+Shift+D` debug overlay |
| Home | `P`/`Enter` play · `B` beatmaps · `C` collections · `U` profile · `T` statistics · `K` skins · `R` replays |
| Song select | `↑↓` difficulty · `←→` set · `Enter` play · `Ctrl+Enter` watch Auto · `F1` mods · `F2` random · `F3` options · `F4` practice · typing searches |
| Search syntax | `keys=7 stars>4 bpm>=180 length<120 od>8 ln>30 played=0 creator=name` |
| Gameplay | lane keys (default 4K `D F J K`, 7K `S D F Space J K L`, 8K `A S D F J K L ;`) · `Esc` pause · hold `` ` `` or `Ctrl+R` retry · `Space` skip intro |
| Practice | `[` / `]` set loop A/B · `\` clear loop · `Backspace` restart section · `←→` seek 5s · `-`/`=` offset |
| Mod select | letter shortcuts shown on each mod · `Backspace` deselect all |

## Architecture

The source lives in `src/` and is split into logical systems. `node build.mjs` inlines them into `index.html`.

| File | Systems |
|---|---|
| `00-util.js` | DOM helpers, hashing, fuzzy search, event bus |
| `01-db.js` | IndexedDB storage (sets, maps, files, scores, replays, skins, kv) |
| `02-zip.js` | ZIP reader (native `DecompressionStream` with a pure-JS inflate fallback) and a ZIP writer for exports |
| `03-beatmap-parser.js` | `.osu` parser, mania conversion, timing/SV scroll segments, barlines, strain-based star rating, validation |
| `04-skin.js` | `SkinParser` (`skin.ini`), `SkinManager`, per-key-count `ManiaLayout`, @2x handling, animation frames, fallbacks, procedural default skin |
| `05-audio.js` | `AudioManager` (Web Audio clock), `Music` (song-position clock), WSOLA pitch-preserving time stretch, UI sounds |
| `06-settings.js` | Schema-driven `SettingsManager` and default keybinds (1K–10K) |
| `07-beatmap-manager.js` | Importing (`.osz`, folders, drag & drop), set grouping, library, the `BeatmapProvider` interface |
| `08-mods.js` | Mod system (definitions, incompatibilities, multipliers, rates, column mapping) |
| `09-gameplay.js` | `GameplayEngine`, judgement, score, health, long notes, Auto input generator, hitsounds |
| `10-renderer.js` | Canvas stage renderer (skin geometry in 480-space units) |
| `11-managers.js` | Scores and PBs, replays, favorites, collections, profile and XP, statistics, data import/export |
| `12`–`18` | UI: screen manager, toolbar, home, song select, gameplay, results, library, collections, profile, stats, replays, skins, settings, key config, calibration, mod select |
| `19-multiplayer.js` | Room/player/countdown/scoreboard/spectating state model (not in the UI yet) |
| `20-app.js` | Boot sequence, global input routing, drag & drop, easter eggs |

### Timing

* **The clock is the audio.** Song position comes from `AudioContext.getOutputTimestamp()`: the context time currently reaching the speakers, interpolated using `performance.now()`. `requestAnimationFrame` only draws frames. It never decides anything.
* **Input is timestamped.** Each key event's `KeyboardEvent.timeStamp` is mapped onto the audio clock, so a hit is judged by when you pressed the key, not by when the next frame happened to render.
* **The engine is deterministic.** Given the same notes and the same `(column, down/up, time)` inputs, `GameplayEngine` always produces the same result. Live play, Auto and replay playback all use the same code path, so replays reproduce the original score exactly.
* **Timing windows follow osu!mania OD.** Marvelous 16 ms, then 64/97/127/151/188 − 3·OD. HR divides them by 1.4 and EZ multiplies by 1.4. You can instead use a custom OD or custom millisecond values. Long-note releases get 1.5× the windows.

### Skins

`skin.ini` `[Mania]` sections are applied per key count. Supported keys:

* Column settings: `ColumnWidth`, `ColumnSpacing`, `ColumnLineWidth`, `ColumnStart`
* Positions: `HitPosition`, `LightPosition`, `ScorePosition`, `ComboPosition`
* Display options: `JudgementLine`, `KeysUnderNotes`, `NoteBodyStyle`, `WidthForNoteHeightScale`, `LightingN/LWidth`, `LightFramePerSecond`, `SpecialStyle`, `UpsideDown`
* Colours: `Colour#`, `ColourLight#`, `ColourBarline`, `ColourJudgementLine`, `ColourHold`
* Images: `KeyImage#`/`D`, `NoteImage#`/`H`/`L`/`T`, `Stage*`, `Lighting*`, `Hit*`
* Fonts: `[Fonts]` `ScorePrefix` and `ComboPrefix`

Asset paths are matched case-insensitively (for example `mania/key` finds `Mania/key@2x.png`). `@2x` versions are preferred on high-resolution displays, and `-0…-N` animation frames are supported. Any asset a skin doesn't include falls back to the built-in Ashtonk!mania default skin.

Skin sounds are used when present, including hitsounds, combo break, fail, applause, and hover/click/back (with common alias names).

## Mods

NF, EZ, HT, DC, HR, SD, PF, DT, NC, HD, FI, MR, RD (seeded, so replays reproduce), CS (constant speed), NLN (no long notes) and AT (Auto).

osu!standard-only mods such as Relax, Autopilot and Spun Out are left out on purpose, because they don't mean anything in mania.

## Tests

```bash
node --test tests/*.test.mjs        # engine and parser unit tests
node tests/make-fixtures.mjs        # generate synthetic .osz/.osk fixtures
node tests/e2e.mjs --shots          # headless Chromium end-to-end run (Playwright)
```

The end-to-end run checks:

* **Importing:** `.osz`, `.osk`, and corrupt or non-mania archives.
* **Song select:** search, filter syntax and sorting.
* **Gameplay:**
  * Auto plays on 4K, 7K, 8K and 9K.
  * Live keyboard play judged against the audio clock.
  * Misses and offset.
  * Replay reproduction.
  * Pause and resume.
  * Sudden Death failing.
  * The imported skin in use.
  * Practice speed changes.
* **Persistence:** everything survives a reload.
* **Layout:** 720p, 16:10 and ultrawide.

## Limits

* Storyboards and videos are detected but not rendered, and video files are not stored.
* Only osu!mania difficulties (`Mode: 3`) can be played. Other modes are listed with an explanation.
* Online beatmap providers and multiplayer have their architecture in place (`BeatmapProvider`, `MultiplayerRoom`), but they're hidden from the UI until a backend exists.
* The UI font (Nunito) loads from Google Fonts. When you're offline it falls back to system fonts.
