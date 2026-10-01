# Ashtonk!mania

A browser-based mania rhythm-game client: beatmap library, song select, gameplay, results, replays, practice, mods, skins, statistics and profiles. It's inspired by osu!mania and osu!lazer, but every system was written from scratch for this project. It is not affiliated with osu!.

**To play, open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari 16.4+).** The whole client is in that one file, with no install and no server. To get the most reliable storage and timing, serve the folder over `http://localhost` (for example `npx http-server .`) instead of opening it from disk.

## Hosting on Cloudflare

`wrangler.jsonc` deploys a Worker named `beta-ashtonkmania`:

* `public/` is served as static assets (the built `index.html`, `sw.js` for offline play, `manifest.webmanifest` + `icons/`, and `skins/kori.osk`). `node build.mjs` writes `index.html` and `sw.js`; `python3 tools/make-icons.py` redraws the icons.
* `worker/index.js` answers `/api/*` for the Beatmap Explorer:
  * `/api/search` uses the official osu! API when a key is set (below), otherwise public mirrors (Mino, NeriNyan, osu.direct), trying each one in turn.
  * `/api/download/:id` proxies the `.osz` from the first mirror that has it (Mino, NeriNyan, osu.direct, SayoBot, Nekoha; `?provider=` picks which goes first).
* `/api/mp/*` runs online 1v1 multiplayer on two Durable Objects (`worker/multiplayer.js`): `MatchRoom` (one per room code, relays the match over WebSockets) and `Matchmaker` (quick match). They are declared in `wrangler.jsonc` as SQLite-backed classes, so they work on the Workers free plan and are created on the first deploy.
* **To browse exactly like Web-Osu-Mania** (the official osu! API, same order and filters as osu!), give the Worker an osu! API key once:
  1. On osu.ppy.sh go to **Settings → OAuth → New OAuth Application**. Any name works; the callback URL can be left empty. Copy the **Client ID** and **Client Secret**.
  2. Run `npx wrangler secret put OSU_CLIENT_ID` and paste the ID, then `npx wrangler secret put OSU_CLIENT_SECRET` and paste the secret.
  3. `/api/health` then reports `"official": true` and the explorer shows "via osu! API". Without the key, search falls back to the public mirrors.

In the dashboard, leave the build command empty and set the deploy command to `npx wrangler deploy`.

## What's new

### Small polish: results, skins, menu logo

* **Hit distribution:** it now works like lazer's. The bins are sized from your widest hit, with 50 on each side of zero, and empty bins show as faint dots. You get a readable shape instead of thin spikes spread across the whole hit window.
* **Results:** the "Played on" line is short (e.g. "Oct 1, 2026, 4:29 AM"), and so are the dates in Replays. The share card's grade uses lazer's rank colours, as the rest of the game does.
* **Skins:** the eighteen 1K–18K preview chips are now one small ‹ 4K › stepper. Beside it is a note saying whether that key count comes from skin.ini, from the skin's 4K layout, or from the fallback.
* **Main menu logo:** "ashtonk!" no longer touches the edge of the circle when the Outfit font hasn't loaded.
* **Small wording fixes:** when the multiplayer server can't be reached, the screen now says it's trying again instead of "Couldn't load the room list". Collections no longer shows a "0 favorite sets" note.

### lazer parity pass

Every screen was compared side by side with its osu!lazer counterpart:

* **Results:** the score panel opens alone in the middle, as in lazer. Click it to slide it aside and bring in the statistics, and click again to put them away.
* **Notifications and now playing:** Esc closes them, and so does going to another screen (they used to stay open across screens).
* **Toolbar:** no focus ring on its buttons, as in lazer.
* **Already matching lazer, left as they are:** song select (SelectV2 layout and footer), settings (lazer's form controls), mod select, the popup dialog, the player loader, pause and fail screens, the beatmap listing and its info page, the profile, and the volume overlay. Screens lazer doesn't have (skins, beatmap library, collections, replays) and the things you chose differently (the Edit menu, no hit error bar, Ranked Play, Neru) stay as they are.

### Setup like lazer, less clutter

* **Setup can't be skipped.** Its pages are like lazer's first-run setup: your name, then **"Coming from Web-Osu-Mania?"** (lazer's "import from osu!stable" page). Answer Yes to see where WOM keeps its backup (Settings → Backup & Restore) and import it there: keybinds, settings, beatmaps, scores and collections. After that come device, size and picture, gameplay and skin.
* **Collections bring their songs:** importing a WOM backup also downloads any songs from your collections that aren't in it or in your library. Scores on those songs then come across too.
* **No colour question in setup.** The accent colour is still in Settings.
* **Discover is gone**, along with the "Who's online" button and the player count on the multiplayer screen. Inviting from a room still lists who's online.
* **Beatmap listing:** a card no longer jitters while its song downloads (progress is drawn in place), and the hover panel no longer sticks after you press Like.

### Ranked Play lobby

* **Three levels:** Beginner (~1.5★), Intermediate (~3★) and Advanced (~4.5★), picked with one segmented control. The six levels and the fine-tune slider are gone. A level saved before snaps to the nearest one.
* **A calmer waiting screen:** one centred card with you vs your opponent (a pulsing placeholder while searching), your level, the room code with Copy and Invite, and Ready once someone joins. The chat panel, the HP bars and the rules list are hidden until the match starts; the rules fold under "How it works".

### Gameplay polish across skins

* **Skin health bars stand beside the stage,** where osu!mania puts them, instead of running across the top-left corner (the Chemuss bar reached into the playfield). The top-left placement is still in Settings.
* **Broken key-count sections:** if a skin's own section for a key count points only at images it doesn't contain (Chemuss's 7K does), that key count plays with the skin's 4K art instead of generic notes.
* **Narrower 7K+ stages** for skins played through their 4K art (at most 1.45× the 4K stage).
* **No lone leaderboard:** on a map you haven't passed yet, there's no "#1 you" panel on the left.
* **Bigger mod icons** under the score, in lazer's style.

### Ranked Play rework

* **No rating or tiers.** Ranked Play is just a way to play: 1v1 with beatmap cards and HP.
* **Skill levels:** each player picks a level (Beginner to Master, or fine-tuned in stars) while waiting, then presses Ready. The deck is built between the two levels, nearer the lower one (30% of the way up, ±0.6★).
* **Fairer cards:** hands of five, dealt in pairs of matching difficulty, so both hands have the same spread. Once a round, each player can reroll any of their cards (or the whole hand). The damage multiplier grows more gently: ×1, ×1.5, ×2…
* **Leaving a song** (Esc) in Ranked Play gives that round to your opponent. You both go back to the room and the match carries on. The leaver takes at least 250,000 damage before the multiplier.
* **Failing in multiplayer works like lazer:** running out of health marks the play failed (F, no pp) but you keep playing, and your score still counts for the match. The old "score halved" rule is gone.

### Polish pass

* **Main menu:** the triangles are fully solid (the song no longer shows through) and take the song's average colour. The top bar's music button shows only the note icon.
* **Interface size** defaults to 90%.
* **Volume overlay** moved to the left edge, as in lazer: mute button, then Effects, Master and Music dials with name pills.
* **Beatmap listing:** no more flicker while scrolling (cards are kept and covers cached; hover effects pause while the list moves). Only the common filters show (4K–10K, category, sort); the rest are under "More filters".
* **Beatmap info page** redesigned: one header with the difficulty picker, title, mapper line and buttons; a single details card; tags and your scores below. No more duplicate difficulty list.
* **Top bar buttons toggle:** clicking the beatmap listing, Discover, your profile or the music button again closes it.
* **Online lists stay fresh:** players who go quiet drop off, a reconnecting tab replaces its old entry, rooms leave the list as soon as they empty, and the lobby refreshes every 3 s.
* **Web-Osu-Mania backups:** import the .zip from WOM's Backup & Restore (in setup, Settings → Maintenance, or by dropping it on the game). Beatmaps, settings, keybinds, high scores and collections come across; WOM replays can't be played here.
* **What's new** lists only what you'll notice.

### Simpler multiplayer

* **Create room asks two questions:** Regular or Ranked, then Public or Private. There are no other options to set.
* **Regular rooms follow osu! multiplayer rules:** Head to Head, up to 16 players, highest score wins.
* **Ranked rooms are 1v1 Ranked Play,** in 4K or 7K.
* **Quick Play and quick 1v1 are gone.** Public rooms, ranked ones included, are listed under "Open rooms" in the lobby, so you can click one to join. You can still join a private room by typing its code.

### Beatmap listing in three columns

* **The listing shows three cards per row.**
* **Hovering a card slides out lazer's side panel** with Like and Download, or Play if it's already in your library. Clicking the card still opens the beatmap info page.

### Same look at every resolution, 80% interface, black lazer cursor

* **The interface is 80% by default**; 100% felt zoomed in. Anyone still on the old default moves to 80% once.
* **Every resolution looks exactly the same.** 720p, 1080p, 1440p and 4K now show identical layouts, including Neru and the profile page; only the sharpness changes.
  * Anything sized to the window is now sized to the game's own layout.
* **Browser zoom no longer changes how the game looks.** Zoom changes are followed exactly through the display's pixel ratio.
* **lazer's cursor is now dark with a white rim**, and glows pink while you click.
* **Top bar:**
  * The ruleset icon is gone.
  * Discover uses a globe icon.
  * Your picture sits right of your name.
  * Notifications are at the far right.
  * The clock no longer shows a stray "null" in its digital and analog modes.
* **The main menu buttons sit further right**, so Settings no longer covers Neru.

### Ranked Play, a clearer multiplayer lobby, and profile pictures for everyone

* **Ranked Play** (osu!lazer's 1v1 ranked mode):
  * You're matched against the next player queueing for the same key count.
  * You both start with 1,000,000 HP and a hand of three beatmap cards.
  * Each round the picker plays one card and you both play it. The lower score takes the score difference as damage: ×1 in round 1, ×2 in round 2, and so on.
  * The round's loser picks next; first to 0 HP loses.
  * Your rating (Elo, starting at 1000) and tier (Iron → Grandmaster) update after every match.
* **The multiplayer lobby is laid out like lazer's.**
  * Quick Play and Ranked Play are big tiles sharing one 4K / 7K choice.
  * Below them is lazer's lounge: every open custom room, with its beatmap, match type, players and status. Click one to join.
  * Custom rooms are listed by default; the Match settings Visibility option makes one private (join with the code).
* **Everyone sees each other's profile pictures:** in rooms, Quick Play, Ranked Play, the room list and Discover. Uploaded pictures are shared as small 64 px copies.

### A "What's new" screen

* **Returning players see a lazer-style changelog once after an update**, listing what was added. New players skip it.
* It's always there from the profile menu (right-click your name in the top bar) and at the bottom of Settings.

### Beatmap listing like osu!lazer

* **Beatmap cards follow lazer's card layout.** Each has the cover as a thumbnail (with the preview button), the title, artist and mapper over the faded cover, and the status, difficulty spectrum, key counts, favourites, plays and length. They're in two columns.
* **Clicking a card opens the beatmap info page**, as in lazer. It shows:
  * the difficulty picker;
  * the title, artist and mapper;
  * Preview and a big Download button (or **Play** once it's in your library, or Pick / Suggest in a multiplayer room);
  * the details panel (length, BPM, notes, long notes, key count, HP drain, accuracy, star rating, user rating);
  * Info, Difficulties and a Scoreboard with your scores.

### Custom skin rebuilt, with a Customise panel

* **The Custom skin is redrawn.** Glassy notes in vivid gradients with a soft glow and a light rim. Holds are a translucent beam with bright edges. The column lights up in its colour when pressed. The stage has fine column lines and a glowing border, and hit flashes are sized to the column.
* **You can customise it** in Settings → Skin → Custom skin, or in the skin viewer's new **Customise** panel next to the live preview:
  * Note shape (bars, circles, diamonds, arrows).
  * Colours: your accent, Ocean, Sunset, Neon, Mint, Monochrome or a custom hue.
  * Colour pattern: osu!'s by column type, a rainbow across the stage, or one colour.
  * Note size and roundness.
  * Receptors: outline, filled or hit line only.
  * Key area: glow, lazer Argon panel or none.
  * Hold notes: glowing beam or solid.
  * Glow amount, column lines and the stage border.
* **Skins with health bar pieces but no fill image** (Chemuss) now get their own osu!-style health bar, as in osu!, instead of the lazer one.

### Mod icons, lazer setting names, one UI scale

* **Mods have icons.** Each mod has a glyph on lazer's hexagon mod icon, in lazer's type colours: lime (difficulty reduction), red (difficulty increase), purple (conversion) and blue (automation). They show in mod select, song select, the loader, results and in game.
* **Settings use osu!lazer's names**, for example Scrolling direction, Lighten during breaks, Storyboard / video, Score display mode, Always show key overlay, Show FPS, UI scaling and Parallax. "Interface" is now "User Interface".
* **The interface looks the same at every resolution and browser zoom.**
  * It's laid out for 1366×768 and scaled to fit the window, as lazer does.
  * Settings → Graphics → UI scaling is the one way to make everything bigger or smaller.
  * Phones keep their own layout.

### osu!lazer toolbar, notifications, volume and cursor

* **The top bar follows lazer's layout.**
  * Left: Settings, Home and the osu!mania ruleset.
  * Right: Beatmap listing, Discover (players online), Notifications, Now playing, the clock and your profile.
* **Notifications:** every pop-up is kept in a notifications panel, and the bell counts the unread ones.
* **The clock** switches between full (analog, digital and time played), digital and analog when you click it.
* **Volume:** the mouse wheel changes the volume on the main menu and in game (anywhere with Alt), shown with lazer's volume overlay.
  * Effects, master and music dials; hover one to change it; there's a mute button.
  * Settings → Input → "Disable mouse wheel adjusting volume during gameplay" turns it off in game.
* **lazer's cursor**, with a "Menu cursor size" setting.
* **Discover:** a page of everyone online, with one click to invite them or start a room together.

### Main menu like osu!lazer

* **The button bar follows lazer's layout.** Settings sits left of the logo; Play, Edit and Browse sit to its right.
* **Play** leads to Solo and Multi. Practice and Profile are gone from the menu.
* **Edit** (where lazer's editor button is) leads to Skins, Import, Beatmaps, Collections and Replays.
* **Idle for 15 seconds** and the menu goes back to the big logo, as when the game opens.
* **The hovered button's icon sways and bounces** to the song's beat.
* **lazer's triangles background** drifts behind the menu, coloured to match the playing song's background.
* **Menu music plays through every song in a shuffled order** before repeating any. Small libraries no longer loop the same one or two.
* **More time before a map starts:** the loader stays for 3.5s and the lead-in is 2.5s.
* **The pause menu** no longer shows the taglines or the boxes behind its buttons.
* **Clicking your name in the top bar** opens your profile. Right-click it for the old menu.

### Multiplayer: Quick Play, Team Versus, rooms of up to 8

* **Quick Play** (osu!lazer's new matchmaking mode). Pick 4K or 7K and press Play to join a lobby of up to 8.
  * The first round starts shortly after a second player arrives. There are 5 rounds.
  * Each round offers a pool of ranked maps around the lobby's usual star rating. It's drawn from the online listing, or from players' own maps when offline.
  * Everyone picks one, and a roulette lands on one of the picks. The map downloads automatically.
  * Placements score 8 / 6 / 5 / 4 / 3 / 2 / 1 points, standings update after every round, and the most points wins, shown on a podium.
* **Rooms hold up to 8 players**, with lazer-style **Match settings** for the host:
  * **Head to Head** or **Team Versus**: red vs blue, the team total wins. There's a live team score display in game.
  * **Win by** pp, score, accuracy or max combo.
  * Room size.
  * **Host rotates**: the host role passes to the next player after each match.
* The in-game board shows every player, and results show placements.

### Gameplay HUD blends in

* **The numbers form one right-hand stack**: score, accuracy, pp, then mods. The mod badges no longer sit on top of other text.
* **The pp counter** has lazer's smaller "pp" suffix. The personal-best line under it is gone.
* **Mods start bright and settle back** after a few seconds, as lazer's mod display does.
* **The leaderboard is sheared, see-through panels** coming out of the left edge. Other players' rows sit back; yours is lit in the accent colour with an accent edge. The multiplayer board uses the same style.
* **Text has soft shadows instead of boxes**, including the AUTO / REPLAY badge, so nothing hides the background.

### 4K skins play every key count

* **A skin made only for 4K now plays 1K–10K using its own art** instead of falling back to the built-in look for other key counts.
  * Its four columns are laid out in mirrored patterns: the left hand uses the skin's columns 1–2, the right hand columns 4–3, and an odd middle column continues the alternation.
  * 5K plays as `1 2 1 3 4`, 6K as `1 2 1 4 3 4`, 7K as `1 2 1 2 4 3 4` and 8K as `1 2 1 2 3 4 3 4`. That gives osu!'s own outer/inner rhythm.
  * Images, colours, widths, body styles and upscroll flips all come from the matching 4K column. The stage stays centred where the skin put its 4K stage.
  * Columns keep their width until the stage would get too wide. After that the columns and keys shrink together, so receptors stay the same shape as the notes.
  * Settings → Skin → "Play 4K skins at every key count" turns it off. The Skins page marks these key counts as built from the 4K layout.
* **`skin.ini` files saved as UTF-16** (Windows Notepad's "Unicode") are now read. Before, their whole configuration was ignored.

### A new Custom skin, and gameplay sizing across all three skins

* **The Custom skin is rebuilt in osu!lazer's Argon style.**
  * Notes have a gradient face with a bright hit edge. Bars carry a chevron; circles, diamonds and arrows get a highlight rim.
  * Holds are darkened with accent-coloured edges and a proper tail cap.
  * The hit target is a see-through copy of the note on a glowing grey line, above a key panel with Argon's three dots. It fills with the column's colour while pressed.
  * Columns are narrower (52px at 4K down to 35px at 9K+) and each is faintly tinted with its note colour.
  * Judgements read PERFECT / GREAT / GOOD / OK / MEH / MISS in lazer's colours.
  * Hit flashes now sit on the receptor instead of below it. Arrows use a round flash rather than an up-pointing one.
* **Hit lighting flips in upscroll**, as it does in osu!stable. Kori's flashes were drawing about 100px past its receptors.
* **Skin score fonts are sized by their digits, not their image.** Chemuss's digits have lots of empty padding, so its score and accuracy showed at about a third of the size. They now match the other skins.
* **Menu notifications clear when a map starts**, instead of sitting over the score. In upscroll, the AUTO / REPLAY badge moves below the stage so it doesn't cover the keys.

### Upscroll fixed for every skin, instant Play from the beatmap listing, menu blur on Chromebooks

* **Upscroll now follows osu!'s rules for skins.** Key images and notes (heads, bodies, tails) are drawn upside down in upscroll unless the skin's `KeyFlipWhenUpsideDown` / `NoteFlipWhenUpsideDown` say not to, including the per-column versions (`…#`, `…#D`, `…#H`, `…#L`, `…#T`). Stage lights, the stage hint and the stage bottom flip too, so they face the receptors.
  * Before, Kori's receptors sat near the bottom of the screen in upscroll, and Chemuss's rings were cut off at the top edge. Both now line up with where notes are hit.
* **Switching skins mid-game no longer crashes** ("The image source is detached"). The old skin's images are now released at the next screen change instead of straight away.
* **Play in the beatmap listing** switches the background and song to that map straight away. It also no longer briefly resumes the song that was playing before the preview.
* **Background blur works in Chromebook mode.** The blur is now drawn once into a small copy of each background instead of being a live full-screen blur, so it costs nothing while you browse (and is cheaper on PC too). Chromebook setup keeps blur on, and Chromebooks that had it switched off get it back once.

### New profile pictures

* The free profile pictures are now the Teto, Neru and Miku pictures in `public/avatars/` (256×256), replacing the drawn ones. If you had picked one of the old drawn avatars, you get that character's new picture automatically.

### osu!lazer dialogs, notifications, menus and mod select

* **Tooltips are lazer's**: a dark grey box with rounded corners that follows the mouse. The first one waits a moment, and moving to the next button shows its tooltip straight away. The browser's own yellow tooltips no longer appear.
* **Basic controls follow lazer everywhere**: thin rounded grey scrollbars that turn white on hover; text boxes with an italic placeholder and a yellow outline while typing (the page's colour inside a page); buttons with 5px corners and bold text; switches and slider handles drawn as lazer's white-bordered "nub" pills.
* **Dialogs are lazer's popup dialogs**: a dark plum box with faint triangles and a white icon ring (trash for deletions, a pencil for names, a question mark otherwise). Under the title and text sit big slanted buttons that widen and glow at the sides when hovered: pink to confirm, blue to cancel, red for anything destructive.
* **Notifications drop in at the top right**, under the toolbar, like lazer's toasts. Each has an icon column and a glowing light on the left edge: blue for info, green for success, red for errors.
* **Right-click menus** use lazer's dark teal-grey context menu. Items go bold when hovered, and "Delete" shows in red.
* **Mod select is sheared like lazer's**, in its green colour scheme. The columns, mod panels and multiplier boxes are all slanted (the text stays upright), and each mod panel has its acronym in a darker switch area.
* Primary buttons inside a page take that page's colour, as lazer's rounded buttons do.
* **Song select's footer** has lazer's new footer buttons: slanted tiles (Mods, Random, Options) standing up out of the footer bar, each with an icon, its label and a coloured bar (lime, blue, purple). The **back** button everywhere uses lazer's pink.
* **The player loader is lazer's**: the logo, then the title and artist in big italics. A rounded cover strip underneath shows the loading state; below it sit the difficulty with its star rating, a Source / Mapper / Length / BPM / Notes list, and your mods. All of it is centred on screen. The settings on the right are lazer's see-through toolbox groups ("Visual Settings", "Audio Settings") with yellow sliders.
* Notifications step out of the way while the now-playing panel or a menu is open at the top right, as lazer's toast tray does. The now-playing panel shows the track's cover brighter, with lazer's yellow progress bar.
* **Multiplayer room**: the Ready and Start match buttons are lazer's big slanted buttons, and match results use rank pills. Fixed a stray "null" printed next to the room code (and the multiplayer test now checks the room for stray text).
* **The first-run setup** looks like lazer's: a "first-run setup" header, the step's title, a slanted grey Back button and a wide purple **Next (Appearance)** button that names the next step.

### osu!lazer-style overlays: library, collections, profile, replays, skins, beatmap listing, multiplayer

* **Every page now opens like an osu!lazer overlay**: a patterned cover strip, a title band with the page's icon and lowercase title ("beatmap library", "skins"…) and its buttons, over a solid body.
* **Each page has its own lazer colour scheme**, and its cards, rows, inputs and buttons take on that colour:
  * Blue: beatmap library and beatmap listing (the explorer);
  * Pink: profile;
  * Plum: replays and multiplayer;
  * Orange: skins;
  * Aquamarine: collections.
* **The profile is lazer's player page:**
  * your latest play's background as the cover, with a big avatar, your name and an osu!mania tag;
  * a strip with play count, play time and lazer's gold **level hexagon** and progress bar;
  * the detail area: performance and accuracy in big numbers, your SS / SS (Hidden) / S / S (Hidden) / A counts as lazer rank pills, and the stat list;
  * a **sticky section bar** (historical / ranks / recent) with lazer's headings and counters;
  * score rows with the pp in a slanted dark block on the right, like lazer's.
* **The beatmap listing's filters** sit in a full-width dark band under a big search box. Rows are labelled like lazer's, and the chosen option in each row is bold with an underline.
* Rank pills show SS / S lettering in gold and the Hidden variants in silver-blue, as lazer does.

### osu!lazer-style settings

* The settings panel follows osu!lazer's current settings, in lazer's purple settings colours:
  * a 60px icon sidebar that marks the section you're reading;
  * a big lowercase **settings** header with "change the way Ashtonk!mania behaves" under it;
  * sections under a thin separator, with large titles and lazer-sized group headings.
* **Every setting is one of lazer's form controls**: a rounded box with its caption (and hint) inside, 4px apart. It gets a border on hover and a bright one while you're using it.
  * Switches are lazer's outlined pill, which fills in when on. Clicking anywhere on the box flips it.
  * Sliders show the caption and value on the left and a tall rounded track with a slim nub on the right.
  * Dropdowns and text fields show the caption on top and the value underneath.
* **Revert to default** is lazer's slim pill just right of any setting you've changed; click it to put the default back.

### osu!lazer-style song select

* Song select now copies osu!lazer's new song select, using its sizes, offsets and colours (the blue-grey "Blue" overlay scheme).
* **Left side, three slanted panels over the beatmap background:**
  * **Title wedge**: the title, artist, your play count, favourite and collection buttons, length and BPM.
  * **Difficulty display**, in the difficulty's star colour: the star rating, difficulty name, mapper, note and hold-note counts, and Keys / HP drain / Accuracy bars.
  * **Ranking**: a slanted tab, with your scores as slanted rows and lazer's coloured rank pills.
* **Right side, a carousel of panels that run off the right edge**, like lazer's:
  * **Beatmap sets** are 80px, with the cover under lazer's diagonal dark gradient, the title, artist and a dot per difficulty. The open set shows a white chevron strip.
  * **Difficulties** are 50px, with a strip in the difficulty colour, a tint of that colour, your best rank, "[4K] name mapped by …", the star pill and a star counter.
  * **Spacing and offsets**: sets overlap by 3px and difficulties sit 3px apart. Anything not selected slides right, as in lazer, so the open set and the selected difficulty stick out.
  * **Selection and hover**: the selected panel gets a glow and a sweep of light; hovering gives lazer's faint blue.
* **The filter bar is a slanted panel** hanging from the top right, with a slanted search box and dropdowns.
* **No more curved list**: the carousel is straight, as in lazer. Scrolling costs a quarter of the style work it did, since rows no longer move sideways as they scroll.
* **Animations**: the wedges slide in when song select opens and simply fade on later selections.

### osu!lazer-style results

* The results screen is now lazer's score panel: your name and picture on a strip coloured by your grade, then the beatmap, the **accuracy circle**, mods, the score counting up, accuracy / max combo / pp and every judgement count.
* The accuracy circle follows osu!lazer's layout. Your accuracy fills the thick outer ring in lazer's cyan-to-green. The grade thresholds are coloured segments just inside it, with SS shown as a 1% sliver so it's visible. Each rank's badge pops in as the fill passes it, so only the ranks you reached appear. The grade then lands in the middle in its lazer colour (SS pink, S teal, A green, B gold, C orange, D red).
* The hit distribution and the other graphs sit in a **Statistics** panel beside it (below it on narrow screens). Everything fits on a 1366×768 laptop screen.

### Chemuss mixed edit comes with the game

* **A second built-in skin: "Chemuss mixed edit"** (Quadrasphinix by [LS]Cr1tikal with Chemuss's orb mania edit). It installs on its own the next time the game opens (Kori stays selected; pick it in **Skins** or Settings → Skin). It ships as a 350 KB mania-only trim (`public/skins/chemuss.osk`).
* Checked in play at 4K, the key count it's made for: orb notes, blue hold heads, grey ring receptors, black lanes, no hit lighting and no MAX judgement pop-up, just as the skin sets it up. Other key counts use the default notes, as in osu!, because the skin has no art for them.
* **Notes are hit on the rings**: with the skin's HitPosition of 458, notes landed about 10 units (of osu!'s 480) below the ring receptors. The shipped copy uses 448, which centres them on the rings (checked to within half a unit). Copies installed before this get the corrected skin.ini automatically.
* In the first-run setup the skins are listed Kori, Chemuss mixed edit, then Custom.
* For key counts a skin has no key art for, the built-in keys now sit with their receptor on the hit line (they were placed by legacy-skin rules and ended up below it).

### osu!lazer-style pause and fail screens

* Pausing or failing now looks like osu!lazer: a plain dark overlay, lowercase **paused** / **failed** with lazer's lines ("you're not going to do what i think you're going to do, are ya?" / "you're dead, try again?"), and its wide slanted buttons: green Continue, yellow Retry, red Quit, which widen and glow when hovered.
* Making it work fixed skin loading for every skin:
  * **Duplicate [Mania] sections**: this skin has two `Keys: 4` sections, and only the first one's images exist. When a skin repeats a key count, the section whose images are actually in the skin is used (otherwise the last one, as in osu!lazer).
  * **Lists given twice fill in** instead of replacing: `ColumnLineWidth: 0,0,0,0,0` followed later by `ColumnLineWidth: 0,0` keeps all five at 0, as in osu!. It used to draw stray lines between columns.
  * **`null` / `none` / `_blank` image names hide the element** (lighting here) instead of falling back to the default art.
  * **Huge textures are capped at 8192 px** (this skin's hold body is 148×20000, beyond what GPUs accept).
  * **The top-level `skin.ini` is used** when an `.osk` carries leftover ones in sub-folders (this one has two).

### Runs much better on slow devices

* **Gameplay drawing is about 6× cheaper.** On a slow Chromebook-sized setup (1366×768, CPU slowed 4×, the Kori skin, a dense 7K stream), the playfield canvas took 8.4 ms of pixel work per frame, and the game's own JavaScript was only a small part of that. Over half the time went on hit lighting: Kori's glow images are 92–97% fully transparent padding, and they were rescaled and blended at 368×446 px up to six times a frame. Lighting and the stage light are now drawn from pre-scaled copies cropped to their visible pixels: **8.4 ms → 1.75 ms per frame**, with the same picture (mean pixel difference 0.08 / 255).
* **Keys too**: Kori's key images are 89–91% empty, and all seven were copied at full size every frame; they're cropped the same way. Together: **8.4 ms → 1.3 ms of drawing per frame**.
* **Automatic resolution** (Settings → Graphics, on by default): on a device that can't keep up (under ~45 fps for two 2-second stretches in a row), the playfield is drawn at 10% lower resolution, down to 60%, and the device remembers it; after a play that runs smoothly all the way through it tries 5% higher next time. The pixel count is most of what's left on slow hardware.
* **Results on the simulated slow device** (1366×768, Kori, a dense 7K stream, CPU slowed with Chrome's throttling): at 4× slower, **16 fps → 55 fps**; at 6× slower, **10 fps → 50 fps** (settling at 70% resolution). At full speed it's a steady 60.
* No more forced page layouts during play: the skin health bar measured its container every frame, and the replay bar checked hover state every frame.
* The hidden replay bar no longer re-lays out the page 10 times a second while watching Auto or a replay.
* **Smoother menus**: the loading screen's logo kept its "breathing" animation running forever after the game had loaded, restyling the page every frame on every screen (gameplay included); it's removed after the fade. Changing beatmap in song select updates the rows already on screen instead of rebuilding them twice (4.3 → 1.6 ms of script per change).

### Share your results

* **Share** on the results screen makes a 1200×630 picture of the play: the beatmap's background, grade, score, accuracy, max combo, pp, UR, every judgement count, mods and who played it. **Copy image** puts it on the clipboard to paste into Discord or anywhere else; **Save PNG** downloads it; **Share…** opens the system share sheet where the browser has one.

### osu!lazer standardised score

* **Settings → Gameplay → Score display** (under *Show all settings*): *Classic (ScoreV1)*, as before, or *osu!lazer standardised*: 150,000 for combo (each hit's score × log₄ of the combo, capped at 400) and 850,000 × accuracy^(2 + 2·accuracy) — the formula from osu!lazer's mania score processor.
* Every play records both scores. The HUD, the in-game and song select leaderboards, personal bests, results, replays and the profile all follow the chosen display. Scores from before this update keep their classic score. Multiplayer matches always use classic, so both players see the same numbers.

### Install it, play offline

* **Installable app**: Ashtonk!mania now has an app manifest and icons, so Chrome, Edge and ChromeOS offer to install it (the install icon in the address bar, or **Settings → Maintenance → Install as an app** when the browser offers it). The installed app opens in its own full-screen window.
* **Plays offline**: once the game has been opened, a service worker keeps it, so it opens and plays your library with no connection. Online, the page is always fetched fresh first, so a new deploy still shows up on the next load. Searches, downloads and multiplayer (`/api/*`) are never cached.
* **Open beatmaps with it**: the installed app is registered for `.osz`, `.osk` and `.amr` files; opening one (for example by double-clicking in the ChromeOS Files app) imports it.

### Invert and No Release mods

* **Invert** (IN, osu!lazer): "Hold the keys. To the beat." In each column every note becomes a long note that lasts until the next one, shortened by a quarter beat (at most by half) so there's always a moment to let go; the last note of each column is dropped, and the map has no breaks.
* **No Release** (NR, osu!lazer, ×0.9): no more timing the end of long notes. Keep holding through the end for a MAX; a hold you let go of and grabbed again still gets a 50.
* Both follow osu!lazer's own code, and star rating and pp for Invert and Hold Off plays are now worked out on the converted notes.

### Keyboard shortcuts list

* Press **?** anywhere outside a text field (or **Settings → Input → Keyboard shortcuts**) for every shortcut in one place: anywhere, main menu, song select, playing, practice, watching replays and results.

### Replay controls

* **Watch replays (and Auto) like osu!lazer's replay player**: a bar at the bottom (it appears when you move the mouse) with a timeline showing the note density.
  * **Seek**: click or drag the timeline, or press **←** / **→** to jump 5 seconds. The replay is re-judged up to that point, so score, combo and health are exactly what they were there, and the replay still ends with its original result.
  * **Pause**: **Space** or the pause button. Space still skips the intro while it can; Esc opens the pause menu.
  * **Speed**: 0.25× to 2× from the buttons, or **↓** / **↑**. Switching is instant.

### Sturdier: storage, errors, offline

* **Failing looks right**: the stage now slows down with the song as it winds down, sinks and dims (like osu!lazer's fail animation), and stays where you failed. Before, the notes kept scrolling at full speed and then jumped back to the start of the song behind the fail menu. Retrying within that second no longer cuts off the new song's audio.

* **Broken beatmap files can't crash the game**: 8,000 randomly corrupted `.osu` files were run through everything from parsing to scoring. Two crashes and one silent problem turned up and are fixed: a garbage key count is now reported as a problem, notes timed hours past anything real are dropped (one could freeze the star rating), and OD / HP outside 0–10 are clamped like osu!'s editor does (OD 81.5 used to make every note a miss). The fuzz test now runs with the unit tests.

* **Works even when the browser blocks storage** (some private windows, or site data blocked): the game boots, says clearly that nothing will be saved, and keeps beatmaps, scores and settings in memory for the session instead of failing.
* **One broken record can't break the library**: each part of the saved data (settings, skins, beatmaps, scores, replays, collections, profile) loads on its own. If one fails, the rest still load and a notice says which part failed.
* **Reconnects to storage** if the browser closes the database connection in the background (it used to fail until reload).
* **Clear error messages**: storage full, no connection, audio a browser can't decode and unreadable files now say what happened and what to do, instead of showing raw browser errors. Anything unexpected shows a short "Something went wrong" notice (never during play) instead of failing silently.
* **Keeps your library**: after your first import the game asks the browser to keep its storage (so it isn't cleared when the disk gets full).
* **Offline explorer**: the Beatmap Explorer says you're offline, has a *Try again* button, and searches again by itself when the connection comes back.
* **Audio interruptions pause the game**: if the browser suspends audio mid-song (another app takes the output), a solo play pauses instead of the notes freezing. Hiding the tab in a multiplayer match no longer pauses you out of sync with the room.

### The skin's own health bar

* **Health bars come from the skin**: a skin with `scorebar-bg` / `scorebar-colour` gets its own bar in the top-left corner, the way osu!lazer shows legacy skins. The fill eases to the new value, and the marker (`scorebar-marker`, or `scorebar-ki` / `kidanger` / `kidanger2` for older skins) rides its end and swells when health goes up.
* **Kori 3.0 now has its health bar**: the bundled copy includes Kori's scorebar images. Kori installed before this update gets them added automatically once, the next time the game opens online.
* **The skin preview shows it too** (Skins screen and setup), rising and falling so the skin's low-health look is visible.
* **Settings → Gameplay → Health bar style**: *From the skin* (the default; skins without one use the osu!lazer bar), *Skin, beside stage* (upright next to the stage, like osu!stable mania), *osu!lazer*, or *Slim, beside stage*.
* **Smoother HUD**: the skin-font score and accuracy no longer resize their canvas every time a digit is added, which cut layout work during play from about 84 to 3 per 5 seconds.

### Gameplay checked against osu!lazer, browsing like Web-Osu-Mania

* **Judging now follows osu!lazer's own source code** (ppy/osu mania ruleset), checked rule by rule:
  * a late note is missed once it's past the 50 window (a late press in the miss window used to count as a miss);
  * note lock: once the next note in a column has started, the earlier one is missed and your press hits the new one (jacks feel much fairer);
  * hold notes: an early-miss head still starts the hold (tail capped at 50), a hold held too long is missed at 1.5× the 50 window after its end, a dropped hold can be grabbed again until the 50 window after its end, letting go early breaks combo only once, and misses on either end of a hold cost half a note of health;
  * hit windows are `floor(window × rate) + 0.5` like lazer, and Hard Rock / Easy scale the windows (÷1.4 / ×1.4) instead of changing OD;
  * misses from several columns are judged in time order; Perfect and Sudden Death also fail when a hold is let go early; grades use 95 / 90 / 80 / 70% *and up*.
* **Old replays still replay exactly as recorded**: new replays store the rules they were played with (`rules: 2`); older ones keep the previous rules (checked against the old engine on 3,000 random plays: identical).
* **Scroll speed matches osu!lazer and WOM**: the on-screen speed no longer depends on the skin's judgement-line height (Kori's 4K/7K lines made notes 8–14% faster). BPM lines after the last note no longer affect the main BPM.
* **Two keys on one column** work properly: the column stays held until both are released.
* **Beatmap Explorer browses like Web-Osu-Mania's home screen**: with an osu! API key set up (see *Hosting*), a search is exactly the osu! API request WOM makes — category, genre, language, explicit content, stars and key filters, `sort` only when you pick one (so text searches are ranked by relevance), cursor paging — cached for an hour, with WOM's back-off when osu! rate-limits (the mirrors answer meanwhile). New filters: genre, language, explicit content, 1K–18K, and Reset filters; a new sort starts newest/highest first and a second click flips it.
* **11K–18K are playable**: they now have default keys (Web-Osu-Mania's layouts), and the key configuration and skin preview go up to 18K.
* **Polish**: missed notes fade out as they scroll away (osu!lazer), beatmap sets show their genre and language, the player loader no longer shows a stray "null", and mod descriptions match the new rules.
* **Beatmap sources** (Settings → Maintenance): download source (Mino, NeriNyan, SayoBot, osu.direct, Nekoha or a custom `$setId` URL), download through the server on/off, audio preview source (osu!, Beatconnect, SayoBot, custom) and cover image source (osu!, SayoBot, custom).

### Search sorting fixed, osu!lazer health bar, sharper Neru, full beatmap covers

* **Rating and Relevance sorting work again:** the mirrors don't all accept those sorts, and some reject them outright, which made every provider fail. Now, if a mirror refuses a sort, the Worker asks it again in its default order and sorts that page itself. Rating is worked out from the vote counts when a mirror doesn't send it. Relevance uses the mirror's own order for a text search and puts the best title/artist matches first. Each mirror request also times out after 9 seconds, so one slow mirror can't hold up the others. The explorer does the same when it talks to the mirrors directly.
* **osu!lazer health bar:** a thin glowing bar in the top-left corner. It eases to the new value, a red trail shows what a miss just took, and it turns red and pulses when health is low.
* **Skin health bars:** a skin with its own `scorebar-bg` / `scorebar-colour` (animated frames too) gets its health bar drawn the way osu!stable does in mania: standing upright beside the stage and filling upwards. **Settings → Gameplay → Health bar style** picks between the skin's own bar (the osu!lazer one if the skin has none, the default), always osu!lazer, or the old slim bar beside the stage.
* **Sharper Neru:** both menu pictures were upscaled with an anime line-art upscaler (Real-ESRGAN anime model, about 2.4× the old size) and cut out again along her outlines. The whole figure is kept (hands and cardigan included), the edges are anti-aliased without a pink fringe, and where the original picture cuts her off at the sides she fades out instead of ending in a hard edge.
* **Full beatmap covers:** explorer cards now show the whole cover at its real 20:7 shape instead of cropping it, and hovering brightens it instead of zooming in. Covers fall back through the smaller sizes when a set has no high-res one. The beatmap set overlay shows more of its cover too.

### Hold R to retry

* Retrying mid-play needs a hold: keep **R** (or `` ` ``) down for half a second while the retry bar fills, and let go early to cancel. A quick tap, or Ctrl+R, no longer restarts instantly (Ctrl+R counts as holding R and doesn't reload the page). If R is bound to a lane, it stays a lane key.

### Faster dense charts, Hidden fixed for holds, skin fonts, a Kori-style Custom skin

* **Smart culling / faster dense charts:**
  * Notes and keys are drawn from copies pre-scaled to their exact on-screen size, at whole-pixel positions, instead of resampling the texture for every note.
  * Each note's scroll position is computed once per play.
  * Only the newest hit-light per column is drawn, so streams no longer stack flashes.
  * At most ~96 particles are alive at a time.
  * Score and accuracy text updates about 20× a second.
  * On a dense 7K stream with the CPU slowed 4×, typical frame time went from ~84 ms to ~46 ms, and the worst frames from ~142 ms to ~71 ms.
* **Hidden / Fade In and hold notes:** hold notes are now drawn band by band. The covered part of the lane really hides the body; a visible head no longer drags its body through the cover.
* **Skin fonts:** the in-game score and accuracy (and the results score) use the skin's number font (`ScorePrefix` from `skin.ini`, e.g. Kori's `fonts/score/score-*.png`). The combo already used `ComboPrefix`.
* **More skin sounds:**
  * `sectionpass` / `sectionfail` at breaks
  * `count3s`, `count2s`, `count1s` and `gos` on the unpause countdown and the multiplayer start
  * `pause-hover` and the `pause-continue/retry/back-click` sounds on the pause menu

  These play only when the skin has them.
* **Custom skin restyled after Kori:**
  * flat, soft note shapes with a gentle glow (no outlines or gradients) in all four shapes; bars are now rounded pills
  * dark, accent-tinted hold bodies with rounded caps
  * thin outline receptors that light up when pressed
  * a near-black stage
  * a small white hit flash, and corner brackets while holding
  * pastel lowercase judgement words
* **Back to top:** now a dark round button in the bottom-right that glows in the accent colour on hover.
* The Teto easter egg is gone.

### Neru fixes, Teto easter egg, reconnecting

* **Neru's hands:** the cut-out no longer eats into her hands (the background removal stops at skin tones), and the faint border line at the bottom is gone.
* **Difficulty picker:** in a multiplayer room, "Your difficulty" only shows when the beatmap set has more than one playable difficulty.
* **Reconnecting:** if your connection to a room drops, the room stays on screen with a small "Reconnecting…" marker while the game keeps retrying (1s, 2s, 4s… up to 10s apart). There's no error popup. When it gets back in you see "Reconnected to the room", and your difficulty and mods are sent again. If everyone left in the meantime, the room is reopened under the same code. If a match is still running, it waits for the match to end.

### Multiplayer mods and skip voting

* **Mods in multiplayer:** the room's **Mods** button opens the mod select. Mods that don't change the song's speed (Hidden, Hard Rock, Mirror, Random…) are yours alone; everyone sees them next to your name. The room panel shows the room's **Speed** and **Your mods**.
* **Speed mods need everyone:** DT, NC, HT, DC and Rate apply to the whole room, so choosing one starts a vote. The others see "*name* wants to play with DT" with **Accept** / **Decline**. It applies once everyone accepts, and any decline cancels it. Start is blocked while a vote is open. Removing a speed mod works the same way. Picking a new beatmap keeps the room's current speed.
* **Skip needs everyone:** in a match, `Space` (or the Skip button) votes to skip the intro, and the button shows the count (1/2). The intro is skipped for everyone once every player has voted.

### Neru on the menu, only playable difficulties, faster gameplay

* **Neru on the main menu:** the game now ships with two Neru pictures, with their backgrounds removed. One is `public/neru.png`, where she stands in the corner. The other is `public/neru-happy.png`, which she switches to for a moment when you click her.
* **Only playable difficulties:** difficulties that can't be played (other game modes, missing audio…) aren't imported any more. They're only mentioned in the Beatmaps screen's import report. An archive with nothing playable is rejected. Unplayable difficulties stored by older versions are removed on startup.
* **Faster gameplay:** the playfield canvas now covers only the stage (plus room for the health bar and key display) instead of the whole screen. That cuts the pixels cleared, drawn and composited every frame to about a third on a 16:9 screen. The canvas size is cached with a ResizeObserver instead of being measured every frame. The progress bar and pie update 4 times a second, and live pp is only recalculated when a note is judged.

### Profile pictures, back to top, pink logo

* **Free profile pictures:** click your avatar on the profile page, or use **Profile picture** in the setup's "Make it yours" step. You can pick one of six built-in avatars (two each of Miku, Teto and Neru), upload your own, or go back to your initial. To offer more pictures to everyone, put image files in `public/avatars/` and list them in `public/avatars/avatars.json`, e.g. `[{ "file": "miku-3.png", "name": "Miku" }]`. They then appear in the picker.
* **Back to top:** after you scroll a good way down the Beatmap Explorer, a round button appears at the bottom that scrolls back to the top.
* **Logo:** the Ashtonk!mania logo stays pink whatever accent colour you choose.

### Cleaner HUD, Neru on the main menu

* **Removed from the HUD:** the keys-per-second counter, the judgement counter and the hit error bar.
* **Neru on the main menu:** Neru stands in the bottom-left corner of the menu, sways gently and hops when you click her. She has no speech bubbles. The picture comes from **Settings → Interface → Main menu character image**, or from a `neru.png` (or `.webp` / `.gif` / `.jpg`) placed in `public/` next to `index.html`. If there's no picture, nothing is shown. You can turn her off with **Show Neru on the main menu**.

### Simpler setup, Custom skin, invites

* **Simpler first-run setup:** you type your name, then choose **Set it up** or **Skip**. Setting up takes four short steps:
  1. **PC** or **Chromebook**. Chromebook turns on performance mode, lighter backgrounds, no menu blur and a render scale that fits the screen.
  2. **Colour and size:** pick an accent colour and set the interface size with a slider.
  3. **Scroll speed and background:** scroll speed (22 by default), background dim and blur, and scroll direction, all with a live preview.
  4. **Skin:** **Kori**, **Custom**, or **Import a skin**.

  **Finish** takes you straight to the main menu. You can run it again from **Settings → Maintenance**.
* **Accent colours:** Kori (the default), Neru, Teto and Miku. The logo follows the accent colour.
* **Custom skin:** the built-in skin is now called Custom. It has the note shapes from Web-Osu-Mania (bars, circles, diamonds and arrows) and a note colour you can pick with a hue slider or match to your accent colour, using Web-Osu-Mania's single-colour lane scheme. You can also turn darker hold notes on or off.
* **Invites:** the room's **Invite** button lists players who are online right now, marked as online, in a room or playing. You can invite any of them, and they get a **Join** prompt. You can still copy an invite link instead. Presence runs on the existing Matchmaker Durable Object, so no new migration is needed.
* **Beatmap Explorer ordering like Web-Osu-Mania:** it uses osu!'s categories, and the default is **Has leaderboard**. Sorting uses `criteria_asc/desc` (newest ranked first by default); clicking the active sort flips its direction, and Relevance appears once you type a search. The mirror that served the first page also serves the following pages. Results are re-sorted after each page, so the order stays consistent even when a mirror ignores the sort.
* **Fixes:** the empty FPS box no longer sits in the bottom-right corner when the FPS counter is off. The explorer's header no longer floats as a dimmed box over the beatmap cards.

### First-run setup, player loader, new beatmap cards

* **First-run setup:** the first time the game opens, a short setup walks you through the basics. It's now the simpler flow above.
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
  * an osu!lazer-style leaderboard on the left in gameplay (your local scores for the map, with your live score climbing through them); Tab shows or hides it
  * Alt+wheel volume
* **Gamepad controls.**
* **Background videos** (mp4/webm).
* **New mods:** Perfect (SS), Accuracy Challenge, Difficulty Adjust (OD/HP), Song Speed (0.5–2×), Percy, and coverage amount for Hidden and Fade In.

## Getting started

1. Open `index.html`. Type your name, then set the game up (PC or Chromebook, colour, scroll speed, skin) or skip straight to the menu.
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
| Multiplayer match | `Esc` quit the match (counts as a loss) — there is no pause or retry · `Space` votes to skip the intro (everyone has to) |
| Search syntax | `keys=7 stars>4 bpm>=180 length<120 od>8 ln>30 played=0 creator=name` |
| Player loader | `Space` start now · `Esc` back to song select · hover the settings to hold |
| Gameplay | lane keys (default 4K `D F J K`, 7K `S D F Space J K L`, 8K `A S D F J K L ;`) · `Esc` pause · hold `R` (or `` ` ``) to retry — a tap does nothing · `Space` skip intro · `F3`/`F4` or `Ctrl −`/`Ctrl +` scroll speed · `Tab` leaderboard · `Shift+Tab` HUD |
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
node --test tests/*.test.mjs        # engine, parser (incl. corrupted-file fuzzing), Worker and multiplayer room unit tests
node tests/make-fixtures.mjs        # generate synthetic .osz/.osk fixtures
node tests/e2e.mjs --shots          # headless Chromium end-to-end run (Playwright)
node tests/monkey.mjs [steps] [seed]  # random clicks, keys, plays and resizes; fails on any page error
MINIFLARE_DIR=<dir> node tests/mp-e2e.mjs   # two browsers play a match against the real Worker + Durable Objects
```

`tests/mp-e2e.mjs` needs `miniflare` installed somewhere (`npm i miniflare` in any folder, then point `MINIFLARE_DIR` at it). It runs `worker/index.js` in workerd and checks rooms, chat, map selection, ready/start, the synchronised start, the live scoreboard, results, forfeits, room song search (library and online, suggestions and picks), host hand-over, quick match, and invites (to online players and by link).

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
* **First-run setup:** name validation, the set-up-or-skip choice, the PC/Chromebook presets, the four accent colours and size slider, the gameplay preview, the Kori/Custom/Import skin step with Custom's options, finishing on the main menu, and choices persisting without the setup coming back.
* **Explorer ordering:** the default "Has leaderboard" category with newest ranked first, and title sorting in both directions.
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
