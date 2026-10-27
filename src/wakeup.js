// -----------------------------------------------------------------------------
// "Wake up to music" (pure): the volume ramp of the wake_up scene action.
//
// The player starts at the start volume, then the integration raises it one
// step at a time until the end volume, over the duration. At most MAX_STEPS
// commands. The ramp gives way to the user: a volume that is no longer the
// one last sent (turned down by hand, from Gladys or the player), or a player
// that stopped, ends it.
// -----------------------------------------------------------------------------

export const MAX_STEPS = 30;
export const WAKE_UP_MUSIC = {
  DYNAMIC_MIX: 'dynamic_mix',
  FAVOURITES: 'favourites',
  RANDOM_ALBUM: 'random_album',
  ALBUM_OF_THE_DAY: 'album_of_the_day',
  ALBUM: 'album',
  PLAYLIST: 'playlist',
};
// A live volume this far from the one sent is the user's hand.
export const VOLUME_TOLERANCE = 3;

const bounded = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/**
 * @description The ramp of a wake up.
 * @param {object} fields - Scene fields: start_volume, end_volume, duration (minutes).
 * @returns {{ start: number, end: number, steps: Array<{ afterMs: number, volume: number }> }}
 * The volume to start with, and the commands after it (delay since the previous one).
 */
export function wakeUpPlan(fields) {
  const start = bounded(fields?.start_volume, 0, 100, 5);
  const end = bounded(fields?.end_volume, 0, 100, 40);
  const minutes = bounded(fields?.duration, 0, 60, 10);
  const distance = end - start;
  if (distance === 0 || minutes === 0)
    return { start: minutes === 0 ? end : start, end, steps: [] };
  const count = Math.min(Math.abs(distance), MAX_STEPS);
  const afterMs = Math.round((minutes * 60000) / count);
  const steps = [];
  for (let i = 1; i <= count; i++) {
    steps.push({ afterMs, volume: Math.round(start + (distance * i) / count) });
  }
  return { start, end, steps };
}

/**
 * @description Whether the ramp may go on.
 * @param {object|null} playback - The live playback of the player (src/remote.js).
 * @param {number} lastSent - The volume the ramp sent last.
 * @returns {boolean} False once the user took over or the music stopped.
 */
export function rampGoesOn(playback, lastSent) {
  if (!playback?.live) return true; // no live state yet: nothing says otherwise
  if (!playback.playing) return false;
  if (Number.isFinite(playback.volume) && Math.abs(playback.volume - lastSent) > VOLUME_TOLERANCE)
    return false;
  return true;
}
