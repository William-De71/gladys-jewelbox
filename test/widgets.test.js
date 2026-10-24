import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import {
  LOAN_ITEMS,
  buildAlbumOfTheDayWidget,
  buildCollectionWidget,
  buildLoansWidget,
  buildNowPlayingWidget,
  buildRecentlyAddedWidget,
  coverFile,
  coverKey,
} from '../src/widgets.js';
import { makeAlbum } from './helpers/fake-jewelbox.js';

const NOW = Date.UTC(2026, 9, 24, 16, 0, 0);
const valid = (content) => assert.deepEqual(validateWidgetContent(content), []);
const long = 'x'.repeat(300);

test('cover keys: only JewelBox covers, round trip', () => {
  const key = coverKey('/covers/A1E67298241294DFFE2E8F3A18F72D24.JPEG');
  assert.equal(key, 'jb-a1e67298241294dffe2e8f3a18f72d24-jpeg');
  assert.match(key, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.equal(coverFile(key), 'a1e67298241294dffe2e8f3a18f72d24.jpeg');
  for (const url of [
    'https://coverartarchive.org/x.jpg',
    '/covers/../x.jpg',
    '/covers/abc.gif',
    null,
  ]) {
    assert.equal(coverKey(url), null, String(url));
  }
  assert.equal(coverFile('jb-../../etc'), null);
});

test('every widget, empty or overflowing, stays valid in both languages', () => {
  for (const language of ['en', 'fr']) {
    valid(buildNowPlayingWidget({ player: null, playback: null, serverNow: NOW, language }));
    valid(
      buildNowPlayingWidget({
        player: { id: 'a', name: long },
        playback: null,
        serverNow: NOW,
        language,
      }),
    );
    valid(
      buildNowPlayingWidget({
        player: { id: 'a', name: 'JewelBox' },
        playback: {
          playing: false,
          updatedAt: NOW - 3 * 86400000,
          source: long,
          track: {
            title: long,
            artist: long,
            album: long,
            cover: '/covers/a1e67298241294dffe2e8f3a18f72d24.jpg',
          },
        },
        serverNow: NOW,
        language,
      }),
    );
    valid(buildCollectionWidget({ stats: null, collection: '', language }));
    valid(
      buildCollectionWidget({
        stats: { total_owned: 0, by_decade: [], by_genre: [] },
        collection: long,
        language,
      }),
    );
    valid(
      buildCollectionWidget({
        stats: {
          total_owned: 651,
          total_wanted: 87,
          total_lent: 2,
          total_artists: 237,
          avg_rating: 4.6,
          total_duration_hours: 572,
          by_decade: [
            { decade: 1990, count: 121 },
            { decade: null, count: 3 },
          ],
          by_genre: Array.from({ length: 12 }, (_, i) => ({ genre: `${long}${i}`, count: i })),
        },
        collection: 'will_cd_collections',
        language,
      }),
    );
    valid(
      buildLoansWidget({
        lent: null,
        reminderDays: 30,
        nowMs: NOW,
        language,
        timeZone: 'Europe/Paris',
      }),
    );
    valid(
      buildLoansWidget({
        lent: [],
        reminderDays: 30,
        nowMs: NOW,
        language,
        timeZone: 'Europe/Paris',
      }),
    );
    const many = Array.from({ length: LOAN_ITEMS + 3 }, (_, i) =>
      makeAlbum({
        id: i + 1,
        title: long,
        is_lent: true,
        lent_to: i % 2 ? long : null,
        lent_at: i % 3 ? new Date(NOW - i * 86400000).toISOString() : null,
      }),
    );
    const loans = buildLoansWidget({
      lent: many,
      reminderDays: 30,
      nowMs: NOW,
      language,
      timeZone: 'Europe/Paris',
    });
    valid(loans);
    assert.equal(loans.components[0].items.length, LOAN_ITEMS);
    valid(buildAlbumOfTheDayWidget({ album: null, drawn: false, reachable: true, language }));
    valid(
      buildAlbumOfTheDayWidget({
        album: makeAlbum({ title: long, genre: long, is_lent: true, lent_to: long }),
        drawn: true,
        reachable: true,
        language,
      }),
    );
    valid(buildRecentlyAddedWidget({ albums: null, list: 'all', language }));
    valid(buildRecentlyAddedWidget({ albums: [], list: 'wanted', language }));
    const recent = buildRecentlyAddedWidget({
      albums: Array.from({ length: 20 }, (_, i) =>
        makeAlbum({ title: long, is_wanted: i % 2 === 0 }),
      ),
      list: 'all',
      language,
    });
    valid(recent);
    assert.equal(recent.components[0].items.length, 9);
  }
});

test('loans: oldest first, overdue in orange, borrower and date in the subtitle', () => {
  const content = buildLoansWidget({
    lent: [
      makeAlbum({
        title: 'Recent',
        is_lent: true,
        lent_to: 'Max',
        lent_at: new Date(NOW - 2 * 86400000).toISOString(),
      }),
      makeAlbum({
        title: 'Old',
        is_lent: true,
        lent_to: 'Julie',
        lent_at: '2026-09-01T10:00:00.000Z',
      }),
    ],
    reminderDays: 30,
    nowMs: NOW,
    language: 'fr',
    timeZone: 'Europe/Paris',
  });
  const [old, recent] = content.components[0].items;
  assert.equal(old.title, 'Old');
  assert.equal(old.subtitle, 'Julie depuis le 01/09/2026 · Opeth');
  assert.deepEqual(old.badge, { text: '53 j', color: 'warning' });
  assert.equal(recent.badge.color, 'neutral');
});
