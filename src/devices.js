// -----------------------------------------------------------------------------
// The Gladys devices of a JewelBox server.
//
//   collection   one per server: ext:<selector>:collection:<server_id>
//                (the stable id JewelBox mints at its first start and
//                announces in mDNS, never its address)
//     owned        albums in the collection (counter)
//     wanted       albums in the wish list (counter)
//     lent         albums lent out (counter)
//     artists      artists in the collection (counter)
//     rating       average rating, 1 to 5 (decimal)
//     play_time    total playing time of the collection (hours)
//     oldest_loan  days since the oldest loan still running (0 without loan)
//
//   player       one per JewelBox player that left a queue on the server
//                (web app, desktop player, Android app):
//                ext:<selector>:player:<JewelBox device id> (a UUID the
//                player keeps; never its label)
//     playing      music / playback_state, inferred (src/playback.js)
//     track        title of the current track (text)
//     artist       its artist (text)
//     album        its album (text)
//
// Everything is read-only: JewelBox has no way to command a player.
// No `should_poll`: the integration reads the server itself (players every
// 10 s, the collection every minute).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { t } from './i18n.js';

export const DEVICE_TYPES = { COLLECTION: 'collection', PLAYER: 'player' };
export const COLLECTION_FEATURES = {
  OWNED: 'owned',
  WANTED: 'wanted',
  LENT: 'lent',
  ARTISTS: 'artists',
  RATING: 'rating',
  PLAY_TIME: 'play_time',
  OLDEST_LOAN: 'oldest_loan',
};
export const PLAYER_FEATURES = {
  PLAYING: 'playing',
  TRACK: 'track',
  ARTIST: 'artist',
  ALBUM: 'album',
};
export const PLAYBACK_STATE = { PLAYING: 1, STOPPED: 0 };
export const SERVER_PARAM = 'JEWELBOX_SERVER_ID';
export const PLAYER_PARAM = 'JEWELBOX_DEVICE_ID';

// Gladys takes an empty text for no text at all (the state would be lost).
export const NO_TEXT = '–';
const MAX_TEXT = 250;
// Far beyond any shelf.
const MAX_COUNT = 1000000;

const base = { read_only: true, has_feedback: false, keep_history: true };
const counter = {
  ...base,
  category: CATEGORIES.COUNTER_SENSOR,
  type: TYPES.SENSOR.INTEGER,
  min: 0,
  max: MAX_COUNT,
};
const text = {
  ...base,
  category: CATEGORIES.TEXT,
  type: TYPES.TEXT.TEXT,
  min: 0,
  max: 0,
  keep_history: false,
};

const COLLECTION_SPECS = [
  [COLLECTION_FEATURES.OWNED, counter],
  [COLLECTION_FEATURES.WANTED, counter],
  [COLLECTION_FEATURES.LENT, counter],
  [COLLECTION_FEATURES.ARTISTS, counter],
  [
    COLLECTION_FEATURES.RATING,
    { ...base, category: CATEGORIES.COUNTER_SENSOR, type: TYPES.SENSOR.DECIMAL, min: 0, max: 5 },
  ],
  [
    COLLECTION_FEATURES.PLAY_TIME,
    {
      ...base,
      category: CATEGORIES.DURATION,
      type: TYPES.DURATION.DECIMAL,
      unit: UNITS.HOURS,
      min: 0,
      max: MAX_COUNT,
    },
  ],
  [
    COLLECTION_FEATURES.OLDEST_LOAN,
    {
      ...base,
      category: CATEGORIES.DURATION,
      type: TYPES.DURATION.INTEGER,
      unit: UNITS.DAYS,
      min: 0,
      max: 36500,
    },
  ],
];

const PLAYER_SPECS = [
  [
    PLAYER_FEATURES.PLAYING,
    {
      ...base,
      category: CATEGORIES.MUSIC,
      type: TYPES.MUSIC.PLAYBACK_STATE,
      min: PLAYBACK_STATE.STOPPED,
      max: PLAYBACK_STATE.PLAYING,
    },
  ],
  [PLAYER_FEATURES.TRACK, text],
  [PLAYER_FEATURES.ARTIST, text],
  [PLAYER_FEATURES.ALBUM, text],
];

// A JewelBox device id is a UUID (the players mint it); the server accepts
// any string up to 64 characters, so anything else is refused here.
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const isPlayerId = (value) => typeof value === 'string' && PLAYER_ID.test(value);
const SERVER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const isServerId = (value) => typeof value === 'string' && SERVER_ID.test(value);

/**
 * @description The ids behind a device external id.
 * @param {object} gladys - SDK client.
 * @param {unknown} externalId - A device (or feature) external id.
 * @returns {{ type: string, id: string }|null} The type and the JewelBox id.
 */
export function parseExternalId(gladys, externalId) {
  const value = String(externalId ?? '');
  for (const type of Object.values(DEVICE_TYPES)) {
    const prefix = gladys.externalIds(type, '').device;
    if (value.startsWith(prefix)) {
      const id = value.slice(prefix.length).split(':')[0];
      const valid = type === DEVICE_TYPES.PLAYER ? isPlayerId(id) : isServerId(id);
      return valid ? { type, id } : null;
    }
  }
  return null;
}

export const collectionIds = (gladys, serverId) =>
  gladys.externalIds(DEVICE_TYPES.COLLECTION, serverId);
export const playerIds = (gladys, deviceId) => gladys.externalIds(DEVICE_TYPES.PLAYER, deviceId);

const featuresOf = (ids, specs, prefix, language) =>
  specs.map(([key, feature]) => ({
    name: `${prefix} - ${t(`feature_${key}`, language)}`,
    external_id: ids.feature(key),
    ...feature,
  }));

/**
 * @description The collection device of a server.
 * @param {object} gladys - SDK client.
 * @param {{ serverId: string }} server - The server.
 * @param {string} language - Language of the names.
 * @returns {object} The device.
 */
export function buildCollectionDevice(gladys, server, language) {
  const ids = collectionIds(gladys, server.serverId);
  const name = t('deviceCollection', language);
  return {
    name,
    external_id: ids.device,
    should_poll: false,
    features: featuresOf(ids, COLLECTION_SPECS, name, language),
    params: [{ name: SERVER_PARAM, value: server.serverId }],
  };
}

/**
 * @description The names of the players: their JewelBox label, prefixed with
 * "JewelBox" when it does not say it, and the start of their id when two
 * share a label (two browsers both called "Chrome").
 * @param {Array<{ device_id: string, device_label: string|null }>} players - The players.
 * @returns {Map<string, string>} device_id → name.
 */
export function playerNames(players) {
  const labelOf = (player) => {
    const label = String(player.device_label ?? '')
      .trim()
      .slice(0, 80);
    if (!label) return 'JewelBox';
    return /^jewelbox\b/i.test(label) ? label : `JewelBox ${label}`;
  };
  const counts = new Map();
  for (const player of players) counts.set(labelOf(player), (counts.get(labelOf(player)) ?? 0) + 1);
  return new Map(
    players.map((player) => {
      const label = labelOf(player);
      const name = counts.get(label) > 1 ? `${label} (${player.device_id.slice(0, 8)})` : label;
      return [player.device_id, name];
    }),
  );
}

/**
 * @description The device of a player.
 * @param {object} gladys - SDK client.
 * @param {string} deviceId - JewelBox device id.
 * @param {string} name - Its name (playerNames).
 * @param {string} language - Language of the names.
 * @returns {object} The device.
 */
export function buildPlayerDevice(gladys, deviceId, name, language) {
  const ids = playerIds(gladys, deviceId);
  return {
    name,
    external_id: ids.device,
    should_poll: false,
    features: featuresOf(ids, PLAYER_SPECS, name, language),
    params: [{ name: PLAYER_PARAM, value: deviceId }],
  };
}

export const cutText = (value, max = MAX_TEXT) => {
  const clean = String(value ?? '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

/**
 * @description The values of the collection features.
 * @param {object} stats - `GET /api/stats`.
 * @param {number|null} oldestLoanDays - Days of the oldest loan (null: unknown).
 * @returns {Array<[string, number]>} `[featureKey, value]`; an unknown value is omitted.
 */
export function collectionValues(stats, oldestLoanDays) {
  const values = [];
  const count = (key, value) => {
    if (Number.isFinite(value) && value >= 0) values.push([key, Math.round(value)]);
  };
  if (stats) {
    count(COLLECTION_FEATURES.OWNED, stats.total_owned);
    count(COLLECTION_FEATURES.WANTED, stats.total_wanted);
    count(COLLECTION_FEATURES.LENT, stats.total_lent);
    count(COLLECTION_FEATURES.ARTISTS, stats.total_artists);
    if (Number.isFinite(stats.avg_rating))
      values.push([COLLECTION_FEATURES.RATING, round(stats.avg_rating, 1)]);
    if (Number.isFinite(stats.total_duration_hours)) {
      const minutes = Number.isFinite(stats.total_duration_mins) ? stats.total_duration_mins : 0;
      values.push([
        COLLECTION_FEATURES.PLAY_TIME,
        round(stats.total_duration_hours + minutes / 60, 1),
      ]);
    }
  }
  if (Number.isFinite(oldestLoanDays))
    values.push([COLLECTION_FEATURES.OLDEST_LOAN, Math.max(0, oldestLoanDays)]);
  return values;
}

/**
 * @description The values of a player.
 * @param {object|null} playback - `nextPlayback()`, null when unknown.
 * @returns {Array<[string, number|{ text: string }]>} `[featureKey, value]`.
 */
export function playerValues(playback) {
  if (!playback) return [];
  const track = playback.track;
  return [
    [PLAYER_FEATURES.PLAYING, playback.playing ? PLAYBACK_STATE.PLAYING : PLAYBACK_STATE.STOPPED],
    [PLAYER_FEATURES.TRACK, { text: cutText(track?.title) || NO_TEXT }],
    [PLAYER_FEATURES.ARTIST, { text: cutText(track?.artist) || NO_TEXT }],
    [PLAYER_FEATURES.ALBUM, { text: cutText(track?.album) || NO_TEXT }],
  ];
}
