// -----------------------------------------------------------------------------
// Dates shown to the user, in the time zone the Gladys supervisor gives the
// container (TZ), Europe/Paris when there is none.
// -----------------------------------------------------------------------------

export const FALLBACK_TIME_ZONE = 'Europe/Paris';

/**
 * @description The time zone of the dates shown to the user.
 * @param {string} [candidate] - Usually `process.env.TZ`.
 * @returns {string} A valid IANA time zone, Europe/Paris otherwise.
 */
export function displayTimeZone(candidate = process.env.TZ) {
  if (typeof candidate === 'string' && candidate.trim() !== '' && candidate !== ':/etc/localtime') {
    try {
      new Intl.DateTimeFormat('en', { timeZone: candidate.trim() });
      return candidate.trim();
    } catch {
      // Not an IANA name: fall through.
    }
  }
  return FALLBACK_TIME_ZONE;
}

/**
 * @description A short date: 12/10/2026 (French), 12 Oct 2026 (English).
 * @param {number} ms - Instant (ms).
 * @param {string} language - `en` or `fr`.
 * @param {string} timeZone - Time zone.
 * @returns {string} The date, '' without an instant.
 */
export function shortDate(ms, language, timeZone) {
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat(language === 'fr' ? 'fr-FR' : 'en-GB', {
    timeZone,
    day: language === 'fr' ? '2-digit' : 'numeric',
    month: language === 'fr' ? '2-digit' : 'short',
    year: 'numeric',
  }).format(new Date(ms));
}
