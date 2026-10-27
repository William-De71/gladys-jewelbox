// The integration end to end: the real app, the fake Gladys of the SDK and the
// fake JewelBox server (test/helpers/fake-jewelbox.js), on a fake clock. No
// network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createApp, REMINDERS_FILE, SERVER_FILE } from '../src/app.js';
import { memoryStorage } from '../src/storage.js';
import { WIDGETS } from '../src/widgets.js';
import {
  BASE,
  COVER,
  SERVER_ID,
  createFakeJewelBox,
  makeAlbum,
  sqlDate,
} from './helpers/fake-jewelbox.js';

const START = Date.UTC(2026, 9, 24, 16, 0, 0);
const DAY = 24 * 3600 * 1000;
const COLLECTION = `ext:test-integration:collection:${SERVER_ID}`;
const PLAYER_ID = '249102a0-f41b-4c4c-b17a-ec3eee29edf4';
const PLAYER = `ext:test-integration:player:${PLAYER_ID}`;
const MDNS = [
  {
    name: 'JewelBox Music Library',
    host: 'njord.local',
    addresses: ['fe80::1', '10.0.20.21'],
    port: 3001,
    txt: [`id=${SERVER_ID}`, 'api=/api', 'version=1.17.0', 'app=jewelbox'],
  },
];
const TRACKS = [
  {
    id: 4955,
    title: 'Revelation',
    duration: 300,
    album_id: 7,
    album_title: 'Heaven Upside Down',
    artist_name: 'Marilyn Manson',
  },
  {
    id: 4956,
    title: 'WE KNOW WHERE YOU FUCKING LIVE',
    duration: 280,
    album_id: 7,
    album_title: 'Heaven Upside Down',
    artist_name: 'Marilyn Manson',
  },
  {
    id: 4957,
    title: 'SAY10',
    duration: 258,
    album_id: 7,
    album_title: 'Heaven Upside Down',
    artist_name: 'Marilyn Manson',
  },
];

async function setup(t, options = {}) {
  let clock = options.start ?? START;
  const server = createFakeJewelBox({ now: () => clock });
  server.state.albums = options.albums ?? [
    makeAlbum({ id: 1, title: 'Blackwater Park', year: 2001, genre: 'Progressive Metal' }),
    makeAlbum({
      id: 2,
      title: 'Damnation',
      year: 2003,
      genre: 'Progressive Metal',
      created_at: '2026-02-01 10:00:00',
    }),
    makeAlbum({
      id: 3,
      title: 'Brave Murder Day',
      year: 1996,
      genre: 'Doom Metal',
      artist: { id: 2, name: 'Katatonia' },
      is_wanted: true,
      created_at: '2026-03-01 10:00:00',
    }),
  ];
  if (options.queue !== false) {
    server.state.queues.set(PLAYER_ID, {
      label: 'JewelBox bureau · wsmd-fed-2',
      index: 0,
      position: 12,
      updatedAt: clock - 5000,
      tracks: TRACKS,
      ...(options.queue ?? {}),
    });
  }
  // JewelBox 1.18 (remote control): the live state of the players.
  if (options.remote) server.state.remote = options.remote(clock);
  const gladys = createFakeGladys({
    config: { language: 'en', ...(options.config ?? {}) },
    devices: options.devices ?? [],
    scanResults: { mdns: options.mdns ?? MDNS },
  });
  const storage = options.storage ?? memoryStorage();
  const logs = [];
  const logger = Object.fromEntries(
    ['info', 'warn', 'error', 'debug'].map((level) => [
      level,
      (...args) => logs.push(args.join(' ')),
    ]),
  );
  const app = createApp(gladys, {
    storage,
    fetch: server.fetch,
    now: () => clock,
    random: options.random ?? (() => 0),
    sleep: async () => {},
    timeZone: 'Europe/Paris',
    logger,
  });
  await gladys.connect();
  await app.start();
  t.after(async () => {
    await app.stop();
    await gladys.disconnect();
  });
  return {
    server,
    gladys,
    app,
    storage,
    logs,
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
  };
}

const create = async ({ gladys }, externalId) => {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === externalId);
  assert.ok(device, externalId);
  await gladys.fake.deviceCreated(structuredClone(device));
};
const events = (gladys, key) => gladys.fake.sceneEvents.filter((event) => event.key === key);
const flush = async ({ app }) => {
  await app.states.flush();
};

test('start: the server found by mDNS (IPv4 first), confirmed, remembered, devices offered', async (t) => {
  const { gladys, app, storage } = await setup(t);
  assert.equal(app.server.url, BASE);
  assert.equal(app.server.serverId, SERVER_ID);
  assert.deepEqual(storage.files[SERVER_FILE], { server_id: SERVER_ID, url: BASE });
  assert.deepEqual(
    gladys.fake.scans.map((scan) => scan.type),
    ['mdns'],
  );
  const devices = gladys.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.external_id),
    [COLLECTION, PLAYER],
  );
  assert.equal(devices[0].name, 'JewelBox collection');
  assert.equal(devices[1].name, 'JewelBox bureau · wsmd-fed-2');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('start: the address remembered in /data is tried before any mDNS scan', async (t) => {
  const storage = memoryStorage({ [SERVER_FILE]: { server_id: SERVER_ID, url: BASE } });
  const { gladys, app } = await setup(t, { storage, mdns: [] });
  assert.equal(app.server.url, BASE);
  assert.equal(gladys.fake.scans.length, 0);
});

test('start: the address typed in the configuration is the only one used', async (t) => {
  const { gladys, app, server } = await setup(t, {
    config: { server_url: '10.0.20.21' },
    mdns: [],
  });
  assert.equal(app.server.url, BASE, 'http:// and port 3001 added');
  assert.equal(gladys.fake.scans.length, 0);
  server.state.up = false;
  await gladys.fake.configUpdated({ server_url: 'http://10.0.20.99:3001' });
  assert.equal(app.reachable, false);
  assert.equal(gladys.fake.scans.length, 0, 'never mDNS when an address is typed');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /does not answer at http:\/\/10\.0\.20\.99:3001/,
  );
});

test('no server on the network: a status that says what to do', async (t) => {
  const { gladys, app } = await setup(t, { mdns: [] });
  assert.equal(app.server, null);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /Aucun serveur JewelBox/);
  const ack = await gladys.fake.sceneAction('random_album', {});
  assert.equal(ack.success, false);
  assert.match(ack.error ?? JSON.stringify(ack), /No JewelBox server|Pas de serveur/);
});

test('mDNS: a service that is not JewelBox, or another server, is left out', async (t) => {
  const { app } = await setup(t, {
    mdns: [
      { name: 'Other', addresses: ['10.0.20.50'], port: 3001, txt: ['app=other'] },
      { name: 'Broken', addresses: ['10.0.20.51'], port: 0, txt: ['app=jewelbox'] },
      ...MDNS,
    ],
  });
  assert.equal(app.server.url, BASE);
});

test('collection device: counters, rating, playing time, oldest loan', async (t) => {
  const ctx = await setup(t);
  await create(ctx, COLLECTION);
  await flush(ctx);
  const value = (key) => ctx.gladys.fake.lastState(`${COLLECTION}:${key}`);
  assert.equal(value('owned'), 2);
  assert.equal(value('wanted'), 1);
  assert.equal(value('lent'), 0);
  assert.equal(value('artists'), 1);
  assert.equal(value('rating'), 4);
  assert.equal(value('play_time'), 12.5);
  assert.equal(value('oldest_loan'), 0);
});

test('album_added: never at the first reading; collection, wish list, a wish come true', async (t) => {
  const ctx = await setup(t);
  assert.equal(events(ctx.gladys, 'album_added').length, 0);
  ctx.server.state.albums.push(
    makeAlbum({ id: 10, title: 'Ghost Reveries', created_at: '2026-10-24 16:00:30' }),
    makeAlbum({
      id: 11,
      title: 'Viva Emptiness',
      is_wanted: true,
      artist: { id: 2, name: 'Katatonia' },
      created_at: '2026-10-24 16:00:40',
    }),
  );
  ctx.server.state.albums.find((album) => album.id === 3).is_wanted = false;
  ctx.advance(60000);
  await ctx.app.collectionRound();
  const added = events(ctx.gladys, 'album_added').map((event) => event.data);
  assert.deepEqual(
    added.map((data) => [data.album_id, data.list, data.from_wishlist]),
    [
      [10, 'owned', false],
      [11, 'wanted', false],
      [3, 'owned', true],
    ],
  );
  assert.equal(added[0].title, 'Ghost Reveries');
  assert.equal(added[0].artist, 'Opeth');
  assert.equal(added[1].artist, 'Katatonia');
  ctx.advance(60000);
  await ctx.app.collectionRound();
  assert.equal(events(ctx.gladys, 'album_added').length, 3, 'once');
});

test('album_added: a bulk import, an album deleted from the wish list, another collection: nothing', async (t) => {
  const ctx = await setup(t);
  for (let id = 100; id < 115; id += 1) {
    ctx.server.state.albums.push(
      makeAlbum({ id, created_at: `2026-10-24 16:00:${String(id - 90).padStart(2, '0')}` }),
    );
  }
  ctx.server.state.albums = ctx.server.state.albums.filter((album) => album.id !== 3);
  ctx.advance(60000);
  await ctx.app.collectionRound();
  assert.equal(events(ctx.gladys, 'album_added').length, 0);
  assert.ok(ctx.logs.some((line) => /15 albums added at once/.test(line)));
  ctx.server.state.db = { id: 3, name: 'vinyls' };
  ctx.server.state.albums = [makeAlbum({ id: 500 })];
  ctx.advance(60000);
  await ctx.app.collectionRound();
  assert.equal(events(ctx.gladys, 'album_added').length, 0);
});

test('loans: lent, returned with its days, a lent album deleted is not a return', async (t) => {
  const ctx = await setup(t);
  const album = ctx.server.state.albums[0];
  Object.assign(album, {
    is_lent: true,
    lent_to: 'Julie',
    lent_at: new Date(ctx.now() - 3 * DAY).toISOString(),
  });
  ctx.advance(60000);
  await ctx.app.collectionRound();
  const [lent] = events(ctx.gladys, 'album_lent');
  assert.deepEqual(
    [lent.data.title, lent.data.borrower, lent.data.days],
    ['Blackwater Park', 'Julie', 3],
  );
  Object.assign(album, { is_lent: false, lent_to: null, lent_at: null });
  ctx.advance(60000);
  await ctx.app.collectionRound();
  const [returned] = events(ctx.gladys, 'album_returned');
  assert.deepEqual([returned.data.borrower, returned.data.days], ['Julie', 3]);
  const other = ctx.server.state.albums[1];
  Object.assign(other, {
    is_lent: true,
    lent_to: 'Max',
    lent_at: new Date(ctx.now()).toISOString(),
  });
  ctx.advance(60000);
  await ctx.app.collectionRound();
  ctx.server.state.albums = ctx.server.state.albums.filter((item) => item !== other);
  ctx.advance(60000);
  await ctx.app.collectionRound();
  assert.equal(events(ctx.gladys, 'album_returned').length, 1);
});

test('loan_overdue: once per loan, even after a restart; the reminder is forgotten at the return', async (t) => {
  const albums = [
    makeAlbum({
      id: 1,
      title: 'Brave',
      is_lent: true,
      lent_to: 'Julie',
      lent_at: new Date(START - 31 * DAY).toISOString(),
    }),
    makeAlbum({
      id: 2,
      title: 'Recent',
      is_lent: true,
      lent_to: 'Max',
      lent_at: new Date(START - 2 * DAY).toISOString(),
    }),
  ];
  const storage = memoryStorage();
  const ctx = await setup(t, { albums, storage });
  const overdue = events(ctx.gladys, 'loan_overdue');
  assert.deepEqual(
    overdue.map((event) => [event.data.title, event.data.days]),
    [['Brave', 31]],
  );
  assert.equal(storage.files[REMINDERS_FILE].loans.length, 1);
  await create(ctx, COLLECTION);
  await flush(ctx);
  assert.equal(ctx.gladys.fake.lastState(`${COLLECTION}:oldest_loan`), 31);

  // A restart: the reminder is not sent again.
  const again = await setup(t, { albums: structuredClone(albums), storage });
  assert.equal(events(again.gladys, 'loan_overdue').length, 0);

  // Returned: the key leaves /data.
  again.server.state.albums[0].is_lent = false;
  again.server.state.albums[0].lent_at = null;
  again.advance(60000);
  await again.app.collectionRound();
  assert.deepEqual(storage.files[REMINDERS_FILE].loans, []);
});

test('lend_album / return_album: by id or exact title, outputs, no event of their own', async (t) => {
  const ctx = await setup(t);
  const lend = await ctx.gladys.fake.sceneAction('lend_album', {
    album: 'blackwater park',
    borrower: 'Julie',
  });
  assert.equal(lend.success, true, JSON.stringify(lend));
  assert.deepEqual(
    [lend.data.outputs.album_id, lend.data.outputs.title, lend.data.outputs.borrower],
    [1, 'Blackwater Park', 'Julie'],
  );
  assert.equal(ctx.server.state.albums[0].lent_to, 'Julie');
  ctx.advance(60000);
  await ctx.app.collectionRound();
  assert.equal(events(ctx.gladys, 'album_lent').length, 0, 'no loop');

  const twice = await ctx.gladys.fake.sceneAction('lend_album', { album: '1', borrower: 'Max' });
  assert.equal(twice.success, false);
  assert.match(JSON.stringify(twice), /already lent to Julie/);

  ctx.advance(2 * DAY);
  const back = await ctx.gladys.fake.sceneAction('return_album', { album: '1' });
  assert.equal(back.success, true, JSON.stringify(back));
  assert.deepEqual([back.data.outputs.borrower, back.data.outputs.days], ['Julie', 2]);
  ctx.advance(60000);
  await ctx.app.collectionRound();
  assert.equal(events(ctx.gladys, 'album_returned').length, 0, 'no loop');
});

test('lend_album: unknown, ambiguous, wished album, no borrower', async (t) => {
  const ctx = await setup(t);
  ctx.server.state.albums.push(
    makeAlbum({ id: 20, title: 'Damnation', artist: { id: 3, name: 'Other' } }),
  );
  const error = async (fields) => {
    const ack = await ctx.gladys.fake.sceneAction('lend_album', fields);
    assert.equal(ack.success, false);
    return JSON.stringify(ack);
  };
  assert.match(await error({ album: 'Nope', borrower: 'Julie' }), /No album “Nope”/);
  assert.match(await error({ album: '999', borrower: 'Julie' }), /No album “999”/);
  assert.match(await error({ album: 'Damnation', borrower: 'Julie' }), /2 albums are called/);
  assert.match(await error({ album: 'Brave Murder Day', borrower: 'Julie' }), /wish list/);
  assert.match(await error({ album: '1', borrower: '  ' }), /to whom/);
});

test('random_album: genre without case, wish list excluded; album_of_the_day; scan_library', async (t) => {
  const ctx = await setup(t, { random: () => 0.99 });
  const random = await ctx.gladys.fake.sceneAction('random_album', { genre: 'progressive metal' });
  assert.equal(random.success, true, JSON.stringify(random));
  assert.equal(random.data.outputs.title, 'Damnation');
  assert.equal(random.data.outputs.summary, 'Opeth – Damnation (2003)');
  const none = await ctx.gladys.fake.sceneAction('random_album', { genre: 'Jazz' });
  assert.match(JSON.stringify(none), /No album of the genre “Jazz”/);
  const day = await ctx.gladys.fake.sceneAction('album_of_the_day', {});
  assert.equal(day.data.outputs.title, 'Blackwater Park');
  const scan = await ctx.gladys.fake.sceneAction('scan_library', {});
  assert.deepEqual(scan.data.outputs, {
    finished: true,
    matched_albums: 10,
    matched_tracks: 120,
    unmatched_files: 2,
  });
});

test('players: playing, new track, pause write, stop after the pace of the player', async (t) => {
  const ctx = await setup(t);
  await create(ctx, PLAYER);
  await ctx.app.playerRound();
  await flush(ctx);
  const value = (key) => ctx.gladys.fake.lastState(`${PLAYER}:${key}`);
  assert.equal(value('playing'), 1, 'a write 5 s ago: playing at first sight');
  assert.equal(value('track'), 'Revelation');
  assert.equal(value('artist'), 'Marilyn Manson');
  assert.equal(value('album'), 'Heaven Upside Down');
  assert.equal(events(ctx.gladys, 'playback_started').length, 0, 'first sight is not a start');

  const queue = ctx.server.state.queues.get(PLAYER_ID);
  const write = (seconds, changes) => {
    ctx.advance(seconds * 1000);
    Object.assign(queue, { updatedAt: ctx.now(), ...changes });
  };
  // Continuous play, a write every 30 s: the pace is learned.
  write(30, { position: 42 });
  await ctx.app.playerRound();
  write(30, { position: 72 });
  await ctx.app.playerRound();
  assert.equal(ctx.app.playback.get(PLAYER_ID).interval, 30);
  // New track.
  write(10, { index: 1, position: 3 });
  await ctx.app.playerRound();
  const [changed] = events(ctx.gladys, 'track_changed');
  assert.equal(changed.data.title, 'WE KNOW WHERE YOU FUCKING LIVE');
  assert.equal(changed.data.player, PLAYER);
  assert.equal(changed.data.player_name, 'JewelBox bureau · wsmd-fed-2');
  // Pause: a write sooner than the pace.
  write(30, { position: 33 });
  await ctx.app.playerRound();
  write(12, { position: 45 });
  await ctx.app.playerRound();
  assert.equal(ctx.app.playback.get(PLAYER_ID).playing, false);
  assert.equal(events(ctx.gladys, 'playback_stopped').length, 1);
  // Play again after the pause.
  ctx.advance(300000);
  write(30, { position: 75 });
  await ctx.app.playerRound();
  assert.equal(events(ctx.gladys, 'playback_started').length, 1);
  // Closed: no write any more.
  ctx.advance(51000);
  await ctx.app.playerRound();
  assert.equal(events(ctx.gladys, 'playback_stopped').length, 2);
  await flush(ctx);
  assert.equal(value('playing'), 0);
  assert.equal(value('track'), 'WE KNOW WHERE YOU FUCKING LIVE', 'the last track stays');
});

test('now playing: music features in one batch, the position on events only, artwork by key', async (t) => {
  // publishNowPlaying measures the drift of the position on Date: the same
  // fake clock as the app and the server.
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const ctx = await setup(t);
  const step = (ms) => {
    ctx.advance(ms);
    t.mock.timers.tick(ms);
  };
  const feature = (key) => `${PLAYER}:${key}`;
  const value = (key) => ctx.gladys.fake.lastState(feature(key));
  const positions = () =>
    ctx.gladys.fake.states.filter(
      (s) => s.device_feature_external_id === feature('music_position'),
    );
  await ctx.app.playerRound();
  assert.equal(value('music_title'), undefined, 'nothing for a player not created');

  await create(ctx, PLAYER);
  await ctx.app.playerRound();
  assert.equal(value('playing'), 1);
  assert.equal(value('music_title'), 'Revelation');
  assert.equal(value('music_artist'), 'Marilyn Manson');
  assert.equal(value('music_album'), 'Heaven Upside Down');
  assert.equal(value('music_duration'), 300);
  assert.equal(value('music_position'), 17, 'saved 5 s ago at 12 s');
  const key = value('music_artwork');
  assert.match(key, /^art-[0-9a-f]{12}$/);
  await flush(ctx);
  assert.equal(value('track'), 'Revelation', 'the text features of 0.1.0 stay');

  // Continuous play: the rounds publish nothing new, the dashboard extrapolates.
  const queue = ctx.server.state.queues.get(PLAYER_ID);
  const before = ctx.gladys.fake.states.length;
  for (const position of [47, 87]) {
    step(30000);
    Object.assign(queue, { updatedAt: ctx.now(), position });
    await ctx.app.playerRound();
    step(10000);
    await ctx.app.playerRound();
  }
  await flush(ctx);
  assert.equal(ctx.gladys.fake.states.length, before, 'no position on a timer');

  // A seek is published (more than 3 s off), at the pace of the player.
  step(30000);
  Object.assign(queue, { updatedAt: ctx.now(), position: 200 });
  await ctx.app.playerRound();
  assert.equal(value('playing'), 1);
  assert.equal(value('music_position'), 200);

  // A new track: one batch, with its position.
  step(10000);
  Object.assign(queue, { updatedAt: ctx.now(), index: 1, position: 2 });
  await ctx.app.playerRound();
  const batch = ctx.gladys.fake.bodies('POST', '/state').at(-1).states;
  assert.deepEqual(batch.map((s) => s.device_feature_external_id.split(':').at(-1)).sort(), [
    'music_duration',
    'music_position',
    'music_title',
  ]);
  assert.equal(value('music_title'), 'WE KNOW WHERE YOU FUCKING LIVE');
  assert.equal(positions().at(-1).state, 2);

  // The artwork: the cover of the server behind the key, nothing else.
  const image = await ctx.gladys.fake.musicGetArtwork(key);
  assert.equal(image.success, true, JSON.stringify(image));
  assert.equal(image.data.image, ctx.server.state.coverBytes.toString('base64'));
  assert.equal((await ctx.gladys.fake.musicGetArtwork('art-000000000000')).success, false);

  // The queue cleared: texts emptied explicitly, the artwork too.
  ctx.server.state.queues.delete(PLAYER_ID);
  step(10000);
  await ctx.app.playerRound();
  assert.equal(value('playing'), 0);
  assert.equal(value('music_title'), '');
  assert.equal(value('music_artwork'), '');
  assert.equal(value('music_position'), 0);
});

test('players: an old queue at first sight is stopped; a queue cleared is stopped', async (t) => {
  const ctx = await setup(t, { queue: { updatedAt: START - 3600 * 1000 } });
  await create(ctx, PLAYER);
  await ctx.app.playerRound();
  assert.equal(ctx.app.playback.get(PLAYER_ID).playing, false);
  ctx.server.state.queues.delete(PLAYER_ID);
  await ctx.app.playerRound();
  await flush(ctx);
  assert.equal(ctx.gladys.fake.lastState(`${PLAYER}:track`), '–');
});

test('players: only those used lately are offered; two "Chrome" get their id', async (t) => {
  const ctx = await setup(t);
  const old = { label: 'Chrome', index: 0, position: 0, tracks: TRACKS };
  ctx.server.state.queues.set('edf9f4d3-8591-448b-a664-a3828a669244', {
    ...old,
    updatedAt: START - DAY,
  });
  ctx.server.state.queues.set('752cb897-2b04-4e2e-9613-0895d3a44f55', {
    ...old,
    updatedAt: START - 2 * DAY,
  });
  ctx.server.state.queues.set('f490e970-5c9d-4c9c-ad2d-3fb0228c26f3', {
    ...old,
    updatedAt: START - 200 * DAY,
  });
  await ctx.gladys.fake.scanRequest();
  const names = ctx.gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names.slice(1).sort(), [
    'JewelBox Chrome (752cb897)',
    'JewelBox Chrome (edf9f4d3)',
    'JewelBox bureau · wsmd-fed-2',
  ]);
});

test('get_now_playing: the player given, else the one playing', async (t) => {
  const ctx = await setup(t);
  const none = await ctx.gladys.fake.sceneAction('get_now_playing', {});
  assert.match(JSON.stringify(none), /No JewelBox player/);
  await create(ctx, PLAYER);
  const ack = await ctx.gladys.fake.sceneAction('get_now_playing', {});
  assert.deepEqual(ack.data.outputs, {
    player_name: 'JewelBox bureau · wsmd-fed-2',
    playing: true,
    title: 'Revelation',
    artist: 'Marilyn Manson',
    album: 'Heaven Upside Down',
  });
});

test('server down then back: status, no request storm, rounds again', async (t) => {
  const ctx = await setup(t);
  ctx.server.state.up = false;
  await ctx.app.collectionRound();
  assert.equal(ctx.app.reachable, false);
  assert.match(
    ctx.gladys.fake.connectionStatus.message.en,
    /does not answer at http:\/\/10\.0\.20\.21:3001 \(ECONNREFUSED\)/,
  );
  const widget = await ctx.gladys.fake.widgetGet(WIDGETS.COLLECTION, {});
  assert.match(JSON.stringify(widget.data.content), /does not answer/);
  ctx.server.state.up = true;
  ctx.advance(60000);
  await ctx.app.collectionRound();
  assert.equal(ctx.app.reachable, true);
  assert.deepEqual(ctx.gladys.fake.connectionStatus, { connected: true });
});

test('widgets: every content is valid, in both languages; covers by key only', async (t) => {
  const ctx = await setup(t);
  await create(ctx, PLAYER);
  ctx.server.state.albums[0].is_lent = true;
  ctx.server.state.albums[0].lent_to = 'Julie';
  ctx.server.state.albums[0].lent_at = new Date(START - 40 * DAY).toISOString();
  await ctx.app.collectionRound();
  for (const key of Object.values(WIDGETS)) {
    for (const language of ['en', 'fr']) {
      const ack = await ctx.gladys.fake.widgetGet(key, { language, settings: {} });
      assert.equal(ack.success, true, `${key} ${JSON.stringify(ack)}`);
      assert.deepEqual(validateWidgetContent(ack.data.content), [], `${key} ${language}`);
      assert.ok(ack.data.content.components.length > 0, key);
    }
  }
  const playing = await ctx.gladys.fake.widgetGet(WIDGETS.NOW_PLAYING, {
    language: 'fr',
    settings: { player: PLAYER },
  });
  const text = JSON.stringify(playing.data.content);
  assert.match(text, /En lecture/);
  assert.match(text, new RegExp(`jb-${COVER}-jpeg`));
  const loans = await ctx.gladys.fake.widgetGet(WIDGETS.LOANS, { language: 'fr' });
  assert.match(JSON.stringify(loans.data.content), /Julie depuis le/);
  assert.match(JSON.stringify(loans.data.content), /"color":"warning"/);

  const image = await ctx.gladys.fake.widgetGetImage(`jb-${COVER}-jpeg`);
  assert.equal(image.data.image, ctx.server.state.coverBytes.toString('base64'));
  assert.ok(ctx.server.calls.includes(`GET /covers/${COVER}.jpeg`));
  const refused = await ctx.gladys.fake.widgetGetImage('jb-..-etc-passwd');
  assert.equal(refused.success, false);
});

test('album of the day widget: another album, then back to the suggestion of the day', async (t) => {
  const ctx = await setup(t, { random: () => 0.6 });
  const title = async () =>
    (await ctx.gladys.fake.widgetGet(WIDGETS.ALBUM_OF_THE_DAY, {})).data.content.components[0].text;
  assert.equal(await title(), 'Blackwater Park');
  const toast = await ctx.gladys.fake.widgetAction(WIDGETS.ALBUM_OF_THE_DAY, 'another', {});
  assert.match(toast.data.message.en, /Here is Opeth – Damnation/);
  assert.equal(await title(), 'Damnation');
  await ctx.gladys.fake.widgetAction(WIDGETS.ALBUM_OF_THE_DAY, 'today', {});
  assert.equal(await title(), 'Blackwater Park');
});

test('test_connection: what the integration sees', async (t) => {
  const ctx = await setup(t);
  const ack = await ctx.gladys.fake.action('test_connection');
  assert.match(
    ack.data.message.en,
    /JewelBox Music Library 1\.17\.0 at http:\/\/10\.0\.20\.21:3001: collection “will_cd_collections”, 2 albums, 1 players seen/,
  );
});

test('read-only features: a command is refused', async (t) => {
  const ctx = await setup(t);
  await create(ctx, PLAYER);
  const device = ctx.gladys.fake.devices.find((d) => d.external_id === PLAYER);
  const ack = await ctx.gladys.fake.setValue(device, device.features[0], 1);
  assert.equal(ack.success, false);
});

test('sqlDate of the fake server is what SQLite writes', () => {
  assert.equal(sqlDate(START), '2026-10-24 16:00:00');
});

// --- Remote control (JewelBox 1.18) ------------------------------------------------------------

const LIVE_PLAYING = (clock, changes = {}) => ({
  playback_state: 'playing',
  position_sec: 40,
  duration_sec: 300,
  current_index: 0,
  volume: 70,
  muted: false,
  shuffle: false,
  repeat: 'off',
  reported_at: new Date(clock).toISOString(),
  track: {
    id: 4955,
    title: 'Revelation',
    duration: '5:00',
    album_id: 7,
    album_title: 'Heaven Upside Down',
    artist_name: 'Marilyn Manson',
    cover_url: `/covers/${COVER}.jpeg`,
  },
  ...changes,
});

const remoteSetup = (t, entry = {}) =>
  setup(t, {
    queue: {},
    remote: (clock) =>
      new Map([
        [
          PLAYER_ID,
          {
            label: 'JewelBox bureau · wsmd-fed-2',
            controllable: true,
            capabilities: [
              'seek',
              'volume',
              'mute',
              'shuffle',
              'repeat',
              'queue',
              'play_media',
              'append',
            ],
            state: LIVE_PLAYING(clock),
            ...entry,
          },
        ],
      ]),
  });

const playerDevice = (ctx) => ctx.gladys.fake.devices.find((d) => d.external_id === PLAYER);
const featureOf = (ctx, key) =>
  playerDevice(ctx).features.find((f) => f.external_id === `${PLAYER}:${key}`);

test('remote control: a controllable player gets its controls, remembered in /data', async (t) => {
  const ctx = await remoteSetup(t);
  await ctx.app.playerRound();
  const offered = ctx.gladys.fake.discoveredDevices.find((d) => d.external_id === PLAYER);
  const keys = offered.features.map((f) => f.external_id.split(':').at(-1));
  for (const key of ['next', 'previous', 'volume', 'mute', 'shuffle', 'repeat']) {
    assert.ok(keys.includes(key), key);
  }
  const playing = offered.features.find((f) => f.external_id.endsWith(':playing'));
  assert.equal(playing.read_only, false);
  assert.equal(playing.has_feedback, true);
  assert.deepEqual(
    playing.supported_options.map((o) => o.value),
    [0, 1],
  );
  assert.equal(
    offered.features.find((f) => f.external_id.endsWith(':music_position')).read_only,
    false,
  );
  assert.deepEqual(ctx.storage.files['players.json'], {
    capabilities: {
      [PLAYER_ID]: ['append', 'mute', 'play_media', 'queue', 'repeat', 'seek', 'shuffle', 'volume'],
    },
  });

  // Offline later (remote control turned off): the controls stay.
  ctx.server.state.remote.get(PLAYER_ID).controllable = false;
  await ctx.app.playerRound();
  const again = ctx.gladys.fake.discoveredDevices.find((d) => d.external_id === PLAYER);
  assert.equal(again.features.length, offered.features.length);
});

test('sleep_timer: a command to the player, every duration of the scene', async (t) => {
  const ctx = await remoteSetup(t, {
    capabilities: ['seek', 'volume', 'queue', 'play_media', 'append', 'sleep_timer'],
  });
  await ctx.app.playerRound();
  await create(ctx, PLAYER);
  const sent = [];
  for (const duration of ['30', 'end_of_track', 'cancel']) {
    const ack = await ctx.gladys.fake.sceneAction('sleep_timer', { player: PLAYER, duration });
    assert.equal(ack.success, true, JSON.stringify(ack));
    assert.deepEqual(ack.data.outputs, { player_name: 'JewelBox bureau · wsmd-fed-2' });
    sent.push(ctx.server.state.commands.at(-1));
  }
  assert.deepEqual(sent, [
    [PLAYER_ID, { command: 'sleep_timer', minutes: 30 }],
    [PLAYER_ID, { command: 'sleep_timer', end_of_track: true }],
    [PLAYER_ID, { command: 'sleep_timer', minutes: 0 }],
  ]);

  const bad = await ctx.gladys.fake.sceneAction('sleep_timer', {
    player: PLAYER,
    duration: 'soon',
  });
  assert.match(JSON.stringify(bad), /Unknown sleep timer duration/);

  // A player of an older JewelBox: refused by the server (422), said so.
  ctx.server.state.refuse = (body) =>
    body.command === 'sleep_timer' ? 'this player does not support sleep_timer' : null;
  const old = await ctx.gladys.fake.sceneAction('sleep_timer', { player: PLAYER, duration: '15' });
  assert.match(JSON.stringify(old), /cannot do that/);

  // Remote control turned off on the player.
  ctx.server.state.remote.get(PLAYER_ID).controllable = false;
  const offline = await ctx.gladys.fake.sceneAction('sleep_timer', { duration: '15' });
  assert.equal(offline.success, false);
});

test('remote control: an Android player (no mute) has no mute feature', async (t) => {
  const ctx = await remoteSetup(t, {
    capabilities: ['seek', 'volume', 'shuffle', 'repeat', 'queue', 'play_media', 'append'],
  });
  await ctx.app.playerRound();
  const offered = ctx.gladys.fake.discoveredDevices.find((d) => d.external_id === PLAYER);
  assert.ok(!offered.features.some((f) => f.external_id.endsWith(':mute')));
});

test('remote control: the live state replaces the inference, volume and modes included', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  const ctx = await remoteSetup(t);
  await ctx.app.playerRound();
  await create(ctx, PLAYER);
  await ctx.app.playerRound();
  const value = (key) => ctx.gladys.fake.lastState(`${PLAYER}:${key}`);
  assert.equal(value('playing'), 1);
  assert.equal(value('music_title'), 'Revelation');
  assert.equal(value('music_duration'), 300);
  assert.equal(value('volume'), 70);
  assert.equal(value('mute'), 0);
  assert.equal(value('shuffle'), 0);
  assert.equal(value('repeat'), 0);

  // A pause reported at once: no 30 s of inference.
  const entry = ctx.server.state.remote.get(PLAYER_ID);
  entry.state = LIVE_PLAYING(ctx.now(), { playback_state: 'paused', repeat: 'one', volume: 20 });
  await ctx.app.playerRound();
  assert.equal(value('playing'), 0);
  assert.equal(value('repeat'), 2);
  assert.equal(value('volume'), 20);
  assert.equal(ctx.app.playback.get(PLAYER_ID).live, true);
});

test('remote control: an old device keeps its features, only those get states', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: START });
  // Created read-only (before JewelBox 1.18), not updated by the user since.
  const ctx = await setup(t, { queue: {} });
  await ctx.app.playerRound();
  await create(ctx, PLAYER);
  ctx.server.state.remote = new Map([
    [PLAYER_ID, { controllable: true, capabilities: ['volume'], state: LIVE_PLAYING(ctx.now()) }],
  ]);
  ctx.app.locate({ force: true });
  await ctx.app.playerRound();
  await ctx.app.playerRound(); // an older server is asked again 10 min later only
  const sent = ctx.gladys.fake.states.map((s) => s.device_feature_external_id.split(':').at(-1));
  assert.ok(!sent.includes('volume'), 'no state for a feature the device does not have');
});

test('remote control: a write becomes a command; errors say what to do', async (t) => {
  const ctx = await remoteSetup(t);
  await ctx.app.playerRound();
  await create(ctx, PLAYER);
  const write = (key, value) =>
    ctx.gladys.fake.setValue(playerDevice(ctx), featureOf(ctx, key), value);

  for (const [key, value] of [
    ['playing', 0],
    ['playing', 1],
    ['next', 1],
    ['previous', 1],
    ['music_position', 95],
    ['volume', 33],
    ['mute', 1],
    ['shuffle', 1],
    ['repeat', 1],
  ]) {
    const ack = await write(key, value);
    assert.equal(ack.success, true, `${key}: ${JSON.stringify(ack)}`);
  }
  assert.deepEqual(
    ctx.server.state.commands.map(([, body]) => body),
    [
      { command: 'pause' },
      { command: 'play' },
      { command: 'next' },
      { command: 'previous' },
      { command: 'seek', position_sec: 95 },
      { command: 'volume', volume: 33 },
      { command: 'mute', muted: true },
      { command: 'shuffle', shuffle: true },
      { command: 'repeat', repeat: 'all' },
    ],
  );

  ctx.server.state.remote.get(PLAYER_ID).controllable = false;
  const offline = await write('playing', 1);
  assert.equal(offline.success, false);
  assert.match(JSON.stringify(offline), /does not allow remote control/);

  ctx.server.state.remote.get(PLAYER_ID).controllable = true;
  ctx.server.state.refuse = () => 'this player does not support mute';
  const refused = await write('mute', 1);
  assert.match(JSON.stringify(refused), /cannot do that/);
});

test('remote control: a change on the watch stream brings a round at once', async (t) => {
  const ctx = await remoteSetup(t);
  await ctx.app.playerRound();
  await create(ctx, PLAYER);
  await ctx.app.playerRound();
  for (let i = 0; i < 20 && ctx.server.state.watchers.length === 0; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(ctx.server.state.watchers.length, 1, 'the watch stream is open');
  const entry = ctx.server.state.remote.get(PLAYER_ID);
  entry.state = LIVE_PLAYING(ctx.now(), { playback_state: 'paused' });
  const rounds = () =>
    ctx.server.calls.filter((c) => c === 'GET /api/player/remote/devices').length;
  const before = rounds();
  ctx.server.emit('device', { device_id: PLAYER_ID });
  await new Promise((resolve) => setTimeout(resolve, 400));
  await ctx.app.playerRound();
  assert.ok(rounds() > before);
  assert.equal(ctx.gladys.fake.lastState(`${PLAYER}:playing`), 0);
});

test('music players: browse the catalog, search, play, queue', async (t) => {
  const ctx = await remoteSetup(t);
  await ctx.app.playerRound();
  await create(ctx, PLAYER);
  const device = playerDevice(ctx);

  const root = await ctx.gladys.fake.musicBrowse(device, {});
  assert.equal(root.success, true, JSON.stringify(root));
  assert.deepEqual(
    root.data.items.map((i) => i.id),
    ['folder:albums', 'folder:playlists', 'folder:smart'],
  );
  const albums = await ctx.gladys.fake.musicBrowse(device, { parentId: 'folder:albums' });
  assert.deepEqual(
    albums.data.items.map((i) => [i.id, i.type, i.subtitle]),
    [
      ['album:1', 'album', 'Opeth'],
      ['album:2', 'album', 'Opeth'],
    ],
  );
  assert.equal(albums.data.total, 2);
  assert.match(albums.data.items[0].artwork_key, /^art-/);
  const smart = await ctx.gladys.fake.musicBrowse(device, { parentId: 'folder:smart' });
  assert.deepEqual(
    smart.data.items.map((i) => [i.id, i.title]),
    [
      ['smart:favourites', 'Favourites'],
      ['smart:dynamic_mix', 'Dynamic mix'],
    ],
  );
  const playlists = await ctx.gladys.fake.musicBrowse(device, { parentId: 'folder:playlists' });
  assert.deepEqual(playlists.data.items[0], {
    id: 'playlist:3',
    type: 'playlist',
    title: 'Road trip',
    subtitle: '2 tracks',
    browsable: true,
    playable: true,
  });

  ctx.server.state.albums[0].tracks = [
    { id: 11, position: 1, title: 'The Leper Affinity', duration: '10:23', has_file: true },
    { id: 12, position: 2, title: 'Bleak', duration: '9:16', has_file: false },
  ];
  const album = await ctx.gladys.fake.musicBrowse(device, { parentId: 'album:1' });
  assert.deepEqual(
    album.data.items.map((i) => [i.id, i.type, i.duration ?? null, i.playable]),
    [
      ['radio:album:1', 'radio', null, true],
      ['track:11', 'track', 623, true],
      ['track:12', 'track', 556, false],
    ],
  );

  const found = await ctx.gladys.fake.musicSearch(device, { query: 'opeth' });
  assert.deepEqual(
    found.data.items.map((i) => i.id),
    ['artist:1', 'album:1', 'album:2'],
  );

  for (const [id, mode, media] of [
    ['album:2', 'replace', { type: 'album', id: 2 }],
    ['track:11', 'next', { type: 'track', id: 11 }],
    ['smart:dynamic_mix', 'replace', { type: 'smart', id: 'dynamic_mix' }],
    ['artist:1', 'append', { type: 'artist_radio', id: 1 }],
    ['radio:album:1', 'replace', { type: 'album_radio', id: 1 }],
  ]) {
    const ack = await ctx.gladys.fake.musicPlay(device, { id, type: 'album' }, mode);
    assert.equal(ack.success, true, `${id}: ${JSON.stringify(ack)}`);
    assert.deepEqual(ctx.server.state.commands.at(-1)[1], { command: 'play_media', media, mode });
  }
  assert.equal(
    (await ctx.gladys.fake.musicPlay(device, { id: 'folder:albums', type: 'folder' })).success,
    false,
  );

  const queue = await ctx.gladys.fake.musicQueueGet(device, {});
  assert.equal(queue.success, true, JSON.stringify(queue));
  assert.equal(queue.data.total, 3);
  assert.equal(queue.data.current_index, 0, 'current_index on the wire');
  assert.equal(queue.data.items[1].id, 'track:4956');
  const jump = await ctx.gladys.fake.musicQueuePlay(device, 2);
  assert.equal(jump.success, true);
  assert.deepEqual(ctx.server.state.commands.at(-1)[1], { command: 'play_index', index: 2 });
});

const LISTENING = (plays) => ({
  period: 'month',
  counters: { plays_today: 3, plays_month: plays, plays_year: 200, plays_all: 1234 },
  summary: { plays, listening_minutes: 125, tracks: 20, albums: 2 },
  by_month: [
    { month: '2026-09', plays: 12 },
    { month: '2026-10', plays },
  ],
  top: {
    albums: [
      {
        album_id: 1,
        title: 'Blackwater Park',
        artist_name: 'Opeth',
        cover_url: `/covers/${COVER}.jpeg`,
        plays: 9,
      },
      { album_id: 2, title: 'Damnation', artist_name: 'Opeth', cover_url: null, plays: 1 },
    ],
  },
});

test('listening: counters of the collection, a view of its widget', async (t) => {
  const ctx = await setup(t);
  ctx.server.state.listening = {
    month: LISTENING(31),
    all: { ...LISTENING(1234), period: 'all' },
  };
  await create(ctx, COLLECTION);
  await ctx.app.collectionRound();
  await flush(ctx);
  assert.equal(ctx.gladys.fake.lastState(`${COLLECTION}:plays_today`), 3);
  assert.equal(ctx.gladys.fake.lastState(`${COLLECTION}:plays_month`), 31);

  const view = async (settings, language = 'fr') =>
    (await ctx.gladys.fake.widgetGet(WIDGETS.COLLECTION, { language, settings })).data.content;
  const month = await view({ view: 'listening' });
  assert.deepEqual(validateWidgetContent(month), []);
  const text = JSON.stringify(month);
  assert.match(text, /Blackwater Park/);
  assert.match(text, /9 écoutes/);
  assert.match(text, /1 écoute"/);
  assert.match(text, new RegExp(`jb-${COVER}-jpeg`));
  assert.equal(month.components[1].value, 31);
  assert.equal(month.components[2].value, 2.1);

  const all = await view({ view: 'listening', period: 'all' }, 'en');
  assert.deepEqual(validateWidgetContent(all), []);
  assert.equal(all.components[1].value, 1234);
  // Cached for a minute: one request for two displays.
  await view({ view: 'listening', period: 'all' });
  assert.equal(ctx.server.calls.filter((c) => c.includes('period=all')).length, 1);

  // The default view stays the collection.
  assert.match(JSON.stringify(await view({})), /Blackwater Park|will_cd_collections/);
});

test('listening: an older JewelBox (404) says so, without counters', async (t) => {
  const ctx = await setup(t);
  await create(ctx, COLLECTION);
  await ctx.app.collectionRound();
  await flush(ctx);
  assert.equal(ctx.gladys.fake.lastState(`${COLLECTION}:plays_month`), undefined);
  assert.equal(ctx.gladys.fake.lastState(`${COLLECTION}:owned`), 2);
  const ack = await ctx.gladys.fake.widgetGet(WIDGETS.COLLECTION, {
    language: 'en',
    settings: { view: 'listening' },
  });
  assert.match(JSON.stringify(ack.data.content), /need JewelBox 1.20/);
});

test('listening: a collection created before the counters gets no state for them', async (t) => {
  const ctx = await setup(t);
  ctx.server.state.listening = { month: LISTENING(31) };
  const device = structuredClone(
    ctx.gladys.fake.discoveredDevices.find((d) => d.external_id === COLLECTION),
  );
  device.features = device.features.filter((f) => !/:plays_(today|month)$/.test(f.external_id));
  await ctx.gladys.fake.deviceCreated(device);
  await ctx.app.collectionRound();
  await flush(ctx);
  assert.equal(ctx.gladys.fake.lastState(`${COLLECTION}:plays_month`), undefined);
  assert.equal(ctx.gladys.fake.lastState(`${COLLECTION}:owned`), 2);
});

test('wake_up: volume first, the music, then a slow rise that gives way to the user', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ctx = await remoteSetup(t);
  await ctx.app.playerRound();
  await create(ctx, PLAYER);
  ctx.server.state.playlists = [{ id: 3, name: 'Réveil doux', track_count: 2, tracks: [] }];
  const ack = await ctx.gladys.fake.sceneAction('wake_up', {
    player: PLAYER,
    music: 'playlist',
    name: 'réveil DOUX',
    start_volume: 10,
    end_volume: 13,
    duration: 3,
  });
  assert.equal(ack.success, true, JSON.stringify(ack));
  assert.deepEqual(ack.data.outputs, {
    player_name: 'JewelBox bureau · wsmd-fed-2',
    title: 'Réveil doux',
  });
  const sent = () => ctx.server.state.commands.map(([, body]) => body);
  assert.deepEqual(sent(), [
    { command: 'volume', volume: 10 },
    { command: 'play_media', media: { type: 'playlist', id: 3 }, mode: 'replace' },
  ]);

  // The player confirms each volume through its live state.
  const live = ctx.server.state.remote.get(PLAYER_ID).state;
  let reports = 0;
  const tick = async (volume) => {
    live.volume = volume;
    live.reported_at = new Date(START + ++reports * 1000).toISOString();
    // A round already running read the state before: one more after it.
    await ctx.app.playerRound();
    await ctx.app.playerRound();
    t.mock.timers.tick(60000);
    for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  await tick(10);
  assert.deepEqual(sent().at(-1), { command: 'volume', volume: 11 });
  await tick(11);
  assert.deepEqual(sent().at(-1), { command: 'volume', volume: 12 });
  // Turned down by hand: the rise stops there.
  const before = sent().length;
  await tick(4);
  assert.equal(sent().length, before);

  const missing = await ctx.gladys.fake.sceneAction('wake_up', { music: 'playlist', name: 'Nope' });
  assert.match(JSON.stringify(missing), /No JewelBox playlist named/);
});
