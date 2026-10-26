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
