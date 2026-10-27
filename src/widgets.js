// -----------------------------------------------------------------------------
// The dashboard widgets (pure: built from what app.js knows, reused by
// docs/illustrations/gen.mjs).
//
//   now_playing        a player: cover, track, artist, album, source, state
//   collection         counters (tiles), albums by decade (chart), top genres;
//                      or, with the "view" setting, my listening: plays today
//                      and of the period, listening time, the most played
//                      albums (JewelBox 1.20+). Gladys takes 5 widgets at most.
//   loans              the albums lent out: borrower, since when, days
//   album_of_the_day   the suggestion of the day of JewelBox, or an album
//                      drawn by the "Another album" button
//   recently_added     the latest albums added (covers grid)
//
// Covers come from the JewelBox server (`/covers/<md5>.<ext>`): the content
// gives a key built from the file name (coverKey), and the image handler of
// app.js rebuilds the file name from the key alone: it can only ever fetch a
// JewelBox cover, never another URL.
//
// Budget of a card: 8 components, 1 focal, 6 tiles, 2 texts (1 body),
// 1 status (10 rows), 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { all, ago, t } from './i18n.js';
import { parseSqlDate } from './client.js';
import { daysSince } from './collection.js';
import { shortDate } from './time.js';

export const WIDGETS = {
  NOW_PLAYING: 'now_playing',
  COLLECTION: 'collection',
  LOANS: 'loans',
  ALBUM_OF_THE_DAY: 'album_of_the_day',
  RECENTLY_ADDED: 'recently_added',
};
export const BUTTONS = { ANOTHER: 'another', TODAY: 'today' };
export const LIST_SETTING = { ALL: 'all', OWNED: 'owned', WANTED: 'wanted' };
export const VIEW_SETTING = { COLLECTION: 'collection', LISTENING: 'listening' };
export const PERIOD_SETTING = { MONTH: 'month', YEAR: 'year', ALL: 'all' };
export const TOP_ALBUMS = 5;
export const LOAN_ITEMS = 8;
export const RECENT_ITEMS = 9;
const TOP_GENRES = 4;

const cut = (value, max) => {
  const text = String(value ?? '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const COVER_FILE = /^\/covers\/([0-9a-f]{32})\.(jpe?g|png|webp)$/i;
const COVER_KEY = /^jb-([0-9a-f]{32})-(jpe?g|png|webp)$/;

/**
 * @description The image key of a JewelBox cover.
 * @param {unknown} coverUrl - `cover_url` of an album or a track.
 * @returns {string|null} `jb-<md5>-<ext>`, null for anything else (no
 * cover, a cover outside the server).
 */
export function coverKey(coverUrl) {
  const match = COVER_FILE.exec(String(coverUrl ?? ''));
  return match ? `jb-${match[1].toLowerCase()}-${match[2].toLowerCase()}` : null;
}

/**
 * @description The cover file of an image key.
 * @param {unknown} key - An image key.
 * @returns {string|null} `<md5>.<ext>`, null for an unknown key.
 */
export function coverFile(key) {
  const match = COVER_KEY.exec(String(key ?? ''));
  return match ? `${match[1]}.${match[2]}` : null;
}

const heading = (text) => ({ type: 'text', variant: 'heading', text });
const body = (key) => ({ type: 'text', variant: 'body', text: all(key) });
const stars = (rating) =>
  Number.isInteger(rating) && rating >= 1 && rating <= 5
    ? `${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}`
    : '';

/**
 * @description The "Now playing" widget.
 * @param {object} params - Parameters.
 * @param {{ id: string, name: string }|null} params.player - The player.
 * @param {object|null} params.playback - `nextPlayback()`, null before the
 * first reading.
 * @param {number} params.serverNow - Now on the server clock (ms).
 * @param {string} params.language - Language.
 * @returns {object} The content.
 */
export function buildNowPlayingWidget({ player, playback, serverNow, language }) {
  if (!player) return { ttl_seconds: 300, components: [body('widgetNoPlayer')] };
  const components = [heading(cut(player.name, 40))];
  const track = playback?.track ?? null;
  const items = [];
  const row = (labelKey, value, icon, color = WIDGET_COLORS.NEUTRAL) => {
    if (value) items.push({ label: t(labelKey, language), value: cut(value, 40), icon, color });
  };
  if (!track) {
    row('widgetState', t('widgetNoQueue', language), 'square');
  } else {
    const key = coverKey(track.cover);
    if (key) {
      components.push({
        type: 'image',
        key,
        alt: cut(t('widgetCoverOf', language, { album: track.album }), 100),
        fit: 'contain',
      });
    }
    row('widgetTrack', track.title, 'music', WIDGET_COLORS.PRIMARY);
    row('widgetArtist', track.artist, 'user');
    row('widgetAlbum', track.album, 'disc');
    row('widgetSource', playback.source, 'list');
    if (playback.playing) {
      row('widgetState', t('widgetPlaying', language), 'play', WIDGET_COLORS.SUCCESS);
    } else {
      const at = Number.isFinite(playback.updatedAt) ? playback.updatedAt : 0;
      row(
        'widgetState',
        t('widgetStopped', language, { ago: ago(at, serverNow, language) }),
        'pause',
      );
    }
  }
  components.push({ type: 'status', items });
  return { ttl_seconds: 15, components };
}

/**
 * @description The "Collection" widget.
 * @param {object} params - Parameters.
 * @param {object|null} params.stats - `GET /api/stats`.
 * @param {string} params.collection - Name of the active collection.
 * @param {string} params.language - Language.
 * @returns {object} The content.
 */
export function buildCollectionWidget({ stats, collection, language }) {
  if (!stats) return { ttl_seconds: 60, components: [body('widgetNoServer')] };
  const tile = (labelKey, value, icon, color, unit) => ({
    type: 'value',
    label: all(labelKey),
    value: Number.isFinite(value) ? value : 0,
    icon,
    color,
    ...(unit ? { unit } : {}),
  });
  const hours = Number(stats.total_duration_hours) || 0;
  const components = [
    heading(cut(collection || 'JewelBox', 40)),
    tile('feature_owned', stats.total_owned, 'disc', WIDGET_COLORS.PRIMARY),
    tile('widgetTileWanted', stats.total_wanted, 'heart', WIDGET_COLORS.INFO),
    tile(
      'feature_lent',
      stats.total_lent,
      'share',
      stats.total_lent > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    ),
    tile('feature_artists', stats.total_artists, 'users', WIDGET_COLORS.NEUTRAL),
    tile('widgetHours', hours, 'clock', WIDGET_COLORS.NEUTRAL, 'h'),
  ];
  const decades = (Array.isArray(stats.by_decade) ? stats.by_decade : []).filter(
    (row) => Number.isInteger(row.decade) && row.decade >= 1900 && row.decade <= 2100,
  );
  if (decades.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: all('widgetByDecade'),
      series: [
        {
          name: all('widgetAlbums'),
          points: decades.map((row) => ({
            t: `${row.decade}-01-01T00:00:00.000Z`,
            v: Number(row.count) || 0,
          })),
        },
      ],
    });
  }
  const items = (Array.isArray(stats.by_genre) ? stats.by_genre : [])
    .slice(0, TOP_GENRES)
    .map((row) => ({ label: cut(row.genre, 40), value: Number(row.count) || 0, icon: 'tag' }));
  const rating = Number(stats.avg_rating);
  if (Number.isFinite(rating) && rating > 0) {
    items.push({
      label: t('widgetAverageRating', language),
      value: `${rating.toLocaleString(language)} / 5`,
      icon: 'star',
      color: WIDGET_COLORS.WARNING,
    });
  }
  if (items.length > 0) components.push({ type: 'status', items });
  return { ttl_seconds: 300, components };
}

/**
 * @description The "Loans" widget.
 * @param {object} params - Parameters.
 * @param {object[]|null} params.lent - The albums lent out, null when unknown.
 * @param {number} params.reminderDays - Reminder delay (days).
 * @param {number} params.nowMs - Now (ms).
 * @param {string} params.language - Language.
 * @param {string} params.timeZone - Time zone of the dates.
 * @returns {object} The content.
 */
export function buildLoansWidget({ lent, reminderDays, nowMs, language, timeZone }) {
  if (!lent) return { ttl_seconds: 60, components: [body('widgetNoServer')] };
  if (lent.length === 0) return { ttl_seconds: 300, components: [body('widgetNoLoan')] };
  const sorted = [...lent].sort(
    (a, b) => (parseSqlDate(a.lent_at) || 0) - (parseSqlDate(b.lent_at) || 0),
  );
  const items = sorted.slice(0, LOAN_ITEMS).map((album) => {
    const days = daysSince(album.lent_at, nowMs);
    const since = shortDate(parseSqlDate(album.lent_at), language, timeZone);
    // A subtitle is 60 characters at most: the borrower is cut first.
    const who = cut(album.lent_to || t('widgetSomeone', language), 24);
    const item = {
      title: cut(album.title, 60),
      subtitle: cut(
        since
          ? t('widgetLentSince', language, { who, since, artist: album.artist?.name ?? '' })
          : t('widgetLentTo', language, { who, artist: album.artist?.name ?? '' }),
        60,
      ),
    };
    const key = coverKey(album.cover_url);
    if (key) item.image = key;
    if (days !== null) {
      item.badge = {
        text: cut(t('widgetDays', language, { n: days }), 16),
        color: days >= reminderDays ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      };
    }
    return item;
  });
  const components = [{ type: 'card-list', display: 'list', items }];
  if (sorted.length > LOAN_ITEMS) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: all('widgetMore', { n: sorted.length - LOAN_ITEMS }),
    });
  }
  return { ttl_seconds: 300, components };
}

/**
 * @description The "Album of the day" widget.
 * @param {object} params - Parameters.
 * @param {object|null} params.album - The album.
 * @param {boolean} params.drawn - Drawn by the button (else: the suggestion
 * of the day of JewelBox).
 * @param {boolean} params.reachable - Whether the server answers.
 * @param {string} params.language - Language.
 * @returns {object} The content.
 */
export function buildAlbumOfTheDayWidget({ album, drawn, reachable, language }) {
  if (!album) {
    return {
      ttl_seconds: 300,
      components: [body(reachable ? 'widgetEmptyCollection' : 'widgetNoServer')],
    };
  }
  const components = [heading(cut(album.title, 40))];
  const key = coverKey(album.cover_url);
  if (key) {
    components.push({
      type: 'image',
      key,
      alt: cut(t('widgetCoverOf', language, { album: album.title }), 100),
      fit: 'contain',
    });
  }
  const items = [];
  const row = (labelKey, value, icon, color = WIDGET_COLORS.NEUTRAL) => {
    if (value) items.push({ label: t(labelKey, language), value: cut(value, 40), icon, color });
  };
  row('widgetArtist', album.artist?.name, 'user', WIDGET_COLORS.PRIMARY);
  row('widgetYear', Number.isInteger(album.year) ? String(album.year) : '', 'calendar');
  row('widgetGenre', album.genre, 'tag');
  row('widgetLabel', album.label?.name, 'briefcase');
  row('widgetRating', stars(album.rating), 'star', WIDGET_COLORS.WARNING);
  if (album.is_lent)
    row(
      'widgetLent',
      album.lent_to || t('widgetSomeone', language),
      'share',
      WIDGET_COLORS.WARNING,
    );
  row(
    'widgetPick',
    t(drawn ? 'widgetPickDrawn' : 'widgetPickToday', language),
    drawn ? 'shuffle' : 'sun',
    WIDGET_COLORS.INFO,
  );
  if (items.length > 0) components.push({ type: 'status', items });
  components.push({
    type: 'button',
    label: all('widgetAnother'),
    icon: 'shuffle',
    style: 'secondary',
    action: { key: BUTTONS.ANOTHER },
  });
  if (drawn) {
    components.push({
      type: 'button',
      label: all('widgetToday'),
      icon: 'sun',
      style: 'secondary',
      action: { key: BUTTONS.TODAY },
    });
  }
  return { ttl_seconds: 600, components };
}

/**
 * @description The "Recently added" widget.
 * @param {object} params - Parameters.
 * @param {object[]|null} params.albums - The latest albums, newest first.
 * @param {string} params.list - LIST_SETTING value.
 * @param {string} params.language - Language.
 * @returns {object} The content.
 */
export function buildRecentlyAddedWidget({ albums, list, language }) {
  if (!albums) return { ttl_seconds: 60, components: [body('widgetNoServer')] };
  const shown = albums
    .filter((album) => {
      if (list === LIST_SETTING.OWNED) return !album.is_wanted;
      if (list === LIST_SETTING.WANTED) return album.is_wanted;
      return true;
    })
    .slice(0, RECENT_ITEMS);
  if (shown.length === 0) return { ttl_seconds: 300, components: [body('widgetNothingAdded')] };
  const items = shown.map((album) => {
    const item = { title: cut(album.title, 60), subtitle: cut(album.artist?.name ?? '', 60) };
    const key = coverKey(album.cover_url);
    if (key) item.image = key;
    if (album.is_wanted && list !== LIST_SETTING.WANTED) {
      item.badge = { text: cut(t('widgetWishlist', language), 16), color: WIDGET_COLORS.INFO };
    }
    return item;
  });
  return { ttl_seconds: 300, components: [{ type: 'card-list', display: 'grid', items }] };
}

const PERIOD_TILE = {
  [PERIOD_SETTING.MONTH]: 'widgetPlaysMonth',
  [PERIOD_SETTING.YEAR]: 'widgetPlaysYear',
  [PERIOD_SETTING.ALL]: 'widgetPlaysAll',
};

/**
 * @description The "My listening" view of the "Collection" widget.
 * @param {object} params - Parameters.
 * @param {object|null|undefined} params.listening - `GET /api/player/stats`
 * for the period; null for a server older than 1.20, undefined when the
 * server does not answer.
 * @param {string} params.period - PERIOD_SETTING value.
 * @param {string} params.language - Language.
 * @returns {object} The content.
 */
export function buildListeningWidget({ listening, period, language }) {
  if (listening === undefined) return { ttl_seconds: 60, components: [body('widgetNoServer')] };
  if (!listening) return { ttl_seconds: 600, components: [body('widgetListeningUnavailable')] };
  const tile = (labelKey, value, icon, color, unit) => ({
    type: 'value',
    label: all(labelKey),
    value: Number.isFinite(value) ? value : 0,
    icon,
    color,
    ...(unit ? { unit } : {}),
  });
  const counters = listening.counters ?? {};
  const minutes = Number(listening.summary?.listening_minutes) || 0;
  const components = [
    tile('widgetPlaysToday', counters.plays_today, 'headphones', WIDGET_COLORS.PRIMARY),
    tile(
      PERIOD_TILE[period] ?? 'widgetPlaysMonth',
      period === PERIOD_SETTING.ALL ? counters.plays_all : listening.summary?.plays,
      'calendar',
      WIDGET_COLORS.INFO,
    ),
    tile('widgetListeningTime', Math.round(minutes / 6) / 10, 'clock', WIDGET_COLORS.NEUTRAL, 'h'),
  ];
  const albums = (Array.isArray(listening.top?.albums) ? listening.top.albums : []).slice(
    0,
    TOP_ALBUMS,
  );
  if (albums.length === 0) {
    components.push(body('widgetNoPlays'));
  } else {
    const items = albums.map((album) => {
      const plays = Number(album.plays) || 0;
      const item = {
        title: cut(album.title, 60),
        subtitle: cut(album.artist_name ?? '', 60),
        badge: {
          text: cut(
            plays === 1 ? t('widgetPlay', language) : t('widgetPlays', language, { n: plays }),
            16,
          ),
          color: WIDGET_COLORS.NEUTRAL,
        },
      };
      const key = coverKey(album.cover_url);
      if (key) item.image = key;
      return item;
    });
    components.push({ type: 'card-list', display: 'list', items });
  }
  return { ttl_seconds: 300, components };
}
