// -----------------------------------------------------------------------------
// Entry point of the JewelBox integration.
//
// JewelBox Music Library (a self-hosted CD collection, on the local network,
// found by mDNS):
//   - devices: the collection (counters: albums, wish list, loans, artists,
//     rating, playing time, oldest loan) and one per player (state, track,
//     artist, album — read-only, inferred from the queues; src/playback.js);
//   - scene triggers: album added, lent, returned, loan overdue, playback
//     started / stopped, new track;
//   - scene actions: now playing, random album, album of the day, lend,
//     return, library scan;
//   - dashboard widgets: player, collection, loans, album of the day,
//     recently added.
//
// This file only wires the SDK client: the handlers are in src/app.js,
// registered before connect() (the SDK requires it).
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
// The SDK reads them: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
const app = createApp(gladys, { logger });

gladys.handleShutdown(() => app.stop());

logger.info(`Starting the JewelBox integration ${version}...`);
try {
  await gladys.connect();
  await app.start();
} catch (error) {
  logger.error('JewelBox: startup failed', error);
  process.exit(1);
}
