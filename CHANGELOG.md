# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.5.0] - 2026-10-27

### Added

- sleep timer scene action for the JewelBox players ([99bc596](https://github.com/William-De71/gladys-jewelbox/commit/99bc59637986b44507af44072653daec6241387d))

## [0.4.0] - 2026-10-26

### Added

- control the JewelBox players from Gladys (playback, volume, modes, catalog, queue) ([6b14049](https://github.com/William-De71/gladys-jewelbox/commit/6b14049f6fa45997e2e5b0d86be10e87ddc2e3ef))

## [0.3.0] - 2026-10-25

### Added

- declare catalog keywords for Gladys 5.3 ([f019b42](https://github.com/William-De71/gladys-jewelbox/commit/f019b42343b36a7d2ddf517f0ba07abd0b99d024))

## [0.2.0] - 2026-10-25

### Added

- publish the now playing of the players as Gladys music features ([36b27fd](https://github.com/William-De71/gladys-jewelbox/commit/36b27fd3adebde0fc42781c5f7ca0183a6c64b3b))

## [0.1.0] - 2026-10-24

### Added

- **discovery:** the JewelBox Music Library server found on the local network by mDNS (`_jewelbox._tcp`) through the core of Gladys, confirmed by its `server_id` and remembered in `/data`; an address to type as a fallback
- **collection:** a device with the albums, the wish list, the albums lent out, the artists, the average rating, the hours of music and the days of the oldest loan
- **players:** one device per JewelBox player (web app, desktop, Android) with the playback state, the track, the artist and the album, deduced from the queues the players save (read-only)
- **scenes:** triggers when an album is added (or a wished album bought), lent, returned, overdue, and when a player starts, stops or changes track; actions to read a player, draw a random album, get the album of the day, lend or return an album and scan the music library
- **widgets:** the player with its cover, the collection (counters, albums by decade, top genres), the lent albums, the album of the day with an "Another album" button, the recently added covers
- **i18n:** English and French, the languages of JewelBox

[0.5.0]: https://github.com/William-De71/gladys-jewelbox/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/William-De71/gladys-jewelbox/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/William-De71/gladys-jewelbox/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/William-De71/gladys-jewelbox/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/William-De71/gladys-jewelbox/releases/tag/v0.1.0
