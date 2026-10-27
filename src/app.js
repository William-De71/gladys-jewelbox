// -----------------------------------------------------------------------------
// The JewelBox integration: every Gladys handler.
//
//   locate           the server: the address typed in the configuration, else
//                    the last one known (/data/server.json), else an mDNS
//                    scan (`_jewelbox._tcp`, through the core); always
//                    confirmed by `GET /api/server-info` (its server_id)
//   player rounds    every 10 s: the queues of the players (1 request, plus
//                    one per created player whose queue changed) and their
//                    live state (JewelBox 1.18+, 1 request), and at once
//                    when the watch stream says a player changed
//   remote control   writes on the player features → commands, the catalog
//                    of JewelBox for the music players of Gladys (browse,
//                    search, queue, play), src/remote.js
//   collection       every minute: active collection, statistics, latest
//   rounds           albums, wish list, loans (5 requests)
//   states           counters of the collection, track of the players
//                    (src/states.js); the now playing of the players
//                    (`music` features) through publishNowPlaying of the
//                    SDK, on changes only
//   scene events     transitions seen by the rounds only (src/scenes.js)
//   scene actions    now playing, random album, album of the day, lend,
//                    return, library scan
//   widgets          now playing, collection, loans, album of the day,
//                    recently added
//   images           covers by key, for the widgets and the player artwork
//   status           no server found, server unreachable
//
// /data holds the address of the server, the loans already reminded and the
// remote control capabilities of the players (players.json).
// -----------------------------------------------------------------------------

import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { createStatePublisher } from './states.js';
import { createStorage } from './storage.js';
import { JewelBoxError, createClient, normalizeBaseUrl, parseSqlDate } from './client.js';
import { nextPlayback, observationOf } from './playback.js';
import {
  ROOT_FOLDERS,
  albumItem,
  albumRadioItem,
  artistItem,
  capabilitiesOf,
  commandOf,
  folderItem,
  parseMediaId,
  playMediaOf,
  playbackFromLive,
  playlistItem,
  smartItem,
  trackItem,
} from './remote.js';
import { baseOf, changesOf, daysSince, loanKey, oldestLoanDays } from './collection.js';
import {
  DEVICE_TYPES,
  buildCollectionDevice,
  buildPlayerDevice,
  collectionIds,
  collectionValues,
  isPlayerId,
  nowPlayingFeatureIds,
  nowPlayingOf,
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
  sleepTimerCommand,
} from './scenes.js';
import { WAKE_UP_MUSIC, rampGoesOn, wakeUpPlan } from './wakeup.js';
import {
  BUTTONS,
  LIST_SETTING,
  PERIOD_SETTING,
  VIEW_SETTING,
  WIDGETS,
  buildAlbumOfTheDayWidget,
  buildCollectionWidget,
  buildLoansWidget,
  buildNowPlayingWidget,
  buildListeningWidget,
  buildRecentlyAddedWidget,
  coverFile,
  coverKey,
} from './widgets.js';
import { LANGUAGES, all, t } from './i18n.js';
import { displayTimeZone } from './time.js';

export const SERVER_FILE = 'server.json';
export const REMINDERS_FILE = 'reminders.json';
export const PLAYERS_FILE = 'players.json';
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
// A change seen on the watch stream: one round shortly after, for a burst.
const WATCH_ROUND_DELAY_MS = 300;
const WATCH_RETRY_MIN_MS = 5 * 1000;
const WATCH_RETRY_MAX_MS = 60 * 1000;
const MAX_ITEMS = 100;
const REMOTE_RECHECK_MS = 10 * 60 * 1000;
// The listening statistics of another period than the month (widget setting).
const LISTENING_TTL_MS = 60 * 1000;

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
  // GET /api/player/stats of the month: null for JewelBox < 1.20.
  let listening = null;
  const listeningOther = new Map(); // period -> { data, at }
  let base = null;
  const reminded = new Set();

  // Players.
  let players = []; // the list of the server
  let serverNow = 0;
  let serverOffset = 0; // server clock - container clock (ms)
  const playback = new Map(); // device id -> nextPlayback() / playbackFromLive()
  const observations = new Map(); // device id -> observationOf()
  // Remote control (JewelBox 1.18+).
  const capabilities = new Map(); // device id -> capabilities ever announced (/data)
  const liveEntries = new Map(); // device id -> the last row of /api/player/remote/devices
  let remoteSupported = null; // null: unknown yet, false: an older server
  let remoteCheckedAt = 0;
  let watcher = null; // { abort: AbortController, url }
  let watchRound = null;

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
          remoteSupported = null;
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
        buildPlayerDevice(
          gladys,
          player.device_id,
          names.get(player.device_id),
          config.language,
          capabilities.get(player.device_id) ?? null,
        ),
      );
    }
    const key = JSON.stringify(
      devices.map((device) => [
        device.external_id,
        device.name,
        config.language,
        device.features.length,
      ]),
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
    // A collection created before a feature was added keeps its features
    // until the user updates it: publish only the ones it has.
    const known = created.get(ids.device)?.features;
    for (const [key, value] of collectionValues(stats, oldest, listening)) {
      const featureId = ids.feature(key);
      if (known?.size && !known.has(featureId)) continue;
      states.push(featureId, value);
    }
  };

  const pushPlayer = async (id) => {
    const ids = playerIds(gladys, id);
    const current = playback.get(id) ?? null;
    for (const [key, value] of playerValues(current)) states.push(ids.feature(key), value);
    // The playback state and the `music` features: one batch of what
    // changed, the position only on a change or a drift (never a stream).
    const snapshot = nowPlayingOf(current, now() + serverOffset);
    const device = created.get(ids.device);
    if (!snapshot || !device) return;
    // Only the types the device has (volume, mute… depend on the player).
    const featureExternalIds = nowPlayingFeatureIds(gladys, id);
    const known = device.features?.size ? device.features : null;
    for (const [type, featureId] of Object.entries(featureExternalIds)) {
      if (known && !known.has(featureId)) {
        delete featureExternalIds[type];
        delete snapshot[type];
      }
    }
    await safely(
      () => gladys.publishNowPlaying(ids.device, snapshot, { featureExternalIds }),
      'publishing the now playing',
    );
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
    serverOffset = serverNow - now();
    await readRemote();
    const byId = new Map(players.map((player) => [player.device_id, player]));
    for (const id of createdOf(DEVICE_TYPES.PLAYER)) {
      const entry = byId.get(id);
      const previous = playback.get(id) ?? null;
      // The player said what it does (JewelBox 1.18+): no inference.
      const live = playbackFromLive(liveEntries.get(id), entry?.source_label ?? '');
      let observation = null;
      let at = serverNow;
      if (live) {
        observations.delete(id);
      } else if (entry) {
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
      else if (!live) observations.delete(id);
      const next = live ?? nextPlayback(previous, observation, at);
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
      await pushPlayer(id);
    }
    refreshIfChanged(
      WIDGETS.NOW_PLAYING,
      [...playback].map(([id, value]) => [id, value.playing, value.trackId, value.source]),
    );
    await publishDiscovered();
  };

  /**
   * @description Read the live state of the players and remember the
   * capabilities of the ones that accept remote control. The players seen
   * only here (no queue yet) join the list of the server.
   * @returns {Promise<void>}
   */
  const readRemote = async () => {
    // An older server is asked again from time to time: it may be updated.
    if (remoteSupported === false && now() - remoteCheckedAt < REMOTE_RECHECK_MS) return;
    remoteCheckedAt = now();
    const answer = await call((url) => client.remoteDevices(url));
    if (answer.devices === null) {
      remoteSupported = false;
      liveEntries.clear();
      return;
    }
    remoteSupported = true;
    liveEntries.clear();
    let changed = false;
    for (const entry of answer.devices) {
      if (!isPlayerId(entry?.device_id)) continue;
      liveEntries.set(entry.device_id, entry);
      if (entry.controllable) {
        const announced = capabilitiesOf(entry.capabilities);
        const known = capabilities.get(entry.device_id);
        if (!known || known.join(',') !== announced.join(',')) {
          capabilities.set(entry.device_id, announced);
          changed = true;
        }
      }
      if (!players.some((player) => player.device_id === entry.device_id)) {
        players.push({
          device_id: entry.device_id,
          device_label: entry.device_label,
          updated_at: entry.state?.reported_at ?? new Date(serverNow).toISOString(),
          current_index: entry.state?.current_index ?? -1,
        });
      }
    }
    if (changed) {
      await safely(
        () => storage.write(PLAYERS_FILE, { capabilities: Object.fromEntries(capabilities) }),
        'saving /data',
      );
    }
    ensureWatch();
  };

  // --- Watch stream ----------------------------------------------------------------------------
  //
  // The changes of the players as they happen (a command confirmed, a pause
  // on the phone): a round right after, so the dashboard follows within a
  // second instead of at the next 10 s round. Reopened with a growing delay;
  // dropped on an older server, at a server change and at stop.

  const stopWatch = () => {
    watcher?.abort.abort();
    watcher = null;
  };

  const ensureWatch = () => {
    if (stopped || !server || remoteSupported !== true) return;
    if (watcher?.url === server.url) return;
    stopWatch();
    const abort = new AbortController();
    const url = server.url;
    watcher = { abort, url };
    (async () => {
      let delay = WATCH_RETRY_MIN_MS;
      while (!abort.signal.aborted) {
        let opened = false;
        try {
          await client.watch(url, {
            signal: abort.signal,
            onEvent: (event) => {
              opened = true;
              if (event === 'device' || event === 'gone') {
                clearTimeout(watchRound);
                watchRound = setTimeout(() => playerRound(), WATCH_ROUND_DELAY_MS);
                watchRound.unref?.();
              }
            },
          });
        } catch (error) {
          if (error instanceof JewelBoxError && error.status === 404) {
            remoteSupported = false;
            break;
          }
        }
        if (abort.signal.aborted) break;
        delay = opened ? WATCH_RETRY_MIN_MS : Math.min(WATCH_RETRY_MAX_MS, delay * 2);
        await sleep(delay);
      }
      if (watcher?.abort === abort) watcher = null;
    })();
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
    const [statistics, latest, wished, lentOut, plays] = await Promise.all([
      call((url) => client.stats(url)),
      call((url) => client.albums(url, { sort: 'created_at', order: 'desc', limit: RECENT_LIMIT })),
      call((url) =>
        client.albums(url, { wanted: true, sort: 'created_at', order: 'desc', limit: LIST_LIMIT }),
      ),
      call((url) => client.albums(url, { lent: true, limit: LIST_LIMIT })),
      // Best effort: the statistics must not hold up the collection.
      safely(
        () => call((url) => client.listeningStats(url, PERIOD_SETTING.MONTH)),
        'reading the listening statistics',
      ),
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
    // A failed reading keeps the last one (null stays "server too old").
    if (plays !== undefined) listening = plays;
    listeningOther.clear();
    pushCollection();
    refreshIfChanged(WIDGETS.COLLECTION, [
      db?.name,
      stats,
      listening?.counters,
      listening?.top?.albums,
    ]);
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
    // The features it really has: a player created before it accepted remote
    // control keeps its read-only features until the user updates it.
    const features = new Set(
      (Array.isArray(device.features) ? device.features : [])
        .map((feature) => feature?.external_id)
        .filter((id) => typeof id === 'string'),
    );
    created.set(device.external_id, { ...parsed, name, features });
    return parsed;
  };

  const pushDevice = async (parsed) => {
    if (parsed.type === DEVICE_TYPES.PLAYER) await pushPlayer(parsed.id);
    else if (parsed.id === server?.serverId) pushCollection();
  };

  gladys.onDeviceCreated(async (device) => {
    const parsed = track(device);
    if (!parsed) return;
    // States published before the creation were thrown away by Gladys.
    states.republish(device.external_id);
    await pushDevice(parsed);
    Object.values(WIDGETS).forEach((key) => refreshWidget(key, true));
    if (parsed.type === DEVICE_TYPES.PLAYER) playerRound();
  });

  gladys.onDeviceUpdated(async (device) => {
    const parsed = track(device);
    if (!parsed) return;
    states.republish(device.external_id);
    await pushDevice(parsed);
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

  // --- Remote control --------------------------------------------------------------------------

  /**
   * @description Send a command to a player, with the errors a user can act on.
   * @param {string} id - JewelBox device id.
   * @param {object} body - The command.
   * @returns {Promise<void>}
   */
  const command = async (id, body) => {
    if (remoteSupported === false) throw new UserError('errorRemoteUnavailable');
    try {
      await call((url) => client.command(url, id, body));
    } catch (error) {
      if (error instanceof JewelBoxError && error.status === 404 && body.command !== 'play_media') {
        throw new UserError('errorPlayerOffline', { player: nameOfPlayer(id) });
      }
      if (
        error instanceof JewelBoxError &&
        error.status === 404 &&
        !liveEntries.get(id)?.controllable
      ) {
        throw new UserError('errorPlayerOffline', { player: nameOfPlayer(id) });
      }
      if (error instanceof JewelBoxError && error.status === 422) {
        throw new UserError('errorPlayerUnsupported', {
          player: nameOfPlayer(id),
          error: error.message,
        });
      }
      throw error;
    }
    // The player confirms through its live state: the watch stream brings
    // it; this round is the fallback for a stream not (yet) open.
    clearTimeout(watchRound);
    watchRound = setTimeout(() => playerRound(), 1000);
    watchRound.unref?.();
  };

  const playerOfDevice = (device) => {
    const parsed = parseExternalId(gladys, device?.external_id);
    if (parsed?.type !== DEVICE_TYPES.PLAYER) throw new Error('not a JewelBox player');
    return parsed.id;
  };

  gladys.onSetValue(async (device, feature, value) => {
    const parsed = parseExternalId(gladys, feature?.external_id ?? device?.external_id);
    const key = String(feature?.external_id ?? '')
      .split(':')
      .pop();
    const body = parsed?.type === DEVICE_TYPES.PLAYER ? commandOf(key, value) : null;
    if (!body) throw new Error(`${feature?.external_id ?? 'this feature'} is read-only`);
    try {
      await command(parsed.id, body);
    } catch (error) {
      throw userFacing(error);
    }
  });

  // --- Music players: the catalog of JewelBox ----------------------------------------------------

  const artworkKey = (path) => gladys.artworkKey(path);
  const page = (items, offset, limit) => items.slice(offset, offset + Math.min(limit, MAX_ITEMS));
  const smartTitle = (key) => {
    const text = t(`smart_${key}`, config.language);
    return text === `smart_${key}` ? key : text;
  };
  const tracksText = (count) => t('tracksCount', config.language, { count });

  const browse = async (parentId, offset, limit) => {
    if (parentId === null || parentId === undefined || parentId === '') {
      const titles = {
        albums: t('folderAlbums', config.language),
        playlists: t('folderPlaylists', config.language),
        smart: t('folderSmart', config.language),
      };
      return {
        items: ROOT_FOLDERS.map((key) => folderItem(key, titles[key])),
        total: ROOT_FOLDERS.length,
      };
    }
    const parsed = parseMediaId(parentId);
    if (!parsed) throw new Error(`Unknown folder: ${parentId}`);
    if (parsed.kind === 'folder' && parsed.id === 'albums') {
      // /api/albums pages by its own size: the offset of Gladys is any number.
      const size = Math.min(limit, MAX_ITEMS);
      const first = Math.floor(offset / size) + 1;
      const answer = await call((url) =>
        client.albums(url, {
          page: first,
          limit: size,
          sort: 'artist',
          order: 'asc',
          wanted: 'false',
        }),
      );
      const skip = offset - (first - 1) * size;
      let data = answer.data.slice(skip);
      if (skip > 0 && data.length < size && answer.total > first * size) {
        const more = await call((url) =>
          client.albums(url, {
            page: first + 1,
            limit: size,
            sort: 'artist',
            order: 'asc',
            wanted: 'false',
          }),
        );
        data = data.concat(more.data).slice(0, size);
      }
      return { items: data.map((album) => albumItem(album, artworkKey)), total: answer.total };
    }
    if (parsed.kind === 'folder' && parsed.id === 'playlists') {
      const lists = await call((url) => client.playlists(url));
      return {
        items: page(lists, offset, limit).map((list) =>
          playlistItem(list, Number.isFinite(list.track_count) ? tracksText(list.track_count) : ''),
        ),
        total: lists.length,
      };
    }
    if (parsed.kind === 'folder' && parsed.id === 'smart') {
      const lists = await call((url) => client.smartPlaylists(url));
      return {
        items: page(lists, offset, limit).map((list) =>
          smartItem(
            list,
            smartTitle(list.key),
            Number.isFinite(list.track_count) ? tracksText(list.track_count) : '',
          ),
        ),
        total: lists.length,
      };
    }
    if (parsed.kind === 'album') {
      const album = await call((url) => client.album(url, parsed.id));
      const tracks = (album?.tracks ?? []).map((track) => trackItem(track, artworkKey, album));
      const items = [albumRadioItem(album, t('albumRadio', config.language)), ...tracks];
      return { items: page(items, offset, limit), total: items.length };
    }
    if (parsed.kind === 'playlist' || parsed.kind === 'smart') {
      const list =
        parsed.kind === 'playlist'
          ? await call((url) => client.playlist(url, parsed.id))
          : await call((url) => client.smartPlaylist(url, parsed.id));
      const tracks = (list?.tracks ?? []).map((track) => trackItem(track, artworkKey));
      return { items: page(tracks, offset, limit), total: tracks.length };
    }
    throw new Error(`Not a folder: ${parentId}`);
  };

  gladys.onMusicBrowse(async (device, { parentId = null, offset = 0, limit = MAX_ITEMS } = {}) => {
    playerOfDevice(device);
    try {
      return await browse(parentId, offset, limit);
    } catch (error) {
      throw userFacing(error);
    }
  });

  gladys.onMusicSearch(
    async (device, { query: text = '', type = null, limit = MAX_ITEMS } = {}) => {
      playerOfDevice(device);
      const clean = String(text ?? '').trim();
      if (clean.length < 2) return { items: [] };
      let answer;
      try {
        answer = await call((url) => client.search(url, clean));
      } catch (error) {
        throw userFacing(error);
      }
      const albums = Array.isArray(answer?.albums) ? answer.albums : [];
      const tracks = Array.isArray(answer?.tracks) ? answer.tracks : [];
      // Artists: those of the albums found whose name matches (played as a radio).
      const artists = new Map();
      for (const album of albums) {
        const artist = album.artist;
        if (artist?.id && sameText(String(artist.name ?? '').slice(0, clean.length), clean)) {
          artists.set(artist.id, artist);
        }
      }
      const items = [
        ...(type === null || type === 'artist'
          ? [...artists.values()].map((artist) =>
              artistItem(artist, t('artistRadio', config.language)),
            )
          : []),
        ...(type === null || type === 'album'
          ? albums.map((album) => albumItem(album, artworkKey))
          : []),
        ...(type === null || type === 'track'
          ? tracks.map((track) => trackItem(track, artworkKey))
          : []),
      ];
      return { items: items.slice(0, Math.min(limit, MAX_ITEMS)) };
    },
  );

  gladys.onMusicPlay(async (device, media, mode = 'replace') => {
    const id = playerOfDevice(device);
    const target = playMediaOf(media?.id);
    if (!target) throw new Error(`Not playable: ${media?.id}`);
    try {
      await command(id, { command: 'play_media', media: target, mode });
    } catch (error) {
      throw userFacing(error);
    }
  });

  gladys.onMusicQueueGet(async (device, { offset = 0, limit = MAX_ITEMS } = {}) => {
    const id = playerOfDevice(device);
    let queue;
    try {
      ({ queue } = await call((url) => client.queue(url, id)));
    } catch (error) {
      throw userFacing(error);
    }
    const tracks = Array.isArray(queue?.tracks) ? queue.tracks : [];
    const live = liveEntries.get(id)?.state;
    const index = Number.isInteger(live?.current_index) ? live.current_index : queue?.current_index;
    return {
      items: page(tracks, offset, limit).map((track) => trackItem(track, artworkKey)),
      currentIndex: Number.isInteger(index) && index >= 0 && index < tracks.length ? index : null,
      total: tracks.length,
    };
  });

  gladys.onMusicQueuePlay(async (device, index) => {
    const id = playerOfDevice(device);
    try {
      await command(id, { command: 'play_index', index: Number(index) });
    } catch (error) {
      throw userFacing(error);
    }
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
      remoteSupported = null;
      stopWatch();
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

  action(ACTIONS.SLEEP_TIMER, async (fields) => {
    const body = sleepTimerCommand(fields.duration);
    if (!body) throw new UserError('errorSleepDuration');
    const id = playerOf(fields.player);
    await command(id, body);
    return { player_name: cut(nameOfPlayer(id)) };
  });

  // --- Wake up to music ---

  const ramps = new Map(); // device id -> timer of its volume ramp

  const stopRamp = (id) => {
    clearTimeout(ramps.get(id));
    ramps.delete(id);
  };

  /**
   * @description Raise the volume of a player step by step (wakeUpPlan),
   * until the end or until the user takes over.
   * @param {string} id - JewelBox device id.
   * @param {Array<{ afterMs: number, volume: number }>} steps - The steps.
   * @param {number} lastSent - The volume sent last.
   */
  const ramp = (id, steps, lastSent) => {
    stopRamp(id);
    const [step, ...rest] = steps;
    if (!step || stopped) return;
    const timer = setTimeout(async () => {
      if (ramps.get(id) !== timer) return;
      ramps.delete(id);
      if (!rampGoesOn(playback.get(id), lastSent)) return;
      try {
        await command(id, { command: 'volume', volume: step.volume });
      } catch (error) {
        logger.warn(`JewelBox: wake up volume failed: ${error?.message ?? error}`);
        return;
      }
      ramp(id, rest, step.volume);
    }, step.afterMs);
    timer.unref?.();
    ramps.set(id, timer);
  };

  const playlistByName = async (name) => {
    const text = String(name ?? '').trim();
    const lists = await call((url) => client.playlists(url));
    const found = lists.find((list) => sameText(list.name, text));
    if (!found) throw new UserError('errorPlaylistNotFound', { playlist: text.slice(0, 200) });
    return found;
  };

  /**
   * @description What a wake up plays.
   * @param {string} music - WAKE_UP_MUSIC value.
   * @param {string} name - Album title or playlist name, for those two.
   * @returns {Promise<{ media: object, title: string }>} The play_media target and its text.
   */
  const wakeUpMedia = async (music, name) => {
    const album = (found) => {
      if (!found) throw new UserError('errorNoAlbum');
      return { media: { type: 'album', id: found.id }, title: albumText(found) };
    };
    switch (music) {
      case WAKE_UP_MUSIC.FAVOURITES:
        return {
          media: { type: 'smart', id: 'favourites' },
          title: t('wakeFavourites', config.language),
        };
      case WAKE_UP_MUSIC.RANDOM_ALBUM:
        return album(await randomAlbum());
      case WAKE_UP_MUSIC.ALBUM_OF_THE_DAY:
        return album(await albumOfTheDay());
      case WAKE_UP_MUSIC.ALBUM:
        return album(await resolveAlbum(name));
      case WAKE_UP_MUSIC.PLAYLIST: {
        const list = await playlistByName(name);
        return { media: { type: 'playlist', id: list.id }, title: String(list.name) };
      }
      default:
        return {
          media: { type: 'smart', id: 'dynamic_mix' },
          title: t('wakeDynamicMix', config.language),
        };
    }
  };

  action(ACTIONS.WAKE_UP, async (fields) => {
    const id = playerOf(fields.player);
    const plan = wakeUpPlan(fields);
    const { media, title } = await wakeUpMedia(fields.music, fields.name);
    stopRamp(id);
    // Without the volume control (never announced): the music plays as is.
    const withVolume = (capabilities.get(id) ?? []).includes('volume');
    if (withVolume) await command(id, { command: 'volume', volume: plan.start });
    await command(id, { command: 'play_media', media, mode: 'replace' });
    if (withVolume) ramp(id, plan.steps, plan.start);
    return { player_name: cut(nameOfPlayer(id)), title: cut(title) };
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

  gladys.onWidgetGet(WIDGETS.COLLECTION, async ({ settings = {}, language } = {}) =>
    settings.view === VIEW_SETTING.LISTENING
      ? listeningWidget(settings, language)
      : buildCollectionWidget({
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

  const listeningWidget = async (settings, language) => {
    const period = Object.values(PERIOD_SETTING).includes(settings.period)
      ? settings.period
      : PERIOD_SETTING.MONTH;
    let data = reachable ? listening : undefined;
    if (reachable && listening && period !== PERIOD_SETTING.MONTH) {
      const cached = listeningOther.get(period);
      if (cached && now() - cached.at < LISTENING_TTL_MS) {
        data = cached.data;
      } else {
        data = await safely(
          () => call((url) => client.listeningStats(url, period)),
          'reading the listening statistics',
        );
        if (data) listeningOther.set(period, { data, at: now() });
        else data = undefined;
      }
    }
    return buildListeningWidget({ listening: data, period, language: languageOf(language) });
  };

  gladys.onWidgetGet(WIDGETS.RECENTLY_ADDED, async ({ settings = {}, language } = {}) =>
    buildRecentlyAddedWidget({
      albums: reachable ? recent : null,
      list: Object.values(LIST_SETTING).includes(settings.list) ? settings.list : LIST_SETTING.ALL,
      language: languageOf(language),
    }),
  );

  /**
   * @description The bytes of a cover, as Gladys takes them (widgets and
   * player artwork share the same bounds).
   * @param {string} file - `<md5>.<ext>` (coverFile).
   * @returns {Promise<string>} Raw base64.
   */
  const coverImage = async (file) => {
    const { data, type } = await call((url) => client.cover(url, file));
    if (!/^image\/(jpeg|png|webp)/.test(type)) throw new Error(`Not an image: ${type}`);
    if (data.length > MAX_IMAGE_BYTES) {
      throw new Error(
        `The cover ${file} is too large for Gladys (${Math.round(data.length / 1024)} KB)`,
      );
    }
    return data.toString('base64');
  };

  gladys.onWidgetGetImage(async (imageKey) => {
    const file = coverFile(imageKey);
    if (!file) throw new Error(`Unknown image key: ${imageKey}`);
    return coverImage(file);
  });

  // The `artwork` of a player: the SDK keyed the cover path we gave it
  // (nowPlayingOf); the key leads back to that path only, checked again.
  gladys.onMusicGetArtwork(async (key) => {
    const file = coverFile(coverKey(gladys.artworkUrls?.get(key)));
    if (!file) throw new Error(`Unknown artwork key: ${key}`);
    return coverImage(file);
  });

  // --- Lifecycle -------------------------------------------------------------------------------

  const start = async () => {
    // gladys.config is filled by connect(), after createApp.
    config = normalizeConfig(gladys.config ?? {});
    const saved = await safely(() => storage.read(REMINDERS_FILE), 'reading /data');
    for (const key of Array.isArray(saved?.loans) ? saved.loans : []) {
      if (typeof key === 'string') reminded.add(key);
    }
    const known = await safely(() => storage.read(PLAYERS_FILE), 'reading /data');
    for (const [id, list] of Object.entries(known?.capabilities ?? {})) {
      if (isPlayerId(id)) capabilities.set(id, capabilitiesOf(list));
    }
    const devices = (await safely(() => gladys.getDevices(), 'reading the devices')) ?? [];
    for (const device of Array.isArray(devices) ? devices : []) track(device);
    await locate();
    if (server && reachable) await publishDiscovered();
    await Promise.all([playerRound(), collectionRound()]);
  };

  const stop = async () => {
    stopped = true;
    stopWatch();
    for (const id of [...ramps.keys()]) stopRamp(id);
    clearTimeout(watchRound);
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
    capabilities,
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
