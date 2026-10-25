// The checks the core makes on the discovered devices and that the fake
// Gladys does not all make: a single invalid field rejects the whole batch,
// and a missing min / max / read_only / has_feedback breaks "Add" (422).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import {
  buildCollectionDevice,
  buildPlayerDevice,
  collectionValues,
  nowPlayingFeatureIds,
  nowPlayingOf,
  parseExternalId,
  playerNames,
  playerValues,
} from '../src/devices.js';

const gladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};
const SERVER = '009004e9-ab55-4894-9e96-10e930a04b7f';
const PLAYER = '249102a0-f41b-4c4c-b17a-ec3eee29edf4';
const devices = (language) => [
  buildCollectionDevice(gladys, { serverId: SERVER }, language),
  buildPlayerDevice(gladys, PLAYER, 'JewelBox bureau', language),
];

test('every feature: a known category/type pair, min, max, read_only, has_feedback, no poll', () => {
  const types = Object.fromEntries(
    Object.entries(DEVICE_FEATURE_CATEGORIES).map(([key, category]) => [
      category,
      new Set(Object.values(DEVICE_FEATURE_TYPES[key] ?? DEVICE_FEATURE_TYPES.SENSOR)),
    ]),
  );
  const units = new Set(Object.values(DEVICE_FEATURE_UNITS));
  for (const language of ['en', 'fr']) {
    for (const device of devices(language)) {
      assert.equal(device.should_poll, false);
      assert.equal(device.poll_frequency, undefined);
      assert.ok(device.name.length > 0);
      for (const feature of device.features) {
        assert.ok(
          types[feature.category]?.has(feature.type),
          `${feature.external_id}: ${feature.category}/${feature.type}`,
        );
        for (const key of ['min', 'max', 'read_only', 'has_feedback', 'keep_history']) {
          assert.notEqual(feature[key], undefined, `${feature.external_id}.${key}`);
        }
        assert.ok(feature.min <= feature.max, feature.external_id);
        assert.equal(feature.read_only, true, 'JewelBox cannot be commanded');
        if (feature.unit) assert.ok(units.has(feature.unit), feature.unit);
        assert.ok(feature.external_id.startsWith(`${device.external_id}:`));
        assert.ok(feature.name.startsWith(device.name), feature.name);
      }
    }
  }
});

test('external ids: built on the stable JewelBox ids, parsed back, anything else refused', () => {
  const [collection, player] = devices('en');
  assert.equal(collection.external_id, `ext:test-integration:collection:${SERVER}`);
  assert.deepEqual(parseExternalId(gladys, collection.external_id), {
    type: 'collection',
    id: SERVER,
  });
  assert.deepEqual(parseExternalId(gladys, `${player.external_id}:playing`), {
    type: 'player',
    id: PLAYER,
  });
  assert.equal(parseExternalId(gladys, 'ext:test-integration:player:../x'), null);
  assert.equal(parseExternalId(gladys, 'ext:other:player:abc'), null);
  assert.equal(parseExternalId(gladys, undefined), null);
});

test('values: a missing statistic is omitted, never 0; texts never empty', () => {
  assert.deepEqual(
    collectionValues(
      { total_owned: 651, avg_rating: 4.63, total_duration_hours: 572, total_duration_mins: 41 },
      0,
    ),
    [
      ['owned', 651],
      ['rating', 4.6],
      ['play_time', 572.7],
      ['oldest_loan', 0],
    ],
  );
  assert.deepEqual(collectionValues(null, null), []);
  const values = Object.fromEntries(
    playerValues({ playing: false, track: { title: '', artist: 'A', album: null } }),
  );
  assert.deepEqual(values, {
    track: { text: '–' },
    artist: { text: 'A' },
    album: { text: '–' },
  });
});

test('now playing: the position sampled now, the cover path, texts cleared without a queue', () => {
  const track = {
    title: 'Revelation',
    artist: 'Marilyn Manson',
    album: 'Heaven Upside Down',
    duration: 300,
    cover: '/covers/a1e67298241294dffe2e8f3a18f72d24.jpeg',
  };
  const at = Date.UTC(2026, 9, 24, 16, 0, 0);
  const playing = { playing: true, position: 12, updatedAt: at, track };
  assert.deepEqual(nowPlayingOf(playing, at + 8400), {
    playback_state: 1,
    title: 'Revelation',
    artist: 'Marilyn Manson',
    album: 'Heaven Upside Down',
    artwork_url: '/covers/a1e67298241294dffe2e8f3a18f72d24.jpeg',
    duration: 300,
    position: 20,
  });
  assert.equal(nowPlayingOf(playing, at + 3600 * 1000).position, 300, 'never past the end');
  const paused = nowPlayingOf({ ...playing, playing: false }, at + 60000);
  assert.equal(paused.playback_state, 0);
  assert.equal(paused.position, 12, 'frozen while paused');
  const odd = nowPlayingOf(
    { ...playing, track: { ...track, duration: null, cover: 'http://elsewhere/x.jpg' } },
    at,
  );
  assert.equal(odd.artwork_url, null, 'a cover outside the server is never keyed');
  assert.equal(odd.duration, 0);
  assert.deepEqual(nowPlayingOf({ playing: false, position: 0, updatedAt: NaN, track: null }, at), {
    playback_state: 0,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
  });
  assert.equal(nowPlayingOf(null, at), null);
});

test('now playing: every type lands on a feature of the player, the state on `playing`', () => {
  const player = buildPlayerDevice(gladys, PLAYER, 'JewelBox bureau', 'en');
  const byId = new Map(player.features.map((feature) => [feature.external_id, feature]));
  for (const [type, id] of Object.entries(nowPlayingFeatureIds(gladys, PLAYER))) {
    const feature = byId.get(id);
    assert.ok(feature, id);
    assert.equal(feature.category, DEVICE_FEATURE_CATEGORIES.MUSIC, id);
    assert.equal(feature.type, type, id);
  }
  assert.equal(
    nowPlayingFeatureIds(gladys, PLAYER).playback_state,
    `${player.external_id}:playing`,
  );
});

test('player names: JewelBox prefix, the id when two share a label', () => {
  const names = playerNames([
    { device_id: 'aaaaaaaa-1', device_label: 'JewelBox Android · 2412DPC0AG' },
    { device_id: 'bbbbbbbb-1', device_label: 'Chrome' },
    { device_id: 'cccccccc-1', device_label: 'Chrome' },
    { device_id: 'dddddddd-1', device_label: null },
  ]);
  assert.deepEqual(
    [...names.values()],
    [
      'JewelBox Android · 2412DPC0AG',
      'JewelBox Chrome (bbbbbbbb)',
      'JewelBox Chrome (cccccccc)',
      'JewelBox',
    ],
  );
});
