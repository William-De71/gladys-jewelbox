// -----------------------------------------------------------------------------
// What changed in the collection between two readings (pure).
//
// A reading (every minute) holds the active collection (JewelBox can hold
// several, each with its own album ids), its statistics, the latest albums
// added, the wish list and the albums lent out. From two readings:
//
//   added      an album id above the largest one seen (ids only grow) →
//              album_added (list: owned or wanted)
//   left       an album that left the wish list → to check: bought (it is
//              now in the collection, album_added with from_wishlist) or
//              deleted (nothing)
//   lent       an album lent, or lent to someone else → album_lent
//   returned   an album no longer lent → to check: returned, or deleted
//              while lent (nothing)
//   overdue    a loan older than the reminder delay, once per loan (the
//              reminders survive a restart, /data/reminders.json)
//
// Never an event at the first reading, nor when the active collection
// changed (another set of albums, not changes); a bulk import (more than
// MAX_ADDED new albums in one reading) is announced as nothing.
// -----------------------------------------------------------------------------

import { parseSqlDate } from './client.js';

export const MAX_ADDED = 10;
const DAY_MS = 24 * 3600 * 1000;

/**
 * @description Whole days since a date.
 * @param {unknown} date - A JewelBox date.
 * @param {number} nowMs - Now (ms).
 * @returns {number|null} Days, null when unknown.
 */
export function daysSince(date, nowMs) {
  const at = parseSqlDate(date);
  return Number.isFinite(at) ? Math.max(0, Math.floor((nowMs - at) / DAY_MS)) : null;
}

/**
 * @description The key of a loan (a reminder is sent once per key).
 * @param {number} dbId - Collection id.
 * @param {object} album - A lent album.
 * @returns {string} The key.
 */
export const loanKey = (dbId, album) => `${dbId}:${album.id}:${album.lent_at ?? ''}`;

/**
 * @description The base of the next comparison.
 * @param {object} reading - `{ dbId, recent, wanted, lent }`.
 * @param {object|null} previous - The previous base, for the largest id.
 * @returns {object} `{ dbId, maxId, wanted: Set, lent: Map<id, album> }`.
 */
export function baseOf(reading, previous) {
  const ids = [...reading.recent, ...reading.wanted, ...reading.lent].map((album) => album.id);
  const sameDb = previous && previous.dbId === reading.dbId;
  return {
    dbId: reading.dbId,
    maxId: Math.max(sameDb ? previous.maxId : 0, 0, ...ids.filter(Number.isFinite)),
    wanted: new Set(reading.wanted.map((album) => album.id)),
    lent: new Map(reading.lent.map((album) => [album.id, album])),
  };
}

/**
 * @description The changes between the base and a new reading.
 * @param {object|null} base - `baseOf()` of the previous reading, null at first.
 * @param {object} reading - `{ dbId, recent, wanted, lent }`.
 * @param {object} options - Options.
 * @param {number} options.nowMs - Now (ms).
 * @param {number} options.reminderDays - Reminder delay of a loan (days).
 * @param {Set<string>} options.reminded - Loans already reminded (loanKey).
 * @returns {{ added: object[], left: number[], lent: object[], returned: object[],
 * overdue: Array<{ album: object, days: number, key: string }>, bulk: number }}
 * The changes (`returned` holds the album as it was lent).
 */
export function changesOf(base, reading, { nowMs, reminderDays, reminded }) {
  const overdue = [];
  for (const album of reading.lent) {
    const days = daysSince(album.lent_at, nowMs);
    const key = loanKey(reading.dbId, album);
    if (days !== null && days >= reminderDays && !reminded.has(key)) {
      overdue.push({ album, days, key });
    }
  }
  const out = { added: [], left: [], lent: [], returned: [], overdue, bulk: 0 };
  if (!base || base.dbId !== reading.dbId) return out;

  const fresh = new Map();
  for (const album of [...reading.recent, ...reading.wanted]) {
    if (Number.isFinite(album.id) && album.id > base.maxId) fresh.set(album.id, album);
  }
  if (fresh.size > MAX_ADDED) {
    out.bulk = fresh.size;
  } else {
    out.added = [...fresh.values()].sort((a, b) => a.id - b.id);
  }
  const wantedNow = new Set(reading.wanted.map((album) => album.id));
  out.left = [...base.wanted].filter((id) => !wantedNow.has(id));

  const lentNow = new Map(reading.lent.map((album) => [album.id, album]));
  for (const [id, album] of lentNow) {
    const before = base.lent.get(id);
    if (!before || (before.lent_to ?? '') !== (album.lent_to ?? '')) out.lent.push(album);
  }
  for (const [id, album] of base.lent) {
    if (!lentNow.has(id)) out.returned.push(album);
  }
  return out;
}

/**
 * @description The oldest loan still running.
 * @param {object[]} lent - The albums lent out.
 * @param {number} nowMs - Now (ms).
 * @returns {number} Its age in days, 0 without loan.
 */
export function oldestLoanDays(lent, nowMs) {
  return lent.reduce((max, album) => Math.max(max, daysSince(album.lent_at, nowMs) ?? 0), 0);
}
