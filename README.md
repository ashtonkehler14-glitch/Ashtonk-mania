# Ashtonk!mania

A mania rhythm game that runs in your browser, made to look and feel like osu!lazer. It is not affiliated with osu!.

## Play

Open `index.html` in Chrome, Edge, Firefox or Safari. Drag `.osz` beatmaps or `.osk` skins onto the window to add them, or find songs with **Browse**. Everything is saved in your browser.

Coming from Web-Osu-Mania? Export a backup there (Settings → Backup & Restore) and import it here. Your songs, scores, collections, keybinds and skin come with it.

## Host it

`npx wrangler deploy` puts it on Cloudflare: the game, beatmap search and downloads, and online multiplayer.

The beatmap listing comes from osu! itself, the same way Web-Osu-Mania gets it, so the server needs an osu! API key:

1. On osu.ppy.sh, open **Settings → OAuth → New OAuth Application** and copy the Client ID and Secret.
2. Run `npx wrangler secret put OSU_CLIENT_ID` and `npx wrangler secret put OSU_CLIENT_SECRET`.

Downloads come from mirror sites (catboy.best and others) and need no key.

While osu! refuses your server (it often refuses logins from Cloudflare's shared addresses), the list comes from Web-Osu-Mania's own server instead. To stop relying on it, give osu! requests an address of their own: like Web-Osu-Mania, set `OSU_API_PROXY_URL` (and `OSU_API_PROXY_KEY` if it needs one). `proxy/osu-proxy.js` is a ready-made one (instructions at its top). A second OAuth app, added as `OSU_CLIENT_ID_2` and `OSU_CLIENT_SECRET_2`, takes over when osu! refuses the first one's logins.

## Develop

```bash
node build.mjs                                 # build index.html from src/
node --test tests/*.test.mjs                   # unit tests
node tests/e2e.mjs                             # browser tests
MINIFLARE_DIR=<dir> node tests/mp-e2e.mjs      # multiplayer tests
```

## Credits

- Formulas and the Web-Osu-Mania skins (arrows, judgement sets, Roboto Mono) are from [Web-Osu-Mania](https://github.com/hectickiwi/Web-Osu-Mania) by Danny Duong, MIT License. Its judgement sets credit their skin authors in `public/wom/CREDITS.txt`.
- The menu cursor and its sound are from [osu-resources](https://github.com/ppy/osu-resources) by ppy, CC BY-NC 4.0.
- 《NM》 Kori 3.0 skin by Kori.
