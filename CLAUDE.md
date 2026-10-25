# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A **personal** Gladys Assistant external integration for **JewelBox Music
Library** (https://github.com/William-De71/Jewelbox-Music-Library, the CD
collection app of the same author): a Node.js service (Node 22+, ESM, no build
step) in its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency, and to the JewelBox server on the local network
(REST `/api`, no authentication, port 3001; `transports: ["local"]`).
`type: "device"`, Gladys 5.3.0+ (widgets, scenes, mediated mDNS, music players:
`"music": {}`, now playing and artwork only).

**Never in the store.** The repository is public (Gladys pulls the image
anonymously and reads the manifest of `main`), but it must never carry the
`gladys-assistant-integration` topic: the `verify` job of `release.yml` fails
if it does. Installed from the URL of the repository.

Tested against a real JewelBox 1.17.0 (read-only run, 2026-10-24); the tests
use a fake server (`test/helpers/fake-jewelbox.js`) with the same shapes.

## Commands

```bash
npm install
npm test                                  # node --test; the fake JewelBox server, never the network
node --test test/app.test.js              # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/discovery.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # manifest checks
scripts/build-cover.sh                    # cover.jpg from the JewelBox icon
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js              SDK wiring only: createApp(gladys) + connect + start
src/app.js            every handler: locate the server (typed address, /data, mDNS),
                      player rounds (10 s), collection rounds (1 min), states, scene
                      events and actions, widgets, cover images, configuration button
src/client.js         HTTP client of JewelBox (X-Device-Id header, typed errors,
                      server clock from the Date header), SQLite dates
src/playback.js       is a player playing? deduced from the queue writes (pure)
src/collection.js     what changed between two readings: added, left the wish
                      list, lent, returned, overdue (pure)
src/devices.js        the collection and player devices, feature values, the
                      now playing snapshot of publishNowPlaying (nowPlayingOf)
src/scenes.js         trigger / action keys, event data, player transitions
src/widgets.js        the five widgets (pure, reused by docs/illustrations), cover keys
src/states.js         state publication: created devices only, coalesced, 240/min, 429 pause
src/storage.js        /data: server.json, reminders.json
src/config.js         address, language, loan reminder, age of the players offered
src/i18n.js           runtime texts, en / fr
test/helpers/fake-jewelbox.js   the fake JewelBox server of the tests and illustrations
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: the
  collection is `ext:<selector>:collection:<server_id>`, a player
  `ext:<selector>:player:<device_id>` (stable ids JewelBox keeps, never an
  address or a label), the
  feature keys, their `category` / `type` / `unit` / `min` / `max`, the keys of
  `config_schema` and `actions`, the widgets and their settings, the triggers
  (fields, variables), the scene actions (fields, outputs).
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update it to make a test pass
  without a documented migration.
- **Read-only devices.** JewelBox cannot command a player; `onSetValue`
  refuses. Controlling the players needs a command channel in JewelBox first
  (server + web app + desktop + Android). So no `music` operation is declared
  (no browse / search / queue / play), and no music box on the dashboard (it
  needs `play` or a writable `playback_state`).
- **Now playing** goes through `gladys.publishNowPlaying` (diff, one batch),
  only for created players, from the rounds and at a device creation: never
  on a timer of its own. The playback state stays the `playing` feature of
  0.1.0 (`max: 1` forever: stopped is 0, never IDLE 2), mapped with
  `featureExternalIds`; the `music_*` features are additions. The text
  features `track` / `artist` / `album` stay (scenes use them) and still go
  through `src/states.js`. Clearing a `music` text is `''` (5.3.0 accepts it),
  unlike the text features (`NO_TEXT`).
- **Writes to JewelBox** only from the scene actions `lend_album`,
  `return_album` and `scan_library`, never from a round or a widget.
- **Scene events** come from the rounds only: never at the first reading,
  never when the active collection changed, never for a bulk import
  (`MAX_ADDED`), never for a change made by a scene action (the base is
  updated at once: no loop).
- **Covers**: an image key is built from the file name of a JewelBox cover
  (`jb-<md5>-<ext>`) and the handler rebuilds the path from the key alone:
  never fetch another URL. 300 KB at most (no resize: no native module).
  The player artwork key is the SDK's (`artworkKey` of the cover path
  `/covers/<md5>.<ext>`); `onMusicGetArtwork` reads the path back from
  `gladys.artworkUrls` and checks it with the same rules.
- **No empty text state** (Gladys would drop it): `NO_TEXT`.
- **The container rootfs is read-only.** Write only under `/data`.
- **Two languages**, those of JewelBox: every user-facing text (manifest,
  `src/i18n.js`, `docs/*.md`, README) exists in en and fr;
  `test/i18n.test.js` checks it.
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at both PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Assumptions

- The players write their position every 10 s (web app) or 30 s (desktop,
  Android) while playing and once at a pause (JewelBox 1.17.0). If a player
  changes its pace, `src/playback.js` learns it (60 s at most).
- `updated_at` of a queue is UTC without zone (SQLite `datetime('now')`);
  `lent_at` is an ISO date.
- Album ids only grow within a collection (SQLite AUTOINCREMENT): a new id
  above the largest seen is an addition.

## Pitfalls

- The containers of integrations cannot see multicast: the mDNS scan goes
  through `gladys.scanNetwork('mdns')` (declared in `network_discovery`), at
  most once per 5 minutes when the server is lost.
- JewelBox in Docker without `network_mode: host` announces nothing on the
  LAN: the address must be typed.
- `/api/player/queue/devices` gives no position: the queue of a created
  player is read again only when its `updated_at` or index changed.
- The genre filter of `/api/albums` is case-sensitive: `random_album` maps the
  genre typed in a scene to the exact one first (`/api/albums/genres`).
- A card-list subtitle is 60 characters at most (the borrower is cut first).
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
