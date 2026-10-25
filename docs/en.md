# JewelBox

## Overview

Your JewelBox Music Library CD collection in Gladys: the counters of the shelf, the loans, what the JewelBox players play, five dashboard widgets, scene triggers and actions. The JewelBox server is found on the local network by mDNS; nothing leaves the local network (transport `local`).

This is a personal integration, not listed in the store: install it from the URL of its repository.

## Prerequisites

- Gladys 5.3.0 or later.
- JewelBox Music Library 1.17.0 or later on the same network, with its mDNS announcement on (the default). JewelBox in Docker: `network_mode: host`, or type its address in the configuration.

## Configuration

| Field                 | Default | Role                                                 |
| --------------------- | ------- | ---------------------------------------------------- |
| Server address        | empty   | empty: found by mDNS; else `http://host:3001`        |
| Language of the texts | French  | names of the devices, statuses, texts of the actions |
| Loan reminder (days)  | 30      | delay of the “Loan overdue” trigger                  |
| Players shown (days)  | 90      | the Discover tab offers the players used lately      |

Save, then click **Test the connection**: it finds the server and tells the collection, the number of albums and the players seen.

## Usage

### Devices

In the **Discover** tab, add:

- **JewelBox collection**: albums, wish list, lent out, artists, average rating, playing time (hours), oldest loan (days). Read every minute.
- **One device per player** (web app, desktop, Android): playback, track, artist, album, and the now playing of Gladys music players (title, artist, album, cover, duration, position). Read every 10 s, published only when it changes.

A player is “playing” when its position moves at its usual pace: JewelBox stores no play / pause state, so a pause is seen 10 to 50 s late. The players cannot be controlled from Gladys: the “devices in the room” widget shows what they play, the music box of the dashboard does not offer them. A player added before this version gets its new features with the **Update** button of the Discover tab.

### Dashboard widgets

![The five widgets (generated illustration, not a screenshot)](https://raw.githubusercontent.com/William-De71/gladys-jewelbox/main/docs/assets/widgets.en.png)

Generated illustration, not a screenshot (invented albums, plain covers).

- **JewelBox player**: cover, track, artist, album, state.
- **CD collection**: counters, albums by decade, top genres, average rating.
- **Lent albums**: who has which album, since when; orange past the reminder delay.
- **Album of the day**: the suggestion of the day of JewelBox; “Another album” draws one at random.
- **Recently added**: the covers of the latest albums (collection, wish list or both).

### Scenes

Triggers: album added, album lent, album returned, loan overdue, playback started, playback stopped, new track. A loan or a return made by a scene action fires nothing (no loop).

Actions: what is playing, random album (optional genre), album of the day, lend an album, mark it returned (by album id — the number in its JewelBox address — or exact title), scan the music library.

Examples: when an album is lent, send a message “{{triggerEvent.data.title}} lent to {{triggerEvent.data.borrower}}”; when a loan is overdue, send a reminder; every Sunday, send the album of the day.

## Troubleshooting

- **No JewelBox server found**: check that JewelBox runs and announces itself (`avahi-browse -rt _jewelbox._tcp`), or type its address.
- **A player stays “stopped”**: it has not saved a position lately; start playing again.
- **No cover**: the cover is not stored on the JewelBox server, or weighs over 300 KB.
- Logs: Settings → Supervision.
