import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capabilitiesOf,
  commandOf,
  durationSeconds,
  parseMediaId,
  playMediaOf,
  playbackFromLive,
} from '../src/remote.js';

test('durations: seconds or the m:ss text of the albums', () => {
  assert.equal(durationSeconds(300), 300);
  assert.equal(durationSeconds('4:44'), 284);
  assert.equal(durationSeconds('1:02:03'), 3723);
  for (const bad of [0, -1, '', 'abc', '4', '1:x', null]) assert.equal(durationSeconds(bad), null);
});

test('capabilities: known ones only, sorted, no duplicates', () => {
  assert.deepEqual(capabilitiesOf(['volume', 'seek', 'volume', 'eject']), ['seek', 'volume']);
  assert.deepEqual(capabilitiesOf(null), []);
});

test('commands: one per control, refused values', () => {
  assert.deepEqual(commandOf('playing', 1), { command: 'play' });
  assert.deepEqual(commandOf('playing', '0'), { command: 'pause' });
  assert.throws(() => commandOf('playing', 2), /play or pause/);
  assert.deepEqual(commandOf('volume', 140), { command: 'volume', volume: 100 });
  assert.deepEqual(commandOf('music_position', 12.5), { command: 'seek', position_sec: 12.5 });
  assert.throws(() => commandOf('music_position', -3));
  assert.deepEqual(commandOf('repeat', 2), { command: 'repeat', repeat: 'one' });
  assert.throws(() => commandOf('repeat', 5));
  assert.deepEqual(commandOf('mute', 0), { command: 'mute', muted: false });
  assert.equal(commandOf('music_title', 'x'), null);
  assert.equal(commandOf('track', 'x'), null);
});

test('media ids: ours only, what play_media carries', () => {
  assert.deepEqual(parseMediaId('album:12'), { kind: 'album', id: 12 });
  assert.deepEqual(parseMediaId('smart:dynamic_mix'), { kind: 'smart', id: 'dynamic_mix' });
  assert.deepEqual(parseMediaId('folder:albums'), { kind: 'folder', id: 'albums' });
  for (const bad of ['album:x', 'smart:../x', 'folder:etc', 'spotify:track:1', '', null]) {
    assert.equal(parseMediaId(bad), null, String(bad));
  }
  assert.deepEqual(playMediaOf('artist:7'), { type: 'artist_radio', id: 7 });
  assert.deepEqual(playMediaOf('radio:album:3'), { type: 'album_radio', id: 3 });
  assert.equal(playMediaOf('folder:albums'), null);
});

test('live state: the playback the player reported', () => {
  const live = playbackFromLive(
    {
      state: {
        playback_state: 'paused',
        position_sec: 30,
        duration_sec: 0,
        current_index: 1,
        volume: 55,
        shuffle: true,
        repeat: 'all',
        reported_at: '2026-10-25T10:00:00.000Z',
        track: { id: 5, title: 'T', artist_name: 'A', album_title: 'B', duration: '3:00' },
      },
    },
    'Mix dynamique',
  );
  assert.equal(live.playing, false);
  assert.equal(live.track.duration, 180, 'from the track when the player gave none');
  assert.equal(live.updatedAt, Date.parse('2026-10-25T10:00:00.000Z'));
  assert.equal(live.source, 'Mix dynamique');
  assert.equal(live.volume, 55);
  assert.equal('muted' in live, false, 'absent when not reported');
  assert.equal(
    playbackFromLive({ state: { playback_state: 'idle', track: { id: 1 } } }).track,
    null,
  );
  assert.equal(playbackFromLive({ state: null }), null);
  assert.equal(playbackFromLive(undefined), null);
});

test('sleepTimerCommand: delays, end of track, cancel; nothing else', async () => {
  const { sleepTimerCommand } = await import('../src/scenes.js');
  assert.deepEqual(sleepTimerCommand('45'), { command: 'sleep_timer', minutes: 45 });
  assert.deepEqual(sleepTimerCommand(' end_of_track '), {
    command: 'sleep_timer',
    end_of_track: true,
  });
  assert.deepEqual(sleepTimerCommand('cancel'), { command: 'sleep_timer', minutes: 0 });
  for (const value of ['0', '721', '1.5', '-5', 'soon', '', null, undefined]) {
    assert.equal(sleepTimerCommand(value), null, String(value));
  }
});

test('wakeUpPlan: a bounded ramp, one volume step at a time, 30 commands at most', async () => {
  const { wakeUpPlan, MAX_STEPS } = await import('../src/wakeup.js');
  const plan = wakeUpPlan({ start_volume: 5, end_volume: 15, duration: 10 });
  assert.equal(plan.start, 5);
  assert.deepEqual(
    plan.steps.map((s) => s.volume),
    [6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  );
  assert.ok(plan.steps.every((s) => s.afterMs === 60000));
  const long = wakeUpPlan({ start_volume: 0, end_volume: 100, duration: 30 });
  assert.equal(long.steps.length, MAX_STEPS);
  assert.equal(long.steps.at(-1).volume, 100);
  assert.equal(long.steps[0].afterMs, 60000);
  assert.deepEqual(wakeUpPlan({}).start, 5);
  assert.equal(wakeUpPlan({}).steps.at(-1).volume, 40);
  assert.deepEqual(wakeUpPlan({ start_volume: 30, end_volume: 30 }).steps, []);
  assert.deepEqual(wakeUpPlan({ start_volume: 5, end_volume: 50, duration: 0 }), {
    start: 50,
    end: 50,
    steps: [],
  });
  assert.equal(wakeUpPlan({ start_volume: -20, end_volume: 300 }).start, 0);
  assert.deepEqual(
    wakeUpPlan({ start_volume: 50, end_volume: 47, duration: 3 }).steps.map((s) => s.volume),
    [49, 48, 47],
  );
});

test('rampGoesOn: gives way to the user and to a stop', async () => {
  const { rampGoesOn } = await import('../src/wakeup.js');
  assert.equal(rampGoesOn(null, 10), true);
  assert.equal(rampGoesOn({ live: true, playing: true, volume: 11 }, 10), true);
  assert.equal(rampGoesOn({ live: true, playing: true, volume: 3 }, 10), false);
  assert.equal(rampGoesOn({ live: true, playing: false, volume: 10 }, 10), false);
  assert.equal(rampGoesOn({ live: false, playing: false }, 10), true);
});
