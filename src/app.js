// -----------------------------------------------------------------------------
// The JewelBox integration: every Gladys handler.
//
//   locate           the server: the address typed in the configuration, else
//                    the last one known (/data/server.json), else an mDNS
//                    scan (`_jewelbox._tcp`, through the core); always
//                    confirmed by `GET /api/server-info` (its server_id)
//   player rounds    every 10 s: the queues of the players (1 request, plus
//                    one per created player whose queue changed)
//   collection       every minute: active collection, statistics, latest
//   rounds           albums, wish list, loans (5 requests)
//   states           counters of the collection, state and track of the
//                    players (src/states.js)
//   scene events     transitions seen by the rounds only (src/scenes.js)
//   scene actions    now playing, random album, album of the day, lend,
//                    return, library scan
//   widgets          now playing, collection, loans, album of the day,
//                    recently added
//   status           no server found, server unreachable
//
// /data holds the address of the server and the loans already reminded.
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import { JewelBoxError, createClient, normalizeBaseUrl, parseSqlDate } from './client.js';
import { nextPlayback, observationOf } from './playback.js';
import { baseOf, changesOf, daysSince, loanKey, oldestLoanDays } from './collection.js';
import {
  DEVICE_TYPES,
  buildCollectionDevice,
  buildPlayerDevice,
  collectionIds,
  collectionValues,
  isPlayerId,
  parseExternalId,
  playerIds,
  playerNames,
  playerValues,
} from './devices.js';
import {
  ACTIONS,
  LISTS,
  TRIGGERS,
  addedEvent,
  albumData,
  albumText,
  cut,
  loanEvent,
  playerEvent,
  playerTransitions,
} from './scenes.js';
import {
  BUTTONS,
  LIST_SETTING,
  WIDGETS,
  buildAlbumOfTheDayWidget,
  buildCollectionWidget,
  buildLoansWidget,
  buildNowPlayingWidget,
  buildRecentlyAddedWidget,
  coverFile,
} from './widgets.js';
import { LANGUAGES, all, t } from './i18n.js';
import { displayTimeZone } from './time.js';

export const SERVER_FILE = 'server.json';
export const REMINDERS_FILE = 'reminders.json';
export const CONFIG_ACTIONS = { TEST_CONNECTION: 'test_connection' };

export const PLAYER_ROUND_MS = 10 * 1000;
export const COLLECTION_ROUND_MS = 60 * 1000;
const RETRY_MS = 60 * 1000;
const MDNS_GAP_MS = 5 * 60 * 1000;
const MDNS_TIMEOUT_S = 5;
const WIDGET_REFRESH_MS = 10 * 1000;
const HOME_TTL_MS = 10 * 60 * 1000;
const SCAN_WAIT_MS = 100 * 1000;
const SCAN_POLL_MS = 2 * 1000;
const RECENT_LIMIT = 20;
const LIST_LIMIT = 1000;
const MAX_IMAGE_BYTES = 300 * 1024;
const DAY_MS = 24 * 3600 * 1000;

class UserError extends Error {
  constructor(key, values = {}) {
    super(t(key, 'en', values));
    this.name = 'UserError';
    this.key = key;
    this.values = values;
  }
}

const sameText = (a, b) =>
  String(a ?? '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase() ===
  String(b ?? '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase();

/**
 * @description Create the integration.
 * @param {object} gladys - SDK client.
 * @param {object} [deps] - Dependencies (tests).
 * @returns {object} `{ start, stop, playerRound, collectionRound, ... }`.
 */
export function createApp(gladys, deps = {}) {
  const logger = deps.logger ?? { info() {}, warn() {}, error() {}, debug() {} };
  const storage = deps.storage ?? createStorage();
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  const timeZone = deps.timeZone ?? displayTimeZone();
  const client = deps.client ?? createClient({ fetch: deps.fetch, now });
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let config = normalizeConfig(gladys.config ?? {});

  let server = null; // { serverId, url, name, version, collection }
  let reachable = false;
  let lastError = '';
  let lastMdnsAt = 0;
  let locating = null;

  // Collection (memory).
  let stats = null;
  let database = null; // { id, name }
  let recent = null;
  let lent = null;
  let base = null;
  const reminded = new Set();

  // Players.
  let players = []; // the list of the server
  let serverNow = 0;
  const playback = new Map(); // device id -> nextPlayback()
  const observations = new Map(); // device id -> observationOf()

  const created = new Map(); // device external id -> { type, id, name }
  let discoveredKey = '';
  let pick = null; // { album, day } drawn by the widget button
  let home = null; // { album, at }

  const timers = { players: null, collection: null };
  const running = { players: null, collection: null };
  let stopped = false;
  let lastStatus = null;
  const widgetTimers = new Map();
  const widgetLast = new Map();
  const widgetSeen = new Map();

  const isCreatedDevice = (deviceId) => created.has(deviceId);
  const states = createStatePublisher(gladys, { logger, now, isCreated: isCreatedDevice });

  const safely = async (fn, what) => {
    try {
      return await fn();
    } catch (error) {
      logger.warn(`JewelBox: ${what} failed: ${error?.message ?? error}`);
      return undefined;
    }
  };

  const createdOf = (type) =>
    [...created.values()].filter((entry) => entry.type === type).map((entry) => entry.id);

  // --- Status and widgets ----------------------------------------------------------------------

  const publishStatus = () => {
    let message = null;
    if (!server) message = all('statusNoServer');
    else if (!reachable) message = all('statusUnreachable', { url: server.url, error: lastError });
    const key = JSON.stringify(message);
    if (key === lastStatus) return;
    lastStatus = key;
    safely(
      () =>
        message ? gladys.setConnectionStatus(false, message) : gladys.setConnectionStatus(true),
      'status',
    );
  };

  const refreshWidget = (key, force = false) => {
    const wait = (widgetLast.get(key) ?? 0) + WIDGET_REFRESH_MS - now();
    if (force || wait <= 0) {
      widgetLast.set(key, now());
      clearTimeout(widgetTimers.get(key));
      widgetTimers.delete(key);
      safely(() => gladys.requestWidgetRefresh(key), `refreshing the widget ${key}`);
      return;
    }
    if (!widgetTimers.has(key)) {
      const handle = setTimeout(() => {
        widgetTimers.delete(key);
        refreshWidget(key, true);
      }, wait);
      handle.unref?.();
      widgetTimers.set(key, handle);
    }
  };

  // A widget is refreshed when what it shows changed, not at every round.
  const refreshIfChanged = (key, value) => {
    const text = JSON.stringify(value);
    if (widgetSeen.get(key) === text) return;
    const first = !widgetSeen.has(key);
    widgetSeen.set(key, text);
    if (!first) refreshWidget(key);
  };

  const fire = (key, data) =>
    safely(() => gladys.publishSceneEvent(key, data), `scene event ${key}`);

  // --- Requests --------------------------------------------------------------------------------

  /**
   * @description A call to the server, which keeps the reachable state.
   * @param {Function} fn - `(url) => Promise`.
   * @returns {Promise<any>} Its result.
   */
  const call = async (fn) => {
    if (!server) throw new UserError('errorNoServer');
    try {
      const result = await fn(server.url);
      if (!reachable) {
        reachable = true;
        logger.info(`JewelBox: the server answers at ${server.url}`);
      }
      return result;
    } catch (error) {
      if (error instanceof JewelBoxError && error.kind === 'network') {
        if (reachable) logger.warn(`JewelBox: the server does not answer (${error.message})`);
        reachable = false;
        lastError = error.message;
      }
      throw error;
    } finally {
      publishStatus();
    }
  };

  const explain = (error, language) => {
    if (error instanceof UserError) return t(error.key, language, error.values);
    if (error instanceof JewelBoxError) {
      if (error.kind === 'network') return t('errorNoServer', language);
      return t('errorServer', language, { error: error.message });
    }
    return String(error?.message ?? error).slice(0, 200);
  };
  const userFacing = (error) => new Error(explain(error, config.language));

  // --- Locating the server ---------------------------------------------------------------------

  const saveServer = () =>
    safely(
      () =>
        storage.write(SERVER_FILE, server ? { server_id: server.serverId, url: server.url } : null),
      'saving /data',
    );

  const confirm = async (url, expectedId = null) => {
    const info = await client.serverInfo(url);
    if (expectedId && info.serverId !== expectedId) return null;
    return { ...info, url };
  };

  const fromMdns = async (preferredId) => {
    if (now() - lastMdnsAt < MDNS_GAP_MS && lastMdnsAt) return null;
    lastMdnsAt = now();
    const services =
      (await safely(
        () => gladys.scanNetwork('mdns', { timeoutSeconds: MDNS_TIMEOUT_S }),
        'mDNS scan',
      )) ?? [];
    const candidates = [];
    for (const service of Array.isArray(services) ? services : []) {
      const txt = parseMdnsTxt(Array.isArray(service?.txt) ? service.txt : []);
      if (txt.app && txt.app !== 'jewelbox') continue;
      const port = Number(service.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      const addresses = (Array.isArray(service.addresses) ? service.addresses : [])
        .filter((address) => typeof address === 'string')
        .sort((a, b) => Number(a.includes(':')) - Number(b.includes(':')));
      for (const address of addresses) {
        const host = address.includes(':') ? `[${address}]` : address;
        const url = normalizeBaseUrl(`http://${host}:${port}`);
        if (url) candidates.push({ url, id: typeof txt.id === 'string' ? txt.id : null });
      }
    }
    // The known server first, then the others.
    candidates.sort((a, b) => Number(b.id === preferredId) - Number(a.id === preferredId));
    for (const candidate of candidates) {
      const found = await safely(() => confirm(candidate.url), `checking ${candidate.url}`);
      if (found) return found;
    }
    return null;
  };

  /**
   * @description Find the server.
   * @param {object} [options] - `{ force }`: scan mDNS even if done recently.
   * @returns {Promise<object|null>} The server.
   */
  const locate = async ({ force = false } = {}) => {
    if (locating) return locating;
    locating = (async () => {
      if (force) lastMdnsAt = 0;
      const before = server;
      let found = null;
      if (config.serverUrl) {
        try {
          found = await confirm(config.serverUrl);
        } catch (error) {
          lastError = error.message;
          // The address typed by the user is the only one used.
          server = {
            serverId: before?.serverId ?? '',
            url: config.serverUrl,
            name: 'JewelBox',
            version: '',
            collection: '',
          };
          reachable = false;
          return server;
        }
      } else {
        const saved = before ?? (await safely(() => storage.read(SERVER_FILE), 'reading /data'));
        const savedUrl = saved?.url ?? null;
        const savedId = saved?.serverId ?? saved?.server_id ?? null;
        if (savedUrl) {
          found = await safely(() => confirm(savedUrl, savedId), `checking ${savedUrl}`);
        }
        if (!found) found = await fromMdns(savedId);
      }
      if (found) {
        const moved = !before || before.url !== found.url || before.serverId !== found.serverId;
        server = found;
        reachable = true;
        lastError = '';
        if (moved) {
          logger.info(`JewelBox: server ${found.name} ${found.version} at ${found.url}`);
          await saveServer();
        }
      } else if (before) {
        reachable = false;
      }
      return server;
    })();
    try {
      return await locating;
    } finally {
      locating = null;
      publishStatus();
    }
  };

  // --- Discovered devices ----------------------------------------------------------------------

  const recentPlayers = () => {
    const limit = config.playersMaxAgeDays * DAY_MS;
    const reference = serverNow || now();
    return players.filter((player) => {
      if (!isPlayerId(player.device_id)) return false;
      const at = parseSqlDate(player.updated_at);
      return (
        created.has(playerIds(gladys, player.device_id).device) ||
        (Number.isFinite(at) && reference - at <= limit)
      );
    });
  };

  const namesOfPlayers = () =>
    playerNames(players.filter((player) => isPlayerId(player.device_id)));

  const publishDiscovered = async (force = false) => {
    if (!server) return;
    const names = namesOfPlayers();
    const devices = [buildCollectionDevice(gladys, server, config.language)];
    for (const player of recentPlayers()) {
      devices.push(
        buildPlayerDevice(gladys, player.device_id, names.get(player.device_id), config.language),
      );
    }
    const key = JSON.stringify(
      devices.map((device) => [device.external_id, device.name, config.language]),
    );
    if (!force && key === discoveredKey) return;
    discoveredKey = key;
    await safely(() => gladys.publishDiscoveredDevices(devices), 'publishing the devices');
  };

  // --- States ----------------------------------------------------------------------------------

  const pushCollection = () => {
    if (!server?.serverId) return;
    const ids = collectionIds(gladys, server.serverId);
    const oldest = lent ? oldestLoanDays(lent, now()) : null;
    for (const [key, value] of collectionValues(stats, oldest))
      states.push(ids.feature(key), value);
  };

  const pushPlayer = (id) => {
    const ids = playerIds(gladys, id);
    for (const [key, value] of playerValues(playback.get(id) ?? null))
      states.push(ids.feature(key), value);
  };

  // --- Player rounds ---------------------------------------------------------------------------

  const nameOfPlayer = (id) =>
    created.get(playerIds(gladys, id).device)?.name ||
    namesOfPlayers().get(id) ||
    `JewelBox ${id.slice(0, 8)}`;

  /**
   * @description Read the queues of the players.
   * @param {object} [options] - `{ announce }`: fire the scene events (a
   * scheduled round), false for a scene action.
   * @returns {Promise<void>}
   */
  const readPlayers = async ({ announce = true } = {}) => {
    const answer = await call((url) => client.players(url));
    players = answer.devices;
    serverNow = answer.serverNow;
    const byId = new Map(players.map((player) => [player.device_id, player]));
    for (const id of createdOf(DEVICE_TYPES.PLAYER)) {
      const entry = byId.get(id);
      const previous = playback.get(id) ?? null;
      let observation = null;
      let at = serverNow;
      if (entry) {
        const known = observations.get(id);
        const unchanged =
          known &&
          known.updatedAt === parseSqlDate(entry.updated_at) &&
          known.index === entry.current_index;
        if (unchanged) {
          observation = known;
        } else {
          const { queue, serverNow: answerNow } = await call((url) => client.queue(url, id));
          observation = observationOf(queue, parseSqlDate);
          at = answerNow;
        }
      }
      if (observation) observations.set(id, observation);
      else observations.delete(id);
      const next = nextPlayback(previous, observation, at);
      playback.set(id, next);
      if (announce) {
        const device = playerIds(gladys, id).device;
        for (const key of playerTransitions(previous, next)) {
          fire(
            key,
            playerEvent(
              device,
              nameOfPlayer(id),
              key === TRIGGERS.PLAYBACK_STOPPED ? previous.track : next.track,
            ),
          );
        }
      }
      pushPlayer(id);
    }
    refreshIfChanged(
      WIDGETS.NOW_PLAYING,
      [...playback].map(([id, value]) => [id, value.playing, value.trackId, value.source]),
    );
    await publishDiscovered();
  };

  const scheduleRound = (which, delay) => {
    clearTimeout(timers[which]);
    timers[which] = null;
    if (stopped) return;
    timers[which] = setTimeout(
      () => {
        timers[which] = null;
        (which === 'players' ? playerRound : collectionRound)();
      },
      Math.max(0, delay),
    );
    timers[which].unref?.();
  };

  const playerRound = async () => {
    if (running.players) return running.players;
    running.players = (async () => {
      if (stopped) return;
      if (!server || !reachable) {
        scheduleRound('players', PLAYER_ROUND_MS);
        return;
      }
      await safely(() => readPlayers(), 'reading the players');
      scheduleRound('players', PLAYER_ROUND_MS);
    })();
    try {
      await running.players;
    } finally {
      running.players = null;
    }
  };

  // --- Collection rounds -----------------------------------------------------------------------

  const saveReminders = () =>
    safely(() => storage.write(REMINDERS_FILE, { loans: [...reminded] }), 'saving /data');

  const readCollection = async () => {
    const db = await call((url) => client.activeDatabase(url));
    const [statistics, latest, wished, lentOut] = await Promise.all([
      call((url) => client.stats(url)),
      call((url) => client.albums(url, { sort: 'created_at', order: 'desc', limit: RECENT_LIMIT })),
      call((url) =>
        client.albums(url, { wanted: true, sort: 'created_at', order: 'desc', limit: LIST_LIMIT }),
      ),
      call((url) => client.albums(url, { lent: true, limit: LIST_LIMIT })),
    ]);
    const reading = {
      dbId: db?.id ?? 0,
      recent: latest.data,
      wanted: wished.data,
      lent: lentOut.data,
    };
    const changes = changesOf(base, reading, {
      nowMs: now(),
      reminderDays: config.loanReminderDays,
      reminded,
    });
    if (base && base.dbId !== reading.dbId) {
      logger.info(`JewelBox: the active collection is now "${db?.name ?? ''}"`);
      pick = null;
      home = null;
    }
    if (changes.bulk > 0)
      logger.info(`JewelBox: ${changes.bulk} albums added at once (an import): no event`);
    base = baseOf(reading, base);

    for (const album of changes.added) {
      fire(
        TRIGGERS.ALBUM_ADDED,
        addedEvent(album, album.is_wanted ? LISTS.WANTED : LISTS.OWNED, false),
      );
    }
    for (const id of changes.left) {
      const album = await safely(
        () => call((url) => client.album(url, id)),
        `reading the album ${id}`,
      );
      if (album && !album.is_wanted)
        fire(TRIGGERS.ALBUM_ADDED, addedEvent(album, LISTS.OWNED, true));
    }
    for (const album of changes.lent) {
      fire(TRIGGERS.ALBUM_LENT, loanEvent(album, daysSince(album.lent_at, now())));
    }
    for (const was of changes.returned) {
      const album = await safely(
        () => call((url) => client.album(url, was.id)),
        `reading the album ${was.id}`,
      );
      if (album && !album.is_lent) {
        fire(
          TRIGGERS.ALBUM_RETURNED,
          loanEvent({ ...album, lent_to: was.lent_to }, daysSince(was.lent_at, now())),
        );
      }
    }
    if (changes.overdue.length > 0) {
      for (const { album, days, key } of changes.overdue) {
        fire(TRIGGERS.LOAN_OVERDUE, loanEvent(album, days));
        reminded.add(key);
      }
    }
    // Forget the reminders of the loans that ended.
    const running = new Set(reading.lent.map((album) => loanKey(reading.dbId, album)));
    let pruned = false;
    for (const key of reminded) {
      if (key.startsWith(`${reading.dbId}:`) && !running.has(key)) {
        reminded.delete(key);
        pruned = true;
      }
    }
    if (changes.overdue.length > 0 || pruned) await saveReminders();

    database = db;
    stats = statistics;
    recent = latest.data;
    lent = lentOut.data;
    pushCollection();
    refreshIfChanged(WIDGETS.COLLECTION, [db?.name, stats]);
    refreshIfChanged(
      WIDGETS.LOANS,
      lent.map((album) => [album.id, album.lent_to, album.lent_at]),
    );
    refreshIfChanged(
      WIDGETS.RECENTLY_ADDED,
      recent.map((album) => [album.id, album.title, album.is_wanted, album.cover_url]),
    );
  };

  const collectionRound = async () => {
    if (running.collection) return running.collection;
    running.collection = (async () => {
      if (stopped) return;
      if (!server || !reachable) {
        await safely(() => locate(), 'locating the server');
        if (server && reachable) {
          await publishDiscovered();
          playerRound();
        }
      }
      if (server && reachable) {
        await safely(() => readCollection(), 'reading the collection');
      }
      scheduleRound('collection', server && reachable ? COLLECTION_ROUND_MS : RETRY_MS);
    })();
    try {
      await running.collection;
    } finally {
      running.collection = null;
    }
  };

  // --- Devices ---------------------------------------------------------------------------------

  const track = (device) => {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed) return null;
    const name =
      typeof device.name === 'string' && device.name.trim() ? device.name.trim() : parsed.id;
    created.set(device.external_id, { ...parsed, name });
    return parsed;
  };

  const pushDevice = (parsed) => {
    if (parsed.type === DEVICE_TYPES.PLAYER) pushPlayer(parsed.id);
    else if (parsed.id === server?.serverId) pushCollection();
  };

  gladys.onDeviceCreated(async (device) => {
    const parsed = track(device);
    if (!parsed) return;
    // States published before the creation were thrown away by Gladys.
    states.republish(device.external_id);
    pushDevice(parsed);
    Object.values(WIDGETS).forEach((key) => refreshWidget(key, true));
    if (parsed.type === DEVICE_TYPES.PLAYER) playerRound();
  });

  gladys.onDeviceUpdated(async (device) => {
    const parsed = track(device);
    if (!parsed) return;
    states.republish(device.external_id);
    pushDevice(parsed);
  });

  gladys.onDeviceDeleted(async (device) => {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (!parsed) return;
    created.delete(device.external_id);
    if (parsed.type === DEVICE_TYPES.PLAYER) {
      playback.delete(parsed.id);
      observations.delete(parsed.id);
    }
    states.forget(device.external_id);
    Object.values(WIDGETS).forEach((key) => refreshWidget(key, true));
  });

  gladys.onSetValue(async (device, feature) => {
    // Every feature is read-only: JewelBox cannot be commanded.
    throw new Error(`${feature?.external_id ?? 'this feature'} is read-only`);
  });

  gladys.onScanRequest(async () => {
    await locate({ force: !config.serverUrl });
    if (server && reachable)
      await safely(() => readPlayers({ announce: false }), 'reading the players');
    await publishDiscovered(true);
  });

  gladys.onConfigUpdated(async (raw) => {
    const before = config;
    config = normalizeConfig(raw ?? {});
    if (before.serverUrl !== config.serverUrl) {
      server = null;
      reachable = false;
      base = null;
      lastStatus = null;
      await locate({ force: true });
      if (server && reachable) {
        await publishDiscovered(true);
        playerRound();
        collectionRound();
      }
    } else if (
      before.language !== config.language ||
      before.playersMaxAgeDays !== config.playersMaxAgeDays
    ) {
      await publishDiscovered(true);
    }
    publishStatus();
    Object.values(WIDGETS).forEach((key) => refreshWidget(key, true));
  });

  // --- Configuration button --------------------------------------------------------------------

  gladys.onAction(CONFIG_ACTIONS.TEST_CONNECTION, async () => {
    await locate({ force: !config.serverUrl });
    if (!server || !reachable) {
      return all((language) =>
        server
          ? t('statusUnreachable', language, { url: server.url, error: lastError })
          : t('statusNoServer', language),
      );
    }
    try {
      await readCollection();
      await readPlayers({ announce: false });
      return all('testOk', {
        name: server.name,
        version: server.version,
        url: server.url,
        collection: database?.name || server.collection || '–',
        owned: stats?.total_owned ?? 0,
        players: players.length,
      });
    } catch (error) {
      return all((language) => explain(error, language).slice(0, 1000));
    }
  });

  // --- Albums ----------------------------------------------------------------------------------

  /**
   * @description An album from what a scene gives: an id, or an exact title.
   * @param {unknown} value - The field.
   * @returns {Promise<object>} The album.
   */
  const resolveAlbum = async (value) => {
    const text = String(value ?? '').trim();
    if (!text) throw new UserError('errorAlbumNotFound', { album: '' });
    if (/^\d{1,9}$/.test(text)) {
      try {
        return await call((url) => client.album(url, Number(text)));
      } catch (error) {
        if (error instanceof JewelBoxError && error.status === 404) {
          throw new UserError('errorAlbumNotFound', { album: text });
        }
        throw error;
      }
    }
    const { data } = await call((url) =>
      client.albums(url, { search: text.slice(0, 200), limit: 50 }),
    );
    let matches = data.filter((album) => sameText(album.title, text));
    if (matches.length > 1) {
      const owned = matches.filter((album) => !album.is_wanted);
      if (owned.length > 0) matches = owned;
    }
    if (matches.length === 0)
      throw new UserError('errorAlbumNotFound', { album: text.slice(0, 200) });
    if (matches.length > 1) {
      throw new UserError('errorAlbumAmbiguous', {
        album: text.slice(0, 200),
        count: matches.length,
      });
    }
    return matches[0];
  };

  /**
   * @description An album drawn from the collection.
   * @param {string} [genre] - Only this genre (case-insensitive).
   * @returns {Promise<object>} The album.
   */
  const randomAlbum = async (genre = '') => {
    let exact = '';
    if (genre) {
      const genres = await call((url) => client.request(url, '/api/albums/genres'));
      const list = Array.isArray(genres.data) ? genres.data : [];
      exact = list
        .map((entry) => (typeof entry === 'string' ? entry : entry?.genre))
        .find((name) => sameText(name, genre));
      if (!exact) throw new UserError('errorNoAlbumOfGenre', { genre: genre.slice(0, 100) });
    }
    const first = await call((url) =>
      client.albums(url, { wanted: false, genre: exact, limit: 1 }),
    );
    if (first.total === 0) {
      throw exact
        ? new UserError('errorNoAlbumOfGenre', { genre: exact })
        : new UserError('errorNoAlbum');
    }
    const page = 1 + Math.floor(random() * first.total);
    const { data } = await call((url) =>
      client.albums(url, { wanted: false, genre: exact, limit: 1, page }),
    );
    return data[0] ?? first.data[0];
  };

  const albumOfTheDay = async () => {
    if (home && now() - home.at < HOME_TTL_MS) return home.album;
    const feed = await call((url) => client.home(url));
    const album = Array.isArray(feed?.suggestions) ? (feed.suggestions[0] ?? null) : null;
    home = { album, at: now() };
    return album;
  };

  const albumOutputs = (album) => {
    const data = albumData(album);
    // Outputs are typed numbers: an unknown year or id reads 0.
    return {
      ...data,
      album_id: data.album_id ?? 0,
      year: data.year ?? 0,
      summary: cut(albumText(album), 10000),
    };
  };

  // --- Scene actions ---------------------------------------------------------------------------

  const playerOf = (value) => {
    const parsed = parseExternalId(gladys, value);
    if (parsed?.type === DEVICE_TYPES.PLAYER && created.has(playerIds(gladys, parsed.id).device)) {
      return parsed.id;
    }
    const ids = createdOf(DEVICE_TYPES.PLAYER);
    if (ids.length === 0) throw new UserError('errorNoPlayer');
    // No player given: the one playing, else the last one used.
    const updated = (id) => playback.get(id)?.updatedAt || 0;
    return [...ids].sort(
      (a, b) =>
        Number(playback.get(b)?.playing ?? false) - Number(playback.get(a)?.playing ?? false) ||
        updated(b) - updated(a),
    )[0];
  };

  const action = (key, fn) =>
    gladys.onSceneAction(key, async (fields = {}) => {
      try {
        return await fn(fields ?? {});
      } catch (error) {
        throw userFacing(error);
      }
    });

  action(ACTIONS.GET_NOW_PLAYING, async (fields) => {
    const id = playerOf(fields.player);
    await readPlayers({ announce: false });
    const state = playback.get(id);
    return {
      player_name: cut(nameOfPlayer(id)),
      playing: Boolean(state?.playing),
      title: cut(state?.track?.title ?? ''),
      artist: cut(state?.track?.artist ?? ''),
      album: cut(state?.track?.album ?? ''),
    };
  });

  action(ACTIONS.RANDOM_ALBUM, async (fields) =>
    albumOutputs(await randomAlbum(typeof fields.genre === 'string' ? fields.genre.trim() : '')),
  );

  action(ACTIONS.ALBUM_OF_THE_DAY, async () => {
    const album = await albumOfTheDay();
    if (!album) throw new UserError('errorNoAlbum');
    return albumOutputs(album);
  });

  action(ACTIONS.LEND_ALBUM, async (fields) => {
    const borrower =
      typeof fields.borrower === 'string' ? fields.borrower.trim().slice(0, 100) : '';
    if (!borrower) throw new UserError('errorNoBorrower');
    const album = await resolveAlbum(fields.album);
    if (album.is_wanted) throw new UserError('errorAlbumWanted', { album: album.title });
    if (album.is_lent) {
      throw new UserError('errorAlreadyLent', {
        album: album.title,
        who: album.lent_to || t('widgetSomeone', config.language),
      });
    }
    const updated = (await call((url) => client.lend(url, album.id, borrower))) ?? album;
    // Known before the next round: no album_lent event for a scene's own action.
    base?.lent.set(album.id, { ...album, ...updated, lent_to: borrower });
    collectionSoon();
    return { ...albumOutputs(album), borrower: cut(borrower) };
  });

  action(ACTIONS.RETURN_ALBUM, async (fields) => {
    const album = await resolveAlbum(fields.album);
    if (!album.is_lent) throw new UserError('errorNotLent', { album: album.title });
    const days = daysSince(album.lent_at, now());
    await call((url) => client.lend(url, album.id, null));
    base?.lent.delete(album.id);
    collectionSoon();
    return { ...albumOutputs(album), borrower: cut(album.lent_to ?? ''), days: days ?? 0 };
  });

  action(ACTIONS.SCAN_LIBRARY, async () => {
    try {
      await call((url) => client.startScan(url));
    } catch (error) {
      if (error instanceof JewelBoxError && error.status === 409)
        throw new UserError('errorScanRunning');
      if (error instanceof JewelBoxError && error.status === 400)
        throw new UserError('errorScanNoLibrary');
      throw error;
    }
    const until = now() + SCAN_WAIT_MS;
    let status;
    do {
      await sleep(SCAN_POLL_MS);
      status = await call((url) => client.scanStatus(url));
    } while (status?.running && now() < until);
    const result = status?.result ?? {};
    return {
      finished: !status?.running,
      matched_albums: Number(result.matched_albums) || 0,
      matched_tracks: Number(result.matched_tracks) || 0,
      unmatched_files: Number(result.unmatched_count) || 0,
    };
  });

  // A change made by an action: the widgets and counters follow soon.
  const collectionSoon = () => scheduleRound('collection', 2000);

  // --- Widgets ---------------------------------------------------------------------------------

  const languageOf = (language) => (LANGUAGES.includes(language) ? language : config.language);
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(now()));

  gladys.onWidgetGet(WIDGETS.NOW_PLAYING, async ({ settings = {}, language } = {}) => {
    let id;
    try {
      id = playerOf(settings.player);
    } catch {
      id = null;
    }
    return buildNowPlayingWidget({
      player: id ? { id, name: nameOfPlayer(id) } : null,
      playback: id ? (playback.get(id) ?? null) : null,
      serverNow: serverNow || now(),
      language: languageOf(language),
    });
  });

  gladys.onWidgetGet(WIDGETS.COLLECTION, async ({ language } = {}) =>
    buildCollectionWidget({
      stats: reachable ? stats : null,
      collection: database?.name || server?.collection || '',
      language: languageOf(language),
    }),
  );

  gladys.onWidgetGet(WIDGETS.LOANS, async ({ language } = {}) =>
    buildLoansWidget({
      lent: reachable ? lent : null,
      reminderDays: config.loanReminderDays,
      nowMs: now(),
      language: languageOf(language),
      timeZone,
    }),
  );

  gladys.onWidgetGet(WIDGETS.ALBUM_OF_THE_DAY, async ({ language } = {}) => {
    const lang = languageOf(language);
    if (pick && pick.day !== today()) pick = null;
    let album = pick?.album ?? null;
    if (!album && server && reachable)
      album = (await safely(() => albumOfTheDay(), 'the album of the day')) ?? null;
    return buildAlbumOfTheDayWidget({
      album,
      drawn: Boolean(pick),
      reachable: Boolean(server && reachable),
      language: lang,
    });
  });

  gladys.onWidgetAction(WIDGETS.ALBUM_OF_THE_DAY, async (actionKey) => {
    try {
      if (actionKey === BUTTONS.TODAY) {
        pick = null;
        refreshWidget(WIDGETS.ALBUM_OF_THE_DAY, true);
        return all('toastToday');
      }
      const album = await randomAlbum();
      pick = { album, day: today() };
      refreshWidget(WIDGETS.ALBUM_OF_THE_DAY, true);
      return all('toastAnother', { album: cut(albumText(album), 180) });
    } catch (error) {
      return all((language) => explain(error, language).slice(0, 200));
    }
  });

  gladys.onWidgetGet(WIDGETS.RECENTLY_ADDED, async ({ settings = {}, language } = {}) =>
    buildRecentlyAddedWidget({
      albums: reachable ? recent : null,
      list: Object.values(LIST_SETTING).includes(settings.list) ? settings.list : LIST_SETTING.ALL,
      language: languageOf(language),
    }),
  );

  gladys.onWidgetGetImage(async (imageKey) => {
    const file = coverFile(imageKey);
    if (!file) throw new Error(`Unknown image key: ${imageKey}`);
    const { data, type } = await call((url) => client.cover(url, file));
    if (!/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`Not an image: ${type}`);
    if (data.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `The cover ${file} is too large for a widget (${Math.round(data.length / 1024)} KB)`,
      );
    }
    return data.toString('base64');
  });

  // --- Lifecycle -------------------------------------------------------------------------------

  const start = async () => {
    // gladys.config is filled by connect(), after createApp.
    config = normalizeConfig(gladys.config ?? {});
    const saved = await safely(() => storage.read(REMINDERS_FILE), 'reading /data');
    for (const key of Array.isArray(saved?.loans) ? saved.loans : []) {
      if (typeof key === 'string') reminded.add(key);
    }
    const devices = (await safely(() => gladys.getDevices(), 'reading the devices')) ?? [];
    for (const device of Array.isArray(devices) ? devices : []) track(device);
    await locate();
    if (server && reachable) await publishDiscovered();
    await Promise.all([playerRound(), collectionRound()]);
  };

  const stop = async () => {
    stopped = true;
    for (const key of Object.keys(timers)) {
      clearTimeout(timers[key]);
      timers[key] = null;
    }
    for (const handle of widgetTimers.values()) clearTimeout(handle);
    widgetTimers.clear();
    states.stop();
    await Promise.all(Object.values(running).map((promise) => promise?.catch(() => {})));
  };

  return {
    start,
    stop,
    playerRound,
    collectionRound,
    locate,
    states,
    created,
    playback,
    reminded,
    get server() {
      return server;
    },
    get reachable() {
      return reachable;
    },
    get base() {
      return base;
    },
  };
}
