# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-10-24

### Added

- **discovery:** the JewelBox Music Library server found on the local network by mDNS (`_jewelbox._tcp`) through the core of Gladys, confirmed by its `server_id` and remembered in `/data`; an address to type as a fallback
- **collection:** a device with the albums, the wish list, the albums lent out, the artists, the average rating, the hours of music and the days of the oldest loan
- **players:** one device per JewelBox player (web app, desktop, Android) with the playback state, the track, the artist and the album, deduced from the queues the players save (read-only)
- **scenes:** triggers when an album is added (or a wished album bought), lent, returned, overdue, and when a player starts, stops or changes track; actions to read a player, draw a random album, get the album of the day, lend or return an album and scan the music library
- **widgets:** the player with its cover, the collection (counters, albums by decade, top genres), the lent albums, the album of the day with an "Another album" button, the recently added covers
- **i18n:** English and French, the languages of JewelBox

[0.1.0]: https://github.com/William-De71/gladys-jewelbox/releases/tag/v0.1.0
