// -----------------------------------------------------------------------------
// Non-regression of everything users store: the device and feature external
// ids, the fields the Discovery "Update" button compares (category, type,
// unit, min, max, step), and every key of the manifest a scene, a widget or a
// saved configuration refers to.
//
// test/fixtures/discovery.baseline.json was generated from version 0.1.0 (the
// first release), then extended with the features added since (the `music_*`
// features of the players, Gladys 5.3.0): additions only. A failure here means existing users would have to delete
// and recreate a device, or would lose a scene or a widget setting: never
// update the baseline without a documented migration
// (UPDATE_BASELINE=1 npm test rewrites it, on purpose only).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildCollectionDevice, buildPlayerDevice } from '../src/devices.js';

const fakeGladys = {
  externalIds: (type, id) => ({
    device: `ext:test-integration:${type}:${id}`,
    feature: (key) => `ext:test-integration:${type}:${id}:${key}`,
  }),
};

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const BASELINE = new URL('./fixtures/discovery.baseline.json', import.meta.url);

const ETERNAL = [
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
];
const pick = (feature) =>
  Object.fromEntries(
    ETERNAL.filter((key) => feature[key] !== undefined).map((key) => [key, feature[key]]),
  );
const keys = (list) => (list ?? []).map((item) => item.key);
const options = (fields) =>
  Object.fromEntries(
    (fields ?? [])
      .filter((field) => field.options)
      .map((field) => [field.key, field.options.map((option) => option.value)]),
  );
const shape = (device) => ({
  external_id: device.external_id,
  should_poll: device.should_poll,
  params: device.params.map((param) => param.name),
  features: device.features.map(pick),
});

const devices = () => ({
  collection: shape(
    buildCollectionDevice(fakeGladys, { serverId: '009004e9-ab55-4894-9e96-10e930a04b7f' }, 'en'),
  ),
  player: shape(
    buildPlayerDevice(fakeGladys, '249102a0-f41b-4c4c-b17a-ec3eee29edf4', 'JewelBox', 'en'),
  ),
});

const manifestKeys = () => ({
  config_schema: manifest.config_schema.map(({ key, type }) => ({ key, type })),
  config_options: options(manifest.config_schema),
  actions: keys(manifest.actions),
  widgets: manifest.widgets.map((widget) => ({
    key: widget.key,
    settings: keys(widget.settings),
    options: options(widget.settings),
  })),
  scene_triggers: manifest.scene_triggers.map((trigger) => ({
    key: trigger.key,
    fields: keys(trigger.fields),
    options: options(trigger.fields),
    variables: trigger.variables.map(({ key, type }) => ({ key, type })),
  })),
  scene_actions: manifest.scene_actions.map((action) => ({
    key: action.key,
    fields: keys(action.fields),
    options: options(action.fields),
    outputs: action.outputs.map(({ key, type }) => ({ key, type })),
  })),
});

if (process.env.UPDATE_BASELINE === '1') {
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ devices: devices(), manifest: manifestKeys() }, null, 2)}\n`,
  );
}
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));

test('devices: external ids and the fields of the Discovery "Update" button never change', () => {
  const now = devices();
  for (const [key, before] of Object.entries(baseline.devices)) {
    const after = now[key];
    assert.deepEqual(
      { ...after, features: undefined },
      { ...before, features: undefined },
      `${key}: device fields`,
    );
    // A feature is never removed nor changed; new ones may be added (the
    // user gets them with the Discovery "Update" button), and are in the
    // baseline from then on.
    for (const feature of before.features) {
      assert.deepEqual(
        after.features.find((f) => f.external_id === feature.external_id),
        feature,
        feature.external_id,
      );
    }
    for (const feature of after.features) {
      assert.ok(
        before.features.some((f) => f.external_id === feature.external_id),
        `${feature.external_id} is not in the baseline yet (UPDATE_BASELINE=1, an addition only)`,
      );
    }
  }
});

test('manifest: every key users store is still there, unchanged (new ones may be added)', () => {
  const now = manifestKeys();
  for (const field of baseline.manifest.config_schema)
    assert.ok(
      now.config_schema.some((f) => f.key === field.key && f.type === field.type),
      field.key,
    );
  for (const [key, values] of Object.entries(baseline.manifest.config_options)) {
    for (const value of values)
      assert.ok(now.config_options[key]?.includes(value), `${key}=${value}`);
  }
  for (const key of baseline.manifest.actions) assert.ok(now.actions.includes(key), key);
  for (const list of ['widgets', 'scene_triggers', 'scene_actions']) {
    for (const before of baseline.manifest[list]) {
      const after = now[list].find((entry) => entry.key === before.key);
      assert.ok(after, `${list}.${before.key} removed`);
      for (const key of before.settings ?? before.fields) {
        assert.ok((after.settings ?? after.fields).includes(key), `${list}.${before.key}.${key}`);
      }
      for (const [key, values] of Object.entries(before.options)) {
        for (const value of values)
          assert.ok(after.options[key]?.includes(value), `${list}.${before.key}.${key}=${value}`);
      }
      for (const name of ['variables', 'outputs']) {
        for (const item of before[name] ?? []) {
          assert.ok(
            after[name].some((x) => x.key === item.key && x.type === item.type),
            `${list}.${before.key}.${item.key}`,
          );
        }
      }
    }
  }
});
