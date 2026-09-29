# Ashtonk!mania

A browser-based mania rhythm-game client: beatmap library, song select, gameplay, results, replays, practice, mods, skins, statistics and profiles. It's inspired by osu!mania and osu!lazer, but every system was written from scratch for this project. It is not affiliated with osu!.

**To play, open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari 16.4+).** The whole client is in that one file, with no install and no server. To get the most reliable storage and timing, serve the folder over `http://localhost` (for example `npx http-server .`) instead of opening it from disk.

## Hosting on Cloudflare

`wrangler.jsonc` deploys a Worker named `beta-ashtonkmania`:

* `public/` is served as static assets (the built `index.html` and `skins/kori.osk`).
* `worker/index.js` answers `/api/*` for the Beatmap Explorer:
  * `/api/search` uses public mirrors (Mino, NeriNyan, osu.direct), trying each one in turn.
  * `/api/download/:id` proxies the `.osz` from the first mirror that has it (Mino, NeriNyan, osu.direct, SayoBot).
* `/api/mp/*` runs online 1v1 multiplayer on two Durable Objects (`worker/multiplayer.js`): `MatchRoom` (one per room code, relays the match over WebSockets) and `Matchmaker` (quick match). They are declared in `wrangler.jsonc` as SQLite-backed classes, so they work on the Workers free plan and are created on the first deploy.
* Optional: `npx wrangler secret put OSU_CLIENT_ID` and `OSU_CLIENT_SECRET` (an [osu! OAuth application](https://osu.ppy.sh/home/account/edit#oauth)) make search use the official osu! API.

In the dashboard, leave the build command empty and set the deploy command to `npx wrangler deploy`.

## What's new

### First-run setup, player loader, new beatmap cards

* **First-run setup:** the first time the game opens, a short osu!lazer-style setup walks you through it. It asks for your name, whether you've played osu! before (new players get a slower scroll speed and the key display; veterans get the hit error bar, counters and every advanced setting), and what you're playing on. **Good PC**, **Normal laptop** or **Chromebook / slow PC**: the game detects ChromeOS, CPU threads and memory, measures the browser's frame rate, and recommends one. The Chromebook preset turns on performance mode, lighter backgrounds, no menu blur and a render scale that fits the screen. Then you pick an accent colour, UI size, profile picture, volume and a few interface toggles. Scroll speed, direction, background dim and blur come next, with a live preview drawn by the real renderer and your skin. After that you set your 4K keys and audio offset (with calibration), pick or import a skin (`.osk`), and finish by browsing or importing beatmaps. Every step can be skipped, and you can run it again from **Settings → Maintenance**.
* **Player loader:** before each play, the beatmap is shown with its cover, difficulty, stars, length, BPM and notes (adjusted for DT/HT), plus your mods and the loading progress. On the right are quick settings: background dim, blur and scroll speed (with a live background), and the beatmap offset. Hovering the settings holds the loader, as in lazer. `Space` starts straight away and `Esc` goes back. Retries use a short loader that shows the retry number. In multiplayer, the loader leaves just before the synchronised start.
* **Beatmap offset:** each difficulty can have its own offset on top of the global one. After a play where you were consistently early or late, the loader offers **Calibrate using last play**, and the results screen offers a one-click fix.
* **Hold to retry:** holding `` ` `` shows a retry bar that fills over half a second. The pause screen shows how many times you've retried.
* **New Beatmap Explorer cards:** each card has a cover image with status, video and "In library" badges, play and favourite counts, the length, and a preview button on hover. Below the cover are the title, artist and mapper, a difficulty spectrum, the star range, the key counts and the main action. Clicking a card opens a beatmap set overlay (like lazer's) with a large cover, preview, download or play, and a difficulty picker. The picker shows each difficulty's length, BPM, note and long-note counts and bars for keys, HP, accuracy and star rating.

### Multiplayer: search from the room, automatic installs, your own difficulty

* **Search beatmaps from the room:** the beatmap panel has a "Search beatmaps" button (also when no beatmap is selected yet) that opens the Browse screen (Beatmap Explorer) in "pick for this room" mode: every card gets a Pick button (host; online beatmaps download first) or a Suggest button (other players), then a difficulty menu, and you're taken back to the room. The room's side panel is just chat.
* **Automatic temporary installs:** when the host picks a beatmap you don't have, it downloads immediately — no click needed. It's installed only for the room and removed when you leave (press **Keep** to hold on to it). Leftovers from a closed tab are cleaned up the next time the game starts.
* **Invites:** the room's **Invite** button copies a link (or opens the share sheet on devices that have one). Opening the link starts the game and joins that room directly.
* **You can't die in multiplayer:** health can reach 0 but you keep playing — from that moment your score and pp for the match are halved (a notice shows in game, and the saved score is marked).
* **Matches are won on pp:** the player with more pp wins (score, then accuracy, only break ties such as two fails at 0pp). The in-game board ranks and shows live pp, and the results lead with pp.
* **Pick your own difficulty:** every player chooses which difficulty of the room's beatmap set they play ("Your difficulty"). Everyone's choice is shown in the players list and on the results — and since the winner is decided by pp, a harder difficulty can pay off.

### BPM scrolling from Web-Osu-Mania, instant previews, better breaks

* **BPM / SV scrolling now uses Web-Osu-Mania's logic** (MIT): the "main" BPM is the one that lasts longest *between the first and last note* (intros and outros at other BPMs no longer skew it), red lines scroll at main-beat-length ÷ beat-length, green lines multiply the last red line's speed by 100 ÷ −beat-length, and nothing is capped, so SV teleports and stops play as mapped.
* **Song previews start instantly.** Menus and song select stream the track instead of decoding the whole file first (about 80 ms from click to sound). The full decode for gameplay happens in the background once you stay on a song.
* **No more songs starting in the wrong place:** a slow earlier preview can no longer start the next song at its own position. Songs start at their PreviewTime (40% in when the map doesn't set one, as in osu!).
* **Breaks** only show for gaps of 10 seconds or more, with an osu!lazer-style overlay: countdown, a bar that shrinks to the centre, and your current accuracy and rank.
* **Defaults:** hit error bar off, background dim 50%, background blur 50% (blur is now a percentage and is baked into the image once instead of re-blurred every frame).
* **FPS counter** in the bottom right, styled like osu!lazer's (frame rate + frame time, colour-coded).
* The settings panel can no longer be scrolled sideways.

### Scroll velocity fixes

* **SV lines are read the way osu! reads them:** a timing point with a negative beat length is always a scroll-velocity (green) line, even when the file flags it as a BPM line; before, those SV changes were ignored. Green lines with a positive beat length reset SV to 1×.
* **Scroll speed in game:** `F3`/`F4` (osu!stable) or `Ctrl −`/`Ctrl +` (osu!lazer) change the scroll speed while playing, with a small popup.
* "Scroll speed changes" (SV + BPM / SV only / Constant) is now one of the essential settings.

### Cleaner gameplay HUD

* **No hitsounds.** Notes no longer play hit samples (the sound settings for them are gone); skin sounds such as combo break and fail still play.
* **Less on screen:** the song time (top left) and the title / difficulty line (bottom left) are removed, judgements are drawn about 40% smaller, and scores no longer have leading zeros (366,667 instead of 0,366,667).
* **New health bar:** a slim bar beside the stage from near the top of the screen to the bottom, eased smoothly, glowing in the accent colour, turning red and pulsing when low.
* **Beatmap Explorer:** previewing a song no longer jumps the list back to the top. The top bar no longer has a beatmap listing button (Browse on the main menu still opens it).

### Smoother, simpler settings, room search, new mod select

* **Smoother gameplay.** Nothing behind the playfield is drawn in game any more (the blurred menu background and the hidden toolbar used to cost GPU time every frame), the HUD only touches the page when a value visibly changes, gamepads are only polled while one is connected, and the renderer no longer creates garbage every frame. The multiplayer scoreboard updates in place ten times a second and the opponent's score counts up smoothly instead of jumping.
* **Simpler settings.** The panel shows about 20 essentials; "Show all settings" at the bottom reveals the rest, and search always finds everything.
* **Search songs in multiplayer rooms.** The room has a "Search songs" tab next to Chat that searches your library or osu! beatmaps online. The host picks directly (online maps download on pick); the other player can suggest a map, which shows up in chat with a Pick button for the host.
* **New mod select** in the osu!lazer style: coloured columns per mod type, compact mod panels that fill with the column colour when enabled, a Customise column for mods with settings, and a footer with Deselect all / Done.

### osu!lazer look, simpler menus, multiplayer

* **The UI now follows osu!lazer.** Neutral dark panels, a pink accent, the lazer toolbar (icon buttons with tooltips, clock, account menu), the main-menu logo with its button bar, the song select layout (info wedge and ranking on the left, filters and carousel on the right, footer with the logo as the Play button), the lazer profile layout and flat controls. The logo no longer changes with the theme, and the theme setting now only changes the accent colour.
* **Main menu:** the logo sits alone in the middle (nothing overlaps it). Click it or press any key for Settings / Play / Browse / Profile; Play opens Solo / Multi / Practice. The "continue playing" and "recent scores" panels are gone.
* **Now playing:** hover the song name in the toolbar to see the cover, seek, pause, skip to the next song or go back to the previous one.
* **Online 1v1 multiplayer:** quick match, or create a room and share its code. The host picks the beatmap and mods in song select, the other player can download a missing beatmap in one click, both press Ready, and the match starts in sync. A live scoreboard shows both scores in game, and the room shows who won. Chat is built in.
* **Same size at any browser zoom.** Ctrl +/−, Ctrl + wheel and pinch zoom are blocked, and an existing zoom level is detected and compensated, so the client always has the same physical size (use Settings → Interface → UI scale instead).
* **Simpler screens:** Statistics are part of the profile, results keep the secondary graphs under "More statistics", and the library and skin pages drop their detail panels.
* **Removed:** touch-screen controls and the Neru easter eggs (the Neru accent colour is still available).

### Earlier

* **Kori 3.0 comes preinstalled.** On the Cloudflare site (or any http server), `public/skins/kori.osk` is installed and selected on first launch. It's a mania-only trim of the skin at 3.2 MB.
* **The math now matches osu!** Ported from [Web-Osu-Mania](https://github.com/hectickiwi/Web-Osu-Mania) (MIT):
  * ScoreV1 scoring with the hit bonus
  * osu!mania accuracy (MAX weighted as 305)
  * ScoreV2-table hit windows, with EZ/HR applied to OD
  * legacy health drain
  * lazer's star rating
  * pp from ManiaPerformanceCalculator, with profile totals weighted 0.95ⁿ plus the play-count bonus
* **Skins no longer stretch vertically.** Legacy skin textures are sized in lazer's 768-unit space. Keys, hint lines and lights keep their authored height, and hit lighting scales with column width / 30.
* **Beatmap Explorer:** search osu!mania beatmaps and download them straight into the library. See *Hosting* below.
* **Accent colours:** osu! pink (default), Kori purple, Neru yellow, Teto red, Miku teal and Midnight blue. The built-in skin follows the accent and offers bars, circles, diamonds or arrows.
* **First launch** asks for your name.
* **pp:** a live pp counter in gameplay, pp on results, total pp and weighted top plays on your profile, and pp history in Statistics.
* **In-game HUD:** a song-progress pie (green during the lead-in), a KPS counter and an early/late indicator.
* **More options:**
  * a toggle to hide MAX judgements
  * a break overlay that lightens the background
  * an unpause countdown
  * retry on fail
  * Shift+Tab to hide the HUD
  * Alt+wheel volume
* **Gamepad controls.**
* **Background videos** (mp4/webm).
* **New mods:** Perfect (SS), Accuracy Challenge, Difficulty Adjust (OD/HP), Song Speed (0.5–2×), Percy, and coverage amount for Hidden and Fade In.

## Getting started

1. Open `index.html`. The first-run setup asks a few quick questions (name, experience, device, look and feel, scroll speed, skin); skip it any time.
2. Drag your skin (for example `《NM》 Kori 3.0.osk`) onto the window. It's imported, its `skin.ini` is parsed, and it's selected straight away.
3. Drag one or more `.osz` beatmaps onto the window. You can also drop a folder of beatmaps, or loose `.osu` files together with their audio. The first playable difficulty opens in song select, and its preview starts playing.
4. Press **Enter** to play.

All data is stored locally in IndexedDB, so it survives a refresh. That includes beatmaps, skins, scores, replays, favorites, collections, settings and your profile.

## Keyboard

| Where | Keys |
|---|---|
| Global | `Ctrl+O` settings · `Alt+Enter` fullscreen · `Esc` back · `Alt+wheel` volume · `Ctrl+Shift+D` debug overlay |
| Main menu | any key opens the menu · `O` settings · `P` play · `B` browse · `U` profile · in Play: `S` solo · `M` multiplayer · `P` practice |
| Song select | `↑↓` difficulty · `←→` set · `Enter` play · `Ctrl+Enter` watch Auto · `F1` mods · `F2` random · `F3` options · `F4` practice · typing searches |
| Multiplayer match | `Esc` quit the match (counts as a loss) — there is no pause or retry |
| Search syntax | `keys=7 stars>4 bpm>=180 length<120 od>8 ln>30 played=0 creator=name` |
| Player loader | `Space` start now · `Esc` back to song select · hover the settings to hold |
| Gameplay | lane keys (default 4K `D F J K`, 7K `S D F Space J K L`, 8K `A S D F J K L ;`) · `Esc` pause · hold `` ` `` or `Ctrl+R` retry · `Space` skip intro · `F3`/`F4` or `Ctrl −`/`Ctrl +` scroll speed |
| Practice | `[` / `]` set loop A/B · `\` clear loop · `Backspace` restart section · `←→` seek 5s · `-`/`=` offset |
| Mod select | letter shortcuts shown on each mod · `Backspace` deselect all |

## Architecture

The source lives in `src/` and is split into logical systems. `node build.mjs` inlines them into `index.html`.

| File | Systems |
|---|---|
| `00-util.js` | DOM helpers, hashing, fuzzy search, event bus |
| `01-db.js` | IndexedDB storage (sets, maps, files, scores, replays, skins, kv) |
| `02-zip.js` | ZIP reader (native `DecompressionStream` with a pure-JS inflate fallback) and a ZIP writer for exports |
| `03-beatmap-parser.js` | `.osu` parser, mania conversion, timing/SV scroll segments, strain-based star rating, validation |
| `04-skin.js` | `SkinParser` (`skin.ini`), `SkinManager`, per-key-count `ManiaLayout`, @2x handling, animation frames, fallbacks, procedural default skin |
| `05-audio.js` | `AudioManager` (Web Audio clock), `Music` (song-position clock), WSOLA pitch-preserving time stretch, UI sounds |
| `06-settings.js` | Schema-driven `SettingsManager` and default keybinds (1K–10K) |
| `07-beatmap-manager.js` | Importing (`.osz`, folders, drag & drop), set grouping, library, the `BeatmapProvider` interface |
| `08-mods.js` | Mod system (definitions, incompatibilities, multipliers, rates, column mapping) |
| `09-gameplay.js` | `GameplayEngine`, judgement, score, health, long notes, Auto input generator |
| `10-renderer.js` | Canvas stage renderer (skin geometry in 480-space units) |
| `11-managers.js` | Scores and PBs, replays, favorites, collections, profile and XP, statistics, data import/export |
| `12`–`18` | UI: screen manager, toolbar and now-playing panel, zoom lock, main menu and menu music, song select, gameplay, results, library, collections, profile (with statistics), replays, skins, beatmap explorer, settings, key config, calibration, mod select |
| `19-multiplayer.js` | Multiplayer client (WebSocket connection, room state) and the lobby/room screen |
| `20-app.js` | Boot sequence, global input routing, drag & drop |
| `worker/` | Cloudflare Worker: beatmap search/download proxy (`index.js`) and multiplayer rooms (`multiplayer.js`) |

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
* Colours: `Colour#`, `ColourLight#`, `ColourJudgementLine`, `ColourHold` (gameplay has no barlines, so `ColourBarline` is ignored)
* Images: `KeyImage#`/`D`, `NoteImage#`/`H`/`L`/`T`, `Stage*`, `Lighting*`, `Hit*`
* Fonts: `[Fonts]` `ScorePrefix` and `ComboPrefix`

Asset paths are matched case-insensitively (for example `mania/key` finds `Mania/key@2x.png`). `@2x` versions are preferred on high-resolution displays, and `-0…-N` animation frames are supported. Any asset a skin doesn't include falls back to the built-in Ashtonk!mania default skin.

Skin sounds are used when present: combo break, fail, applause, and hover/click/back (with common alias names). Gameplay has no hitsounds.

## Mods

NF, EZ, HT, DC, HR, SD, PF, DT, NC, HD, FI, MR, RD (seeded, so replays reproduce), CS (constant speed), NLN (no long notes) and AT (Auto).

osu!standard-only mods such as Relax, Autopilot and Spun Out are left out on purpose, because they don't mean anything in mania.

## Tests

```bash
node --test tests/*.test.mjs        # engine, parser, Worker and multiplayer room unit tests
node tests/make-fixtures.mjs        # generate synthetic .osz/.osk fixtures
node tests/e2e.mjs --shots          # headless Chromium end-to-end run (Playwright)
MINIFLARE_DIR=<dir> node tests/mp-e2e.mjs   # two browsers play a match against the real Worker + Durable Objects
```

`tests/mp-e2e.mjs` needs `miniflare` installed somewhere (`npm i miniflare` in any folder, then point `MINIFLARE_DIR` at it). It runs `worker/index.js` in workerd and checks rooms, chat, map selection, ready/start, the synchronised start, the live scoreboard, results, forfeits, room song search (library and online, suggestions and picks), host hand-over and quick match.

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
* **Player loader:** beatmap info and quick settings, `Space` to start, the beatmap offset applied, and hold-to-retry with the retry counter.
* **First-run setup:** name validation, experience and device presets (including Chromebook detection), live accent colour, the gameplay preview, key rebinding, the skin list, and choices persisting without the setup coming back.
* **Persistence:** everything survives a reload.
* **Layout:** 720p, 16:10 and ultrawide, plus browser-zoom compensation.
* **UI:** the lazer toolbar, main menu and the now-playing controls (pause, next, previous).

## Limits

* Storyboards are detected but not rendered.
* Only osu!mania difficulties (`Mode: 3`) can be played. Other modes are listed with an explanation.
* The Beatmap Explorer and multiplayer need the Worker, so they only work on the hosted site (or `wrangler dev`), not when `index.html` is opened from disk.
* Browser-zoom compensation relies on the window/viewport width ratio; with a docked side panel (for example developer tools) the zoom can't be measured, and the page is left as is.
* The UI font (Outfit, the closest free match to lazer's Torus) loads from Google Fonts; a locally installed Torus is used first. When you're offline it falls back to system fonts.

## Credits

* Scoring, accuracy, health, star rating, pp and hit-window formulas, plus the arrow directions for the arrows note style, are ported from **Web-Osu-Mania** by Danny Duong (MIT License, © 2024 Danny Duong). The notice is kept in `src/js/09a-osu-math.js`. Those formulas follow the official osu!/osu!lazer sources.
* **《NM》 Kori 3.0** skin by Kori (`public/skins/kori.osk`, mania assets only).
