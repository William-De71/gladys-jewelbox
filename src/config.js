// -----------------------------------------------------------------------------
// Integration configuration: the `config_schema` values of the manifest,
// normalized so the rest of the code never deals with strings from a form or
// `undefined`.
// -----------------------------------------------------------------------------

import { normalizeBaseUrl } from './client.js';

export const LANGUAGES = ['en', 'fr'];

// Defaults: they MUST stay consistent with the `default` values of the
// manifest `config_schema` (test/manifest.test.js checks it).
export const DEFAULTS = {
  server_url: '',
  language: 'fr',
  loan_reminder_days: 30,
  players_max_age_days: 90,
};

// Bounds of the numbers, the same as the manifest (min / max).
export const BOUNDS = {
  loan_reminder_days: [1, 365],
  players_max_age_days: [1, 3650],
};

const bounded = (value, [min, max], fallback) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
};

/**
 * @description Normalize the raw configuration.
 * @param {object} raw - `gladys.config` or the `onConfigUpdated` payload.
 * @returns {{ serverUrl: string, language: string, loanReminderDays: number,
 * playersMaxAgeDays: number }} The configuration.
 */
export function normalizeConfig(raw = {}) {
  return {
    serverUrl: normalizeBaseUrl(raw?.server_url),
    language: LANGUAGES.includes(raw?.language) ? raw.language : DEFAULTS.language,
    loanReminderDays: bounded(
      raw?.loan_reminder_days,
      BOUNDS.loan_reminder_days,
      DEFAULTS.loan_reminder_days,
    ),
    playersMaxAgeDays: bounded(
      raw?.players_max_age_days,
      BOUNDS.players_max_age_days,
      DEFAULTS.players_max_age_days,
    ),
  };
}
