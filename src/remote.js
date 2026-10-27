// -----------------------------------------------------------------------------
// Remote control of the JewelBox players (pure).
//
// JewelBox 1.18+ relays commands to its players (web app, desktop, Android)
// over an event stream each player keeps open while its "Allow remote
// control" setting is on, and every player reports its live state (play /
// pause, track, position, volume, modes) at each change:
//
//   GET  /api/player/remote/devices                 live state + capabilities
//   GET  /api/player/remote/watch                   the same, as events
//   POST /api/player/remote/devices/:id/commands    { command, ...arguments }
//
// Here: the live state → the playback of src/playback.js (it replaces the
// inference when present), a Gladys write → a command, and the catalog of
// JewelBox → the MediaItems of the Gladys music players.
// -----------------------------------------------------------------------------

import {
  MUSIC_MEDIA_TYPES as MEDIA,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
} from '@gladysassistant/integration-sdk';

// What a player may announce (the list of the server).
export const CAPABILITIES = [
  'seek',
  'volume',
  'mute',
  'shuffle',
  'repeat',
  'queue',
  'play_media',
  'append',
  'sleep_timer',
];

export const REPEAT_TO_GLADYS = {
  off: MUSIC_REPEAT_MODE.OFF,
  all: MUSIC_REPEAT_MODE.ALL,
  one: MUSIC_REPEAT_MODE.ONE,
};
const REPEAT_FROM_GLADYS = Object.fromEntries(
  Object.entries(REPEAT_TO_GLADYS).map(([mode, value]) => [value, mode]),
);

const COVER_PATH = /^\/covers\/[0-9a-f]{32}\.(jpe?g|png|webp)$/i;
export const coverPathOf = (value) => (COVER_PATH.test(value ?? '') ? value : '');

/**
 * @description A track duration of JewelBox: seconds, or the "m:ss" /
 * "h:mm:ss" text the albums carry.
 * @param {unknown} value - The duration.
 * @returns {number|null} Seconds, null when unknown.
 */
export function durationSeconds(value) {
  if (Number.isFinite(value)) return value > 0 ? value : null;
  const parts = String(value ?? '')
    .trim()
    .split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const seconds = numbers.reduce((total, n) => total * 60 + n, 0);
  return seconds > 0 ? seconds : null;
}

/**
 * @description The capabilities a player announced, cleaned and sorted.
 * @param {unknown} list - `capabilities` of a remote entry.
 * @returns {string[]} The known ones.
 */
export const capabilitiesOf = (list) =>
  [...new Set(Array.isArray(list) ? list : [])].filter((c) => CAPABILITIES.includes(c)).sort();

/**
 * @description The playback of a player from its live state: the same shape
 * as `nextPlayback()`, plus the live fields. No inference: the player said.
 * @param {object} entry - A row of `GET /api/player/remote/devices`.
 * @param {string} [source] - The source label of its queue.
 * @returns {object|null} The playback, null without a live state.
 */
export function playbackFromLive(entry, source = '') {
  const state = entry?.state;
  if (!state || !['playing', 'paused', 'idle'].includes(state.playback_state)) return null;
  const track = state.playback_state === 'idle' ? null : state.track;
  const reportedAt = Date.parse(state.reported_at ?? '');
  return {
    playing: state.playback_state === 'playing',
    updatedAt: Number.isFinite(reportedAt) ? reportedAt : NaN,
    position: Number.isFinite(state.position_sec) ? state.position_sec : 0,
    index: Number.isInteger(state.current_index) ? state.current_index : -1,
    trackId: track?.id ?? null,
    interval: null,
    track: track
      ? {
          id: track.id ?? null,
          title: String(track.title ?? ''),
          artist: String(track.artist_name ?? ''),
          album: String(track.album_title ?? ''),
          albumId: track.album_id ?? null,
          duration:
            Number.isFinite(state.duration_sec) && state.duration_sec > 0
              ? state.duration_sec
              : durationSeconds(track.duration),
          cover: typeof track.cover_url === 'string' ? track.cover_url : '',
        }
      : null,
    source,
    live: true,
    ...(Number.isFinite(state.volume) ? { volume: state.volume } : {}),
    ...(typeof state.muted === 'boolean' ? { muted: state.muted } : {}),
    ...(typeof state.shuffle === 'boolean' ? { shuffle: state.shuffle } : {}),
    ...(state.repeat in REPEAT_TO_GLADYS ? { repeat: state.repeat } : {}),
  };
}

/**
 * @description The command behind a write on a player feature.
 * @param {string} key - The feature key (src/devices.js PLAYER_FEATURES).
 * @param {unknown} value - The value written by Gladys.
 * @returns {object|null} The command body, null for a feature that is not a
 * control.
 */
export function commandOf(key, value) {
  const number = Number(value);
  switch (key) {
    case 'playing':
      if (number === MUSIC_PLAYBACK_STATE.PLAYING) return { command: 'play' };
      if (number === MUSIC_PLAYBACK_STATE.PAUSED) return { command: 'pause' };
      throw new RangeError('a JewelBox player can only play or pause');
    case 'next':
      return { command: 'next' };
    case 'previous':
      return { command: 'previous' };
    case 'music_position':
      if (!Number.isFinite(number) || number < 0) throw new RangeError('invalid position');
      return { command: 'seek', position_sec: number };
    case 'volume':
      if (!Number.isFinite(number)) throw new RangeError('invalid volume');
      return { command: 'volume', volume: Math.min(100, Math.max(0, Math.round(number))) };
    case 'mute':
      return { command: 'mute', muted: number === 1 };
    case 'shuffle':
      return { command: 'shuffle', shuffle: number === 1 };
    case 'repeat':
      if (!(number in REPEAT_FROM_GLADYS)) throw new RangeError('invalid repeat mode');
      return { command: 'repeat', repeat: REPEAT_FROM_GLADYS[number] };
    default:
      return null;
  }
}

// --- Catalog: media ids ------------------------------------------------------------------------
//
// Ids are ours (≤ 512 characters), what a play command and a scene action
// carry back: "album:12", "playlist:3", "smart:favourites", "track:55",
// "artist:7" (played as the radio of the artist), "radio:album:12", and the
// folders of the root "folder:albums", "folder:playlists", "folder:smart".

export const ROOT_FOLDERS = ['albums', 'playlists', 'smart'];
const SMART_KEY = /^[a-z_]{1,40}$/;

/**
 * @description Parse a media id.
 * @param {unknown} id - The id.
 * @returns {{ kind: string, id: number|string }|null} null when not ours.
 */
export function parseMediaId(id) {
  const text = String(id ?? '');
  const radio = /^radio:album:(\d{1,9})$/.exec(text);
  if (radio) return { kind: 'album_radio', id: Number(radio[1]) };
  const match = /^(album|playlist|track|artist):(\d{1,9})$/.exec(text);
  if (match) return { kind: match[1], id: Number(match[2]) };
  if (text.startsWith('smart:') && SMART_KEY.test(text.slice(6))) {
    return { kind: 'smart', id: text.slice(6) };
  }
  if (text.startsWith('folder:') && ROOT_FOLDERS.includes(text.slice(7))) {
    return { kind: 'folder', id: text.slice(7) };
  }
  return null;
}

/**
 * @description The JewelBox `play_media` of a media id.
 * @param {unknown} id - The media id.
 * @returns {{ type: string, id: number|string }|null} null when not playable.
 */
export function playMediaOf(id) {
  const parsed = parseMediaId(id);
  if (!parsed) return null;
  switch (parsed.kind) {
    case 'album':
    case 'playlist':
    case 'track':
    case 'smart':
    case 'album_radio':
      return { type: parsed.kind, id: parsed.id };
    case 'artist':
      return { type: 'artist_radio', id: parsed.id };
    default:
      return null;
  }
}

// --- Catalog: MediaItems -----------------------------------------------------------------------

const artworkOf = (artworkKey, cover) => {
  const path = coverPathOf(cover);
  return path ? artworkKey(path) : undefined;
};

const withArtwork = (item, key) => (key ? { ...item, artwork_key: key } : item);

/**
 * @description An album of JewelBox → a MediaItem (browsable: its tracks).
 * @param {object} album - An album of `/api/albums` or `/api/player/search`.
 * @param {Function} artworkKey - `gladys.artworkKey`.
 * @returns {object} The MediaItem.
 */
export const albumItem = (album, artworkKey) =>
  withArtwork(
    {
      id: `album:${album.id}`,
      type: MEDIA.ALBUM,
      title: String(album.title ?? ''),
      subtitle: String(album.artist?.name ?? album.artist_name ?? ''),
      browsable: true,
      playable: true,
    },
    artworkOf(artworkKey, album.cover_url),
  );

/**
 * @description A queue-shaped track (or a track of an album) → a MediaItem.
 * @param {object} track - The track.
 * @param {Function} artworkKey - `gladys.artworkKey`.
 * @param {object} [album] - Its album, for the tracks of `/api/albums/:id`.
 * @returns {object} The MediaItem.
 */
export function trackItem(track, artworkKey, album = null) {
  const duration = durationSeconds(track.duration);
  return withArtwork(
    {
      id: `track:${track.id}`,
      type: MEDIA.TRACK,
      title: String(track.title ?? ''),
      subtitle: String(album?.artist?.name ?? track.artist_name ?? ''),
      ...(duration ? { duration: Math.round(duration) } : {}),
      browsable: false,
      playable: track.has_file !== false && Boolean(track.has_file ?? track.file_path ?? true),
    },
    artworkOf(artworkKey, album?.cover_url ?? track.cover_url),
  );
}

export const playlistItem = (playlist, subtitle) => ({
  id: `playlist:${playlist.id}`,
  type: MEDIA.PLAYLIST,
  title: String(playlist.name ?? ''),
  ...(subtitle ? { subtitle } : {}),
  browsable: true,
  playable: true,
});

export const smartItem = (smart, title, subtitle) => ({
  id: `smart:${smart.key}`,
  type: MEDIA.PLAYLIST,
  title,
  ...(subtitle ? { subtitle } : {}),
  browsable: true,
  playable: true,
});

export const artistItem = (artist, subtitle) => ({
  id: `artist:${artist.id}`,
  type: MEDIA.ARTIST,
  title: String(artist.name ?? ''),
  ...(subtitle ? { subtitle } : {}),
  browsable: false,
  playable: true,
});

export const albumRadioItem = (album, title) => ({
  id: `radio:album:${album.id}`,
  type: MEDIA.RADIO,
  title,
  browsable: false,
  playable: true,
});

export const folderItem = (key, title) => ({
  id: `folder:${key}`,
  type: MEDIA.FOLDER,
  title,
  browsable: true,
  playable: false,
});
