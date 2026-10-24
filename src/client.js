// -----------------------------------------------------------------------------
// HTTP client of the JewelBox Music Library REST API (no authentication, on
// the local network, port 3001 by default).
//
// Every request carries `X-Device-Id: gladys-integration`: the player routes
// require one (each JewelBox device has its own queue). The integration only
// reads queues, it never writes one, so this id never gets a queue of its own.
//
// The `Date` header of every answer gives the clock of the server: the age of
// a queue position (`updated_at`, written by SQLite in UTC) is measured with
// it, never with the clock of the container.
// -----------------------------------------------------------------------------

export const DEVICE_ID = 'gladys-integration';
const TIMEOUT_MS = 10 * 1000;

export class JewelBoxError extends Error {
  /**
   * @param {string} kind - `network`, `http`, `invalid`.
   * @param {string} message - Message (never shown as is to the user).
   * @param {number} [status] - HTTP status.
   */
  constructor(kind, message, status = 0) {
    super(message);
    this.name = 'JewelBoxError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * @description Normalize a server address typed by the user: an http(s) URL
 * without path, query nor trailing slash; a bare host gets `http://` and the
 * default port 3001.
 * @param {unknown} value - What the user typed.
 * @returns {string} The base URL, '' when invalid.
 */
export function normalizeBaseUrl(value) {
  let text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) text = `http://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return '';
  if (url.username || url.password) return '';
  if (!url.port && url.protocol === 'http:' && !/:\d+$/.test(url.host)) url.port = '3001';
  return `${url.protocol}//${url.host}`;
}

/**
 * @description `YYYY-MM-DD HH:MM:SS` written by SQLite `datetime('now')`
 * (UTC, no zone) → ms. An ISO date with a zone is read as is.
 * @param {unknown} value - The date.
 * @returns {number} Ms, NaN when invalid.
 */
export function parseSqlDate(value) {
  if (typeof value !== 'string' || !value.trim()) return NaN;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
    return Date.parse(`${text.replace(' ', 'T')}Z`);
  }
  return Date.parse(text);
}

/**
 * @description Create the client.
 * @param {object} [deps] - Dependencies.
 * @param {Function} [deps.fetch] - fetch (tests).
 * @param {Function} [deps.now] - Clock (ms), when an answer has no Date header.
 * @returns {object} The client.
 */
export function createClient({ fetch = globalThis.fetch, now = Date.now } = {}) {
  /**
   * @description One request.
   * @param {string} base - Base URL of the server.
   * @param {string} path - Path, starting with `/api/` or `/covers/`.
   * @param {object} [options] - `{ method, body, raw }`.
   * @returns {Promise<{ data: any, serverNow: number }>} The answer.
   */
  const request = async (base, path, { method = 'GET', body, raw = false } = {}) => {
    if (!base) throw new JewelBoxError('network', 'no server address');
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        headers: {
          Accept: raw ? '*/*' : 'application/json',
          'X-Device-Id': DEVICE_ID,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new JewelBoxError('network', error?.cause?.code ?? error?.name ?? 'unreachable');
    }
    const date = Date.parse(response.headers.get('date') ?? '');
    const serverNow = Number.isFinite(date) ? date : now();
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const json = await response.json();
        if (typeof json?.error === 'string') message = json.error.slice(0, 200);
      } catch {
        // Not JSON: the status is enough.
      }
      throw new JewelBoxError('http', message, response.status);
    }
    if (raw) {
      return {
        data: Buffer.from(await response.arrayBuffer()),
        type: response.headers.get('content-type') ?? '',
        serverNow,
      };
    }
    if (response.status === 202 || response.status === 204) return { data: null, serverNow };
    try {
      return { data: await response.json(), serverNow };
    } catch {
      throw new JewelBoxError('invalid', 'the answer is not JSON');
    }
  };

  const get = async (base, path) => (await request(base, path)).data;
  const query = (params) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
    }
    const text = search.toString();
    return text ? `?${text}` : '';
  };

  return {
    request,

    /**
     * @description The identity of a server: checks it is a JewelBox.
     * @param {string} base - Base URL.
     * @returns {Promise<{ serverId: string, name: string, version: string, collection: string }>}
     * The identity.
     */
    async serverInfo(base) {
      const info = await get(base, '/api/server-info');
      if (info?.app !== 'jewelbox' || typeof info.server_id !== 'string' || !info.server_id) {
        throw new JewelBoxError('invalid', 'not a JewelBox server');
      }
      return {
        serverId: info.server_id,
        name: typeof info.name === 'string' ? info.name : 'JewelBox',
        version: typeof info.version === 'string' ? info.version : '',
        collection: typeof info.collection === 'string' ? info.collection : '',
      };
    },

    stats: (base) => get(base, '/api/stats'),

    /**
     * @param {string} base - Base URL.
     * @returns {Promise<{ id: number, name: string }|null>} The active collection.
     */
    async activeDatabase(base) {
      const data = await get(base, '/api/database/active');
      const db = data?.database;
      return db && Number.isFinite(db.id) ? { id: db.id, name: String(db.name ?? '') } : null;
    },

    /**
     * @param {string} base - Base URL.
     * @param {object} params - `page`, `limit`, `sort`, `order`, `search`, `genre`, `lent`, `wanted`.
     * @returns {Promise<{ data: object[], total: number }>} A page of albums.
     */
    async albums(base, params = {}) {
      const page = await get(base, `/api/albums${query(params)}`);
      return {
        data: Array.isArray(page?.data) ? page.data : [],
        total: Number(page?.pagination?.total) || 0,
      };
    },

    album: (base, id) => get(base, `/api/albums/${Number(id)}`),

    home: (base) => get(base, '/api/player/home'),

    /**
     * @param {string} base - Base URL.
     * @returns {Promise<{ devices: object[], serverNow: number }>} The players
     * that left a queue, with the clock of the server.
     */
    async players(base) {
      const { data, serverNow } = await request(base, '/api/player/queue/devices');
      return { devices: Array.isArray(data?.data) ? data.data : [], serverNow };
    },

    /**
     * @param {string} base - Base URL.
     * @param {string} deviceId - JewelBox device id.
     * @returns {Promise<{ queue: object|null, serverNow: number }>} Its queue
     * (null: no queue any more).
     */
    async queue(base, deviceId) {
      try {
        const { data, serverNow } = await request(
          base,
          `/api/player/queue/devices/${encodeURIComponent(deviceId)}`,
        );
        return { queue: data, serverNow };
      } catch (error) {
        if (error instanceof JewelBoxError && error.status === 404) {
          return { queue: null, serverNow: now() };
        }
        throw error;
      }
    },

    lend: async (base, id, borrower) =>
      (
        await request(base, `/api/albums/${Number(id)}/lend`, {
          method: 'PATCH',
          body: borrower ? { is_lent: true, lent_to: borrower } : { is_lent: false },
        })
      ).data,

    startScan: async (base) => (await request(base, '/api/player/scan', { method: 'POST' })).data,
    scanStatus: (base) => get(base, '/api/player/scan/status'),

    /**
     * @param {string} base - Base URL.
     * @param {string} file - A cover file name (`<md5>.<ext>`).
     * @returns {Promise<{ data: Buffer, type: string }>} The bytes.
     */
    cover: (base, file) => request(base, `/covers/${encodeURIComponent(file)}`, { raw: true }),
  };
}
