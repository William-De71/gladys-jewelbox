// Widget contents for the generated illustrations, built by the real code of
// the integration: the app itself (src/app.js) wired to the fake Gladys of the
// SDK and to the fake JewelBox server of the tests
// (test/helpers/fake-jewelbox.js), on a fixed date. Five cards:
//   playing      "JewelBox player": a desktop player in the middle of a track
//   collection   "CD collection": counters, albums by decade, top genres
//   loans        "Lent albums": two loans, one overdue
//   today        "Album of the day"
//   recent       "Recently added": a poster grid
// Every album, artist and borrower is invented, and the covers are plain
// generated pictures (covers/<n>.png, made by render.sh): never real artwork.
// Written as JSON for render.js: node gen.mjs <repo> <covers dir> <out.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [repo, coversDir, out] = process.argv.slice(2);
const load = (file) => import(pathToFileURL(join(repo, file)).href);
const { createApp } = await load('src/app.js');
const { memoryStorage } = await load('src/storage.js');
const { LANGUAGES } = await load('src/i18n.js');
const { coverKey } = await load('src/widgets.js');
const { createFakeJewelBox, makeAlbum, sqlDate } = await load('test/helpers/fake-jewelbox.js');
const { createFakeGladys } = await import(
  pathToFileURL(join(repo, 'node_modules/@gladysassistant/integration-sdk/lib/testing.js')).href
);

const manifest = JSON.parse(readFileSync(join(repo, 'gladys-assistant-integration.json'), 'utf8'));
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const DAY = 24 * 3600 * 1000;

// Saturday 24 October 2026, 21:12 in Paris.
let clock = Date.UTC(2026, 9, 24, 19, 12, 0);
const server = createFakeJewelBox({ now: () => clock });

const images = {};
const cover = (n) => {
  const hash = createHash('md5').update(`cover-${n}`).digest('hex');
  const url = `/covers/${hash}.png`;
  images[coverKey(url)] =
    `data:image/png;base64,${readFileSync(join(coversDir, `${n}.png`)).toString('base64')}`;
  return url;
};
const artists = [
  'Les Cendres Bleues',
  'Nordlys',
  'Velvet Harbor',
  'Marée Basse',
  'Old Lantern',
  'Kaskade Noire',
];
const titles = [
  ['Nuit d’ambre', 1998, 'Rock'],
  ['Polar Hymns', 2004, 'Post-rock'],
  ['Salt & Static', 2011, 'Indie rock'],
  ['Le Phare', 1994, 'Rock'],
  ['Ember Rooms', 2019, 'Folk'],
  ['Cendrillon électrique', 2001, 'Rock'],
  ['Northbound', 2008, 'Post-rock'],
  ['Les Heures creuses', 2023, 'Chanson'],
  ['Glass Tides', 1989, 'New wave'],
  ['Brume', 2015, 'Post-rock'],
  ['Fumée blanche', 2026, 'Rock'],
  ['Copper Moon', 2026, 'Folk'],
];
let id = 1;
server.state.albums = titles.map(([title, year, genre], index) =>
  makeAlbum({
    id: id++,
    title,
    year,
    genre,
    rating: 3 + (index % 3),
    artist: { id: (index % artists.length) + 1, name: artists[index % artists.length] },
    label: { id: 1, name: 'Phare Records' },
    cover_url: cover(index % 8),
    created_at: sqlDate(clock - (titles.length - index) * 6 * DAY),
    is_wanted: index === 10,
  }),
);
// More albums so the counters look like a real shelf.
for (let n = 0; n < 640; n += 1) {
  server.state.albums.push(
    makeAlbum({
      id: id++,
      title: `Album ${n}`,
      year: 1970 + ((n * 7) % 56),
      genre: ['Rock', 'Post-rock', 'Folk', 'Chanson', 'Indie rock', 'Jazz'][n % 6],
      artist: { id: 10 + (n % 230), name: `Artist ${n % 230}` },
      created_at: '2025-01-01 10:00:00',
      is_wanted: n % 8 === 0,
    }),
  );
}
Object.assign(server.state.albums[3], {
  is_lent: true,
  lent_to: 'Julie',
  lent_at: new Date(clock - 41 * DAY).toISOString(),
});
Object.assign(server.state.albums[4], {
  is_lent: true,
  lent_to: 'Thomas',
  lent_at: new Date(clock - 6 * DAY).toISOString(),
});
server.state.suggestions = [server.state.albums[1]];
const PLAYER_ID = '249102a0-f41b-4c4c-b17a-ec3eee29edf4';
server.state.queues.set(PLAYER_ID, {
  label: 'JewelBox bureau · fedora',
  source: 'Polar Hymns',
  index: 2,
  position: 96,
  updatedAt: clock - 30 * 1000,
  tracks: ['Aurora', 'Ice Choir', 'The Long Night', 'Thaw'].map((title, n) => ({
    id: 100 + n,
    title,
    duration: 320,
    album_id: 2,
    album_title: 'Polar Hymns',
    artist_name: 'Nordlys',
    cover_url: server.state.albums[1].cover_url,
  })),
});

const gladys = createFakeGladys({
  config: { language: 'en', server_url: 'http://10.0.20.21:3001' },
});
const app = createApp(gladys, {
  storage: memoryStorage(),
  fetch: server.fetch,
  now: () => clock,
  timeZone: 'Europe/Paris',
  logger: silent,
});
await gladys.connect();
await app.start();
const player = gladys.fake.discoveredDevices.find((d) => d.external_id.includes(PLAYER_ID));
await gladys.fake.deviceCreated(structuredClone(player));
clock += 1000;
await app.playerRound();
// A second write, 30 s later: the position moved, the player plays.
clock += 29 * 1000;
Object.assign(server.state.queues.get(PLAYER_ID), { position: 126, updatedAt: clock });
await app.playerRound();
await app.collectionRound();

const cards = {
  playing: ['now_playing', { player: player.external_id }],
  collection: ['collection', {}],
  loans: ['loans', {}],
  today: ['album_of_the_day', {}],
  recent: ['recently_added', { list: 'all' }],
};
const contents = Object.fromEntries(LANGUAGES.map((language) => [language, {}]));
for (const language of LANGUAGES) {
  for (const [name, [key, settings]] of Object.entries(cards)) {
    const ack = await gladys.fake.widgetGet(key, { settings, language });
    if (!ack.success) throw new Error(`${name}: ${ack.error}`);
    contents[language][name] = ack.data.content;
  }
}
await app.stop();
await gladys.fake.shutdown();

const declaration = (key) => manifest.widgets.find((widget) => widget.key === key);
writeFileSync(
  out,
  JSON.stringify({
    contents,
    images,
    cards: Object.fromEntries(
      Object.entries(cards).map(([name, [key]]) => [
        name,
        { icon: declaration(key).icon, label: declaration(key).label },
      ]),
    ),
  }),
);
