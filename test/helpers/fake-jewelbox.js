// A fake JewelBox Music Library server for the tests, never the network: the
// routes the integration uses, with the shapes of a real server (1.17.0),
// on a clock the test drives. Dates are written like SQLite does
// (`YYYY-MM-DD HH:MM:SS`, UTC) except `lent_at` (ISO, like JewelBox).

export const SERVER_ID = '009004e9-ab55-4894-9e96-10e930a04b7f';
export const BASE = 'http://10.0.20.21:3001';
export const COVER = 'a1e67298241294dffe2e8f3a18f72d24';

export const sqlDate = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

let nextId = 1;

/**
 * @description An album as JewelBox answers it.
 * @param {object} fields - Fields to set.
 * @returns {object} The album.
 */
export function makeAlbum(fields = {}) {
  const id = fields.id ?? nextId++;
  return {
    id,
    title: `Album ${id}`,
    year: 1999,
    genre: 'Rock',
    total_duration: '43:04',
    ean: null,
    rating: 4,
    cover_url: `/covers/${COVER}.jpeg`,
    notes: null,
    is_lent: false,
    lent_to: null,
    lent_at: null,
    is_wanted: false,
    audio_folder: null,
    has_audio: true,
    created_at: '2026-01-01 10:00:00',
    updated_at: '2026-01-01 10:00:00',
    artist: { id: 1, name: 'Opeth' },
    label: { id: 1, name: 'Peaceville' },
    ...fields,
  };
}

/**
 * @description Create the fake server.
 * @param {object} options - Options.
 * @param {Function} options.now - Clock (ms).
 * @returns {object} `{ fetch, state, calls }`.
 */
export function createFakeJewelBox({ now }) {
  const state = {
    up: true,
    serverId: SERVER_ID,
    db: { id: 2, name: 'will_cd_collections' },
    albums: [],
    // device id -> { label, source, index, position, updatedAt (ms), tracks }
    queues: new Map(),
    suggestions: null,
    scan: { running: false, result: null },
    // Remote control (JewelBox 1.18): null for an older server (no routes);
    // else device id -> { label, controllable, capabilities, state }.
    remote: null,
    commands: [], // [device id, body] received
    watchers: [], // stream controllers of /api/player/remote/watch
    playlists: [{ id: 3, name: 'Road trip', track_count: 2, tracks: [] }],
    smart: [
      { key: 'favourites', track_count: 1 },
      { key: 'dynamic_mix', track_count: 50 },
    ],
    coverBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
    // Listening statistics (JewelBox 1.20): null for an older server (404);
    // else period -> the answer of /api/player/stats.
    listening: null,
  };
  const calls = [];

  const json = (body, status = 200) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', date: new Date(now()).toUTCString() },
    });

  const stats = () => {
    const owned = state.albums.filter((album) => !album.is_wanted);
    const rated = owned.filter((album) => album.rating);
    const decades = new Map();
    const genres = new Map();
    for (const album of owned) {
      if (album.year)
        decades.set(
          Math.floor(album.year / 10) * 10,
          (decades.get(Math.floor(album.year / 10) * 10) ?? 0) + 1,
        );
      if (album.genre) genres.set(album.genre, (genres.get(album.genre) ?? 0) + 1);
    }
    return {
      total_owned: owned.length,
      total_wanted: state.albums.length - owned.length,
      total_lent: owned.filter((album) => album.is_lent).length,
      total_artists: new Set(owned.map((album) => album.artist.id)).size,
      avg_rating: rated.length
        ? Math.round((rated.reduce((sum, album) => sum + album.rating, 0) / rated.length) * 10) / 10
        : null,
      total_duration_hours: 12,
      total_duration_mins: 30,
      by_genre: [...genres]
        .map(([genre, count]) => ({ genre, count }))
        .sort((a, b) => b.count - a.count),
      by_decade: [...decades]
        .map(([decade, count]) => ({ decade, count }))
        .sort((a, b) => a.decade - b.decade),
      top_artists: [],
      top_labels: [],
    };
  };

  const listAlbums = (params) => {
    let list = [...state.albums];
    if (params.get('genre')) list = list.filter((album) => album.genre === params.get('genre'));
    if (params.get('lent') === 'true') list = list.filter((album) => album.is_lent);
    if (params.get('wanted') === 'true') list = list.filter((album) => album.is_wanted);
    if (params.get('wanted') === 'false') list = list.filter((album) => !album.is_wanted);
    const search = params.get('search')?.toLowerCase();
    if (search) {
      list = list.filter(
        (album) =>
          album.title.toLowerCase().includes(search) ||
          album.artist.name.toLowerCase().includes(search),
      );
    }
    if (params.get('sort') === 'created_at') {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title));
    }
    if (params.get('order') === 'desc') list.reverse();
    const limit = Number(params.get('limit') || 24);
    const page = Number(params.get('page') || 1);
    return {
      data: list.slice((page - 1) * limit, page * limit),
      pagination: { total: list.length, page, limit, totalPages: Math.ceil(list.length / limit) },
    };
  };

  const queueOf = (id) => {
    const queue = state.queues.get(id);
    if (!queue) return null;
    return {
      device_id: id,
      device_label: queue.label,
      source_label: queue.source ?? null,
      current_index: queue.index,
      position_sec: queue.position,
      updated_at: sqlDate(queue.updatedAt),
      tracks: queue.tracks.map((track, position) => ({
        entry_id: position + 1,
        position,
        has_file: true,
        play_count: 0,
        is_favorite: false,
        cover_url: `/covers/${COVER}.jpeg`,
        ...track,
      })),
    };
  };

  const fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const { pathname, searchParams } = new URL(url);
    calls.push(`${method} ${pathname}${searchParams.size ? `?${searchParams}` : ''}`);
    if (!state.up) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    if (!url.startsWith(BASE)) {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'EHOSTUNREACH' };
      throw error;
    }
    if (init.headers?.['X-Device-Id'] !== 'gladys-integration')
      return json({ error: 'X-Device-Id header is required' }, 400);
    const body = init.body ? JSON.parse(init.body) : null;
    let match;

    if (pathname === '/api/server-info') {
      return json({
        app: 'jewelbox',
        name: 'JewelBox Music Library',
        version: '1.17.0',
        server_id: state.serverId,
        api: '/api',
        collection: state.db.name,
      });
    }
    if (pathname === '/api/database/active') {
      return json({ database: { ...state.db, path: '/x.db', is_active: 1 } });
    }
    if (pathname === '/api/stats') return json(stats());
    if (pathname === '/api/player/stats') {
      const answer = state.listening?.[searchParams.get('period')];
      return answer ? json(answer) : json({ error: 'Not found' }, 404);
    }
    if (pathname === '/api/albums/genres') {
      return json([...new Set(state.albums.map((album) => album.genre).filter(Boolean))].sort());
    }
    if (pathname === '/api/albums') return json(listAlbums(searchParams));
    if ((match = /^\/api\/albums\/(\d+)\/lend$/.exec(pathname)) && method === 'PATCH') {
      const album = state.albums.find((item) => item.id === Number(match[1]));
      if (!album) return json({ error: 'Album not found' }, 404);
      Object.assign(album, {
        is_lent: body.is_lent,
        lent_to: body.is_lent ? (body.lent_to ?? null) : null,
        lent_at: body.is_lent ? new Date(now()).toISOString() : null,
      });
      return json(album);
    }
    if ((match = /^\/api\/albums\/(\d+)$/.exec(pathname))) {
      const album = state.albums.find((item) => item.id === Number(match[1]));
      return album ? json({ tracks: [], ...album }) : json({ error: 'Album not found' }, 404);
    }
    if (pathname === '/api/player/home') {
      const suggestions =
        state.suggestions ?? state.albums.filter((album) => !album.is_wanted).slice(0, 12);
      return json({ recent: [], suggestions });
    }
    if (pathname === '/api/player/queue/devices') {
      return json({
        data: [...state.queues.keys()].map((id) => {
          const queue = queueOf(id);
          const track = queue.tracks[queue.current_index] ?? null;
          return {
            device_id: id,
            device_label: queue.device_label,
            source_label: queue.source_label,
            current_index: queue.current_index,
            updated_at: queue.updated_at,
            track_count: queue.tracks.length,
            current_track: track && {
              id: track.id,
              title: track.title,
              artist_name: track.artist_name,
              album_title: track.album_title,
              cover_url: track.cover_url,
            },
          };
        }),
      });
    }
    if ((match = /^\/api\/player\/queue\/devices\/(.+)$/.exec(pathname))) {
      const queue = queueOf(decodeURIComponent(match[1]));
      return queue ? json(queue) : json({ error: 'No queue for this device' }, 404);
    }
    if (pathname.startsWith('/api/player/remote/') && !state.remote) {
      return json({ error: 'Not found' }, 404);
    }
    if (pathname === '/api/player/remote/devices') {
      return json({
        data: [...state.remote].map(([id, entry]) => ({
          device_id: id,
          device_label: entry.label ?? null,
          controllable: Boolean(entry.controllable),
          capabilities: entry.controllable ? (entry.capabilities ?? []) : [],
          state: entry.state ?? null,
        })),
      });
    }
    if ((match = /^\/api\/player\/remote\/devices\/(.+)\/commands$/.exec(pathname))) {
      const id = decodeURIComponent(match[1]);
      const entry = state.remote.get(id);
      if (!entry?.controllable) return json({ error: 'not connected' }, 404);
      const body = JSON.parse(init.body);
      if (state.refuse?.(body)) return json({ error: state.refuse(body) }, 422);
      state.commands.push([id, body]);
      return json({ id: `c${state.commands.length}` }, 202);
    }
    if (pathname === '/api/player/remote/watch') {
      const stream = new ReadableStream({
        start(controller) {
          state.watchers.push(controller);
          init.signal?.addEventListener('abort', () => {
            try {
              controller.error(new DOMException('aborted', 'AbortError'));
            } catch {
              // already closed
            }
          });
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream', date: new Date(now()).toUTCString() },
      });
    }
    if (pathname === '/api/playlists') return json({ data: state.playlists });
    if ((match = /^\/api\/playlists\/(\d+)$/.exec(pathname))) {
      const list = state.playlists.find((item) => item.id === Number(match[1]));
      return list ? json(list) : json({ error: 'Playlist not found' }, 404);
    }
    if (pathname === '/api/smart-playlists') return json({ data: state.smart });
    if ((match = /^\/api\/smart-playlists\/([a-z_]+)$/.exec(pathname))) {
      return json({ key: match[1], tracks: state.smartTracks ?? [] });
    }
    if (pathname === '/api/player/search') {
      const q = (searchParams.get('q') ?? '').toLowerCase();
      const albums = state.albums.filter(
        (album) =>
          !album.is_wanted &&
          (album.title.toLowerCase().includes(q) || album.artist.name.toLowerCase().includes(q)),
      );
      return json({
        albums,
        tracks: (state.searchTracks ?? []).filter((t) => t.title.toLowerCase().includes(q)),
      });
    }
    if (pathname === '/api/player/scan' && method === 'POST') {
      if (state.scan.running) return json({ error: 'Scan already running' }, 409);
      state.scan = {
        running: false,
        result: {
          matched_tracks: 120,
          matched_albums: 10,
          unmatched_count: 2,
          unmatched_files: [],
          errors: [],
        },
      };
      return json({ message: 'Scan started' }, 202);
    }
    if (pathname === '/api/player/scan/status')
      return json({ running: state.scan.running, result: state.scan.result });
    if ((match = /^\/covers\/([0-9a-f]{32}\.\w+)$/.exec(pathname))) {
      return new Response(state.coverBytes, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', date: new Date(now()).toUTCString() },
      });
    }
    return json({ error: 'Not found' }, 404);
  };

  // Pushes one event to the open watch streams.
  const emit = (event, data) => {
    const bytes = new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    for (const controller of state.watchers) {
      try {
        controller.enqueue(bytes);
      } catch {
        // closed
      }
    }
  };

  return { fetch, state, calls, emit };
}
