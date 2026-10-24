// -----------------------------------------------------------------------------
// Is a JewelBox player playing? (pure)
//
// JewelBox does not store a play / pause state: each player (the web app, the
// desktop player, the Android app) only saves its queue on the server, with
// the current track and the position:
//
//   - while playing, a position every 10 s (web app) or 30 s (desktop and
//     Android);
//   - at a pause, one more position, to keep the exact spot;
//   - a new current track as soon as it changes.
//
// So the state is inferred from these writes, the way the "resume on another
// device" feature of JewelBox reads them:
//
//   - a new track → playing;
//   - the position moved forward, at the usual pace of this player → playing;
//   - a write earlier than the usual pace (the pause write), or a position
//     that did not move → paused;
//   - no write for the usual pace + GRACE_S → stopped (closed, paused long
//     ago, end of the queue);
//   - the position + the time since the write passed the end of the track and
//     no new track came → stopped (end of the queue).
//
// The pace of each player is learned from its own writes (the longest gap of
// continuous play seen, 60 s at most); unknown, it is DEFAULT_INTERVAL_S.
// Every age is measured on the clock of the JewelBox server (Date header).
// -----------------------------------------------------------------------------

export const DEFAULT_INTERVAL_S = 30;
export const MAX_INTERVAL_S = 60;
export const GRACE_S = 20;
// A write this much earlier than the usual pace is a pause.
const EARLY_S = 3;
// First sight of a player: playing only if its last write is this recent.
const FIRST_SIGHT_S = DEFAULT_INTERVAL_S + 5;
const END_GRACE_S = 30;

/**
 * @description A queue of the JewelBox API → what the inference needs.
 * @param {object|null} queue - `GET /api/player/queue/devices/:id`.
 * @param {Function} parseDate - SQLite date → ms.
 * @returns {object|null} `{ updatedAt, position, index, track }`, null without
 * a current track.
 */
export function observationOf(queue, parseDate) {
  if (!queue || !Array.isArray(queue.tracks) || queue.tracks.length === 0) return null;
  const index = Number.isInteger(queue.current_index) ? queue.current_index : 0;
  const track = queue.tracks[Math.min(Math.max(index, 0), queue.tracks.length - 1)];
  if (!track) return null;
  return {
    updatedAt: parseDate(queue.updated_at),
    position: Number.isFinite(queue.position_sec) ? queue.position_sec : 0,
    index,
    track: {
      id: track.id ?? null,
      title: String(track.title ?? ''),
      artist: String(track.artist_name ?? ''),
      album: String(track.album_title ?? ''),
      albumId: track.album_id ?? null,
      duration: Number.isFinite(track.duration) ? track.duration : null,
      cover: typeof track.cover_url === 'string' ? track.cover_url : '',
    },
    source: typeof queue.source_label === 'string' ? queue.source_label : '',
  };
}

/**
 * @description The next state of a player.
 * @param {object|null} previous - The last result of this function, null at
 * first sight.
 * @param {object|null} observation - `observationOf()`, null without a queue.
 * @param {number} serverNow - Now on the server clock (ms).
 * @returns {object} `{ playing, updatedAt, position, index, trackId, interval,
 * track, source }`.
 */
export function nextPlayback(previous, observation, serverNow) {
  if (!observation || !Number.isFinite(observation.updatedAt)) {
    return {
      playing: false,
      updatedAt: NaN,
      position: 0,
      index: -1,
      trackId: null,
      interval: previous?.interval ?? null,
      track: observation?.track ?? null,
      source: observation?.source ?? '',
    };
  }
  const { updatedAt, position, index, track, source } = observation;
  let playing;
  let interval = previous?.interval ?? null;

  const same = previous && previous.updatedAt === updatedAt;
  if (same) {
    playing = previous.playing;
  } else if (!previous || !Number.isFinite(previous.updatedAt)) {
    playing = (serverNow - updatedAt) / 1000 <= FIRST_SIGHT_S;
  } else {
    const gap = (updatedAt - previous.updatedAt) / 1000;
    const moved = position - previous.position;
    if (index !== previous.index || track.id !== previous.trackId) {
      playing = true;
    } else if (moved <= 0.5 || gap <= 0) {
      playing = false;
    } else if (interval !== null && gap < interval - EARLY_S) {
      playing = false;
    } else {
      playing = true;
    }
    // Continuous play between two writes: the gap is the pace of the player.
    const continuous = index === previous.index && gap > 0 && Math.abs(moved - gap) <= EARLY_S;
    if (continuous && previous.playing) {
      interval = Math.min(MAX_INTERVAL_S, Math.max(interval ?? 0, Math.round(gap)));
    }
  }

  if (playing) {
    const age = (serverNow - updatedAt) / 1000;
    if (age > (interval ?? DEFAULT_INTERVAL_S) + GRACE_S) playing = false;
    if (track.duration && position + age > track.duration + END_GRACE_S) playing = false;
  }

  return { playing, updatedAt, position, index, trackId: track.id, interval, track, source };
}
