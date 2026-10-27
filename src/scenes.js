// -----------------------------------------------------------------------------
// Scene triggers and actions.
//
// Triggers (one event per transition seen by the readings of the server,
// never at the first reading after a start, never as a consequence of a
// scene action or of a widget button — a scene lending an album does not
// fire album_lent):
//   album_added        an album added to the collection or to the wish list,
//                      or a wished album now in the collection
//   album_lent         an album lent to someone
//   album_returned     a lent album back on the shelf
//   loan_overdue       a loan older than the reminder delay (once per loan)
//   playback_started   a player starts playing
//   playback_stopped   a player stops (pause, closed, end of the queue)
//   track_changed      a player moves to another track
//
// Actions:
//   get_now_playing    what a player plays
//   sleep_timer        pause a player after a delay or at the end of the
//                      track (JewelBox 1.20+, a command of the remote control)
//   wake_up            play music on a player, its volume rising slowly
//                      (src/wakeup.js; remote control, JewelBox 1.18+)
//   random_album       an album drawn from the collection (optional genre)
//   album_of_the_day   the first suggestion of the day of JewelBox
//   lend_album         lend an album (by id or exact title)
//   return_album       mark an album returned
//   scan_library       scan the music folder again
//
// Event data is flat (≤ 30 keys, strings ≤ 1,000 characters).
// -----------------------------------------------------------------------------

export const TRIGGERS = {
  ALBUM_ADDED: 'album_added',
  ALBUM_LENT: 'album_lent',
  ALBUM_RETURNED: 'album_returned',
  LOAN_OVERDUE: 'loan_overdue',
  PLAYBACK_STARTED: 'playback_started',
  PLAYBACK_STOPPED: 'playback_stopped',
  TRACK_CHANGED: 'track_changed',
};

export const ACTIONS = {
  GET_NOW_PLAYING: 'get_now_playing',
  SLEEP_TIMER: 'sleep_timer',
  WAKE_UP: 'wake_up',
  RANDOM_ALBUM: 'random_album',
  ALBUM_OF_THE_DAY: 'album_of_the_day',
  LEND_ALBUM: 'lend_album',
  RETURN_ALBUM: 'return_album',
  SCAN_LIBRARY: 'scan_library',
};

export const LISTS = { OWNED: 'owned', WANTED: 'wanted' };

const MAX = 1000;
export const cut = (value, max = MAX) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/**
 * @description The data of an album, shared by events and action outputs.
 * @param {object} album - A JewelBox album.
 * @returns {object} Flat data.
 */
export function albumData(album) {
  return {
    album_id: Number.isFinite(album?.id) ? album.id : null,
    title: cut(album?.title),
    artist: cut(album?.artist?.name),
    year: Number.isInteger(album?.year) ? album.year : null,
    genre: cut(album?.genre ?? ''),
    label: cut(album?.label?.name ?? ''),
  };
}

/**
 * @description "Artist – Title (year)".
 * @param {object} album - A JewelBox album.
 * @returns {string} The text.
 */
export function albumText(album) {
  const head = [album?.artist?.name, album?.title].filter(Boolean).join(' – ');
  return Number.isInteger(album?.year) ? `${head} (${album.year})` : head;
}

export const addedEvent = (album, list, fromWishlist) => ({
  ...albumData(album),
  list,
  from_wishlist: fromWishlist,
});

export const loanEvent = (album, days) => ({
  ...albumData(album),
  borrower: cut(album.lent_to ?? ''),
  days: Number.isFinite(days) ? days : null,
});

/**
 * @description The data of a player event.
 * @param {string} device - Device external id.
 * @param {string} name - Player name.
 * @param {object|null} track - The track.
 * @returns {object} Flat data.
 */
export const playerEvent = (device, name, track) => ({
  player: device,
  player_name: cut(name),
  title: cut(track?.title ?? ''),
  artist: cut(track?.artist ?? ''),
  album: cut(track?.album ?? ''),
});

/**
 * @description The `sleep_timer` command of the duration chosen in the scene:
 * minutes (0 cancels) or the end of the current track.
 * @param {unknown} duration - The `duration` field ("30", "end_of_track", "cancel").
 * @returns {object|null} The command body, null for an unknown duration.
 */
export function sleepTimerCommand(duration) {
  const value = String(duration ?? '').trim();
  if (value === 'end_of_track') return { command: 'sleep_timer', end_of_track: true };
  if (value === 'cancel') return { command: 'sleep_timer', minutes: 0 };
  if (!/^\d{1,3}$/.test(value)) return null;
  const minutes = Number(value);
  return minutes > 0 && minutes <= 720 ? { command: 'sleep_timer', minutes } : null;
}

/**
 * @description The player events between two states.
 * @param {object|null} before - Previous playback, null at first sight.
 * @param {object} now - New playback.
 * @returns {string[]} Triggers to fire, in order.
 */
export function playerTransitions(before, now) {
  if (!before) return [];
  const out = [];
  if (!before.playing && now.playing) out.push(TRIGGERS.PLAYBACK_STARTED);
  else if (before.playing && now.playing && before.trackId !== now.trackId) {
    out.push(TRIGGERS.TRACK_CHANGED);
  }
  if (before.playing && !now.playing) out.push(TRIGGERS.PLAYBACK_STOPPED);
  return out;
}
