import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPlayback, observationOf, DEFAULT_INTERVAL_S, GRACE_S } from '../src/playback.js';
import { parseSqlDate } from '../src/client.js';

const T0 = Date.UTC(2026, 9, 24, 16, 0, 0);
const track = (id, duration = 300) => ({
  id,
  title: `T${id}`,
  artist: 'A',
  album: 'B',
  duration,
  cover: '',
});
const obs = (seconds, position, index = 0, id = 1, duration = 300) => ({
  updatedAt: T0 + seconds * 1000,
  position,
  index,
  track: track(id, duration),
  source: '',
});
// Play a sequence of [write time (s), position, index, track id]; read at `at`.
const run = (writes, readAt) => {
  let state = null;
  for (const [seconds, position, index = 0, id = 1] of writes) {
    state = nextPlayback(state, obs(seconds, position, index, id), T0 + seconds * 1000 + 500);
  }
  return readAt === undefined
    ? state
    : nextPlayback(
        state,
        obs(...writes.at(-1).slice(0, 2), writes.at(-1)[2] ?? 0, writes.at(-1)[3] ?? 1),
        T0 + readAt * 1000,
      );
};

test('observationOf: the current track of a JewelBox queue', () => {
  const queue = {
    current_index: 1,
    position_sec: 120.3,
    updated_at: '2026-10-24 16:42:12',
    source_label: 'Opvs Contra Natvram',
    tracks: [
      { id: 1, title: 'a', artist_name: 'x', album_title: 'y', duration: 100 },
      {
        id: 2,
        title: 'SAY10',
        artist_name: 'Marilyn Manson',
        album_title: 'Heaven Upside Down',
        duration: 258,
        cover_url: '/covers/x.jpg',
        album_id: 7,
      },
    ],
  };
  const observation = observationOf(queue, parseSqlDate);
  assert.equal(observation.updatedAt, Date.UTC(2026, 9, 24, 16, 42, 12));
  assert.equal(observation.track.title, 'SAY10');
  assert.equal(observation.track.duration, 258);
  assert.equal(observation.source, 'Opvs Contra Natvram');
  assert.equal(observationOf({ tracks: [] }, parseSqlDate), null);
  assert.equal(observationOf(null, parseSqlDate), null);
});

test('first sight: playing only after a recent write', () => {
  assert.equal(nextPlayback(null, obs(0, 10), T0 + 20000).playing, true);
  assert.equal(nextPlayback(null, obs(0, 10), T0 + 60000).playing, false);
  assert.equal(nextPlayback(null, null, T0).playing, false);
});

test('a write every 30 s with the position moving: playing, pace learned', () => {
  const state = run([
    [0, 0],
    [30, 30],
    [60, 60],
    [90, 90],
  ]);
  assert.equal(state.playing, true);
  assert.equal(state.interval, 30);
});

test('a write every 10 s (web app): pace 10, a pause write 4 s later is a pause', () => {
  const state = run([
    [0, 0],
    [10, 10],
    [20, 20],
    [24, 24],
  ]);
  assert.equal(state.interval, 10);
  assert.equal(state.playing, false);
});

test('a write with the same position: paused (or seek)', () => {
  assert.equal(
    run([
      [0, 0],
      [30, 30],
      [45, 30],
    ]).playing,
    false,
  );
});

test('a new track: playing, even sooner than the pace', () => {
  assert.equal(
    run([
      [0, 0],
      [30, 30],
      [35, 0, 1, 2],
    ]).playing,
    true,
  );
});

test('resumed after a long pause: playing', () => {
  assert.equal(
    run([
      [0, 0],
      [30, 30],
      [40, 40],
      [400, 70],
    ]).playing,
    true,
  );
});

test('no write for the pace + grace: stopped; pace unknown: default', () => {
  const learned = run([
    [0, 0],
    [10, 10],
    [20, 20],
  ]);
  assert.equal(
    nextPlayback(learned, obs(20, 20), T0 + (20 + 10 + GRACE_S - 1) * 1000).playing,
    true,
  );
  assert.equal(
    nextPlayback(learned, obs(20, 20), T0 + (20 + 10 + GRACE_S + 1) * 1000).playing,
    false,
  );
  const fresh = nextPlayback(null, obs(0, 0), T0 + 1000);
  assert.equal(
    nextPlayback(fresh, obs(0, 0), T0 + (DEFAULT_INTERVAL_S + GRACE_S + 1) * 1000).playing,
    false,
  );
});

test('the end of the last track passed with no new track: stopped', () => {
  let state = nextPlayback(null, obs(0, 0, 0, 1, 40), T0 + 1000);
  state = nextPlayback(state, obs(30, 30, 0, 1, 40), T0 + 30500);
  assert.equal(state.playing, true);
  assert.equal(nextPlayback(state, obs(30, 30, 0, 1, 40), T0 + 45000).playing, true);
  // 30 s of the track + 41 s since the write > 40 s + 30 s of grace.
  assert.equal(nextPlayback(state, obs(30, 30, 0, 1, 40), T0 + 71000).playing, false);
});

test('a queue that went away: stopped, pace kept', () => {
  const state = run([
    [0, 0],
    [30, 30],
    [60, 60],
  ]);
  const gone = nextPlayback(state, null, T0 + 61000);
  assert.equal(gone.playing, false);
  assert.equal(gone.interval, 30);
});
