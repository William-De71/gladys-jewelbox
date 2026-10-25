import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { TRIGGERS, ACTIONS } from '../src/scenes.js';
import { CONFIG_ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import { BOUNDS, DEFAULTS, LANGUAGES } from '../src/config.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const lock = read('../package-lock.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-jewelbox';

test('a device integration, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.name, 'JewelBox');
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-jewelbox:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-jewelbox');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
});

test('local transport only: the JewelBox server on the LAN, found by mDNS', () => {
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: '_jewelbox._tcp' }]);
  assert.match(source('../src/app.js'), /scanNetwork\('mdns'/);
  // Only the client sends requests.
  for (const file of [
    'app',
    'collection',
    'config',
    'devices',
    'i18n',
    'playback',
    'scenes',
    'states',
    'time',
    'widgets',
  ]) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('personal integration: never tagged for the store', () => {
  assert.ok(!pkg.keywords.includes('gladys-assistant-integration'));
  assert.match(source('../.github/workflows/release.yml'), /must stay out of the store/);
});

test('the music players need Gladys 5.3.0; no other permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  // Now playing and artwork only: JewelBox has no catalog to play from nor
  // any command channel, so no operation is declared.
  assert.deepEqual(manifest.music, {});
  assert.deepEqual(manifest.categories, ['multimedia']);
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'webhooks',
    'messaging',
    'energy_contracts',
    'account_schema',
  ]) {
    assert.equal(manifest[key], undefined, `${key} (permission, or a newer Gladys)`);
  }
});

test('the configuration mirrors src/config.js', () => {
  const config = byKey(manifest.config_schema);
  assert.deepEqual(
    [...config.keys()],
    ['intro', 'server_url', 'language', 'loan_reminder_days', 'players_max_age_days'],
  );
  assert.equal(config.get('server_url').type, 'string');
  assert.equal(config.get('server_url').required, false);
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (key !== 'server_url') assert.equal(config.get(key).default, value, key);
  }
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    assert.deepEqual(
      [config.get(key).type, config.get(key).min, config.get(key).max],
      ['number', min, max],
    );
  }
  assert.deepEqual(
    config.get('language').options.map((option) => option.value),
    LANGUAGES,
  );
  for (const field of manifest.config_schema) {
    assert.ok(!['text', 'password'].includes(field.type), field.key);
    assert.equal(field.display_if, undefined, `${field.key}: display_if`);
    if (field.type === 'section') {
      for (const language of LANGUAGES) assert.ok(field.description[language].length <= 1000);
    }
  }
});

test('declares exactly the scene triggers, actions, buttons and widgets the code handles', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key),
    Object.values(TRIGGERS),
  );
  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    Object.values(WIDGETS),
  );
  for (const key of Object.keys(WIDGETS)) {
    assert.match(app, new RegExp(`onWidgetGet\\(WIDGETS\\.${key}`), key);
  }
  assert.match(app, /onWidgetAction\(WIDGETS\.ALBUM_OF_THE_DAY/);
  for (const key of Object.keys(ACTIONS)) {
    assert.match(app, new RegExp(`action\\(ACTIONS\\.${key}`), key);
  }
  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(CONFIG_ACTIONS),
  );
  assert.match(app, /onAction\(CONFIG_ACTIONS\.TEST_CONNECTION/);
  // Every trigger field filters a key of the event data, which is a variable too.
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((variable) => variable.key === field.key),
        `${trigger.key}.${field.key}`,
      );
    }
  }
});

test('limits: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20 && manifest.scene_actions.length <= 20);
  for (const trigger of manifest.scene_triggers) {
    assert.ok((trigger.fields ?? []).length <= 10 && trigger.variables.length <= 20, trigger.key);
  }
  for (const action of manifest.scene_actions) {
    assert.ok((action.fields ?? []).length <= 10, action.key);
    assert.ok(action.outputs.length <= 20, action.key);
  }
  for (const action of [...manifest.scene_actions, ...manifest.actions]) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  for (const widget of manifest.widgets) {
    for (const setting of widget.settings ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(setting.type));
    }
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('catalog keywords (Gladys 5.3.0), worldwide', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  for (const keyword of keywords) {
    assert.ok(keyword.trim().length >= 2 && keyword.trim().length <= 30, keyword);
  }
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, normalized.length);
  assert.ok(!normalized.includes(manifest.name.toLowerCase()));
  // A self-hosted server on the LAN: usable anywhere.
  assert.equal(manifest.countries, undefined);
});
