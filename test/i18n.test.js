import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { LANGUAGES, TEXTS, all, t } from '../src/i18n.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../gladys-assistant-integration.json'));

/**
 * @description Every multi-language object of the manifest, with its path.
 * @param {unknown} node - A manifest node.
 * @param {string} path - Its path.
 * @returns {Array<[string, object]>} The texts.
 */
function texts(node, path = '') {
  if (Array.isArray(node)) {
    return node.flatMap((child, i) => texts(child, `${path}[${i}]`));
  }
  if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      return [[path, node]];
    }
    return Object.entries(node).flatMap(([key, child]) => texts(child, `${path}.${key}`));
  }
  return [];
}

test('every manifest text (widgets, triggers, actions, fields, variables, outputs) has both languages', () => {
  const found = texts(manifest);
  assert.ok(found.length > 100);
  for (const [path, text] of found) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), path);
    for (const language of LANGUAGES) {
      assert.ok(text[language]?.trim(), `${path}.${language} is missing`);
    }
  }
});

test('catalog description: 10 to 100 characters per language', () => {
  for (const language of LANGUAGES) {
    const { length } = manifest.description[language];
    assert.ok(length >= 10 && length <= 100, `description.${language}: ${length}`);
  }
});

test('widget labels: 3 to 30 characters, descriptions: 100 at most, per language', () => {
  for (const widget of manifest.widgets) {
    for (const language of LANGUAGES) {
      const { length } = widget.label[language];
      assert.ok(length >= 3 && length <= 30, `${widget.key}.label.${language}: ${length}`);
      const size = widget.description[language].length;
      assert.ok(size <= 100, `${widget.key}.description.${language}: ${size}`);
    }
  }
});

test('every runtime text exists in both languages, with the same placeholders', () => {
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [key, entry] of Object.entries(TEXTS)) {
    for (const language of LANGUAGES) {
      assert.ok(entry[language], `${key}.${language} is missing`);
      assert.deepEqual(placeholders(entry[language]), placeholders(entry.en), `${key}.${language}`);
    }
  }
  assert.equal(t('never', 'it'), 'never', 'English fallback');
});

test('status messages, toasts and widget texts stay within their bounds', () => {
  const bound = (keys, max, values = {}) => {
    for (const key of keys) {
      for (const [language, text] of Object.entries(all(key, values))) {
        assert.ok(text.length <= max, `${key}.${language}: ${text.length} > ${max}`);
      }
    }
  };
  const named = (pattern) => Object.keys(TEXTS).filter((key) => pattern.test(key));
  const long = 'x'.repeat(40);
  // setConnectionStatus and toasts: 200 characters.
  bound(named(/^status/), 200, { url: 'http://192.168.100.200:3001', error: 'ECONNREFUSED' });
  bound(named(/^toast/), 200, { album: 'x'.repeat(180).slice(0, 180) });
  bound(named(/^error/), 200, {
    album: long,
    who: long,
    genre: long,
    count: 12,
    error: 'x'.repeat(80),
  });
  // Widget: tile labels and buttons 24, status labels and values 40.
  bound(
    [
      'widgetAnother',
      'widgetToday',
      'widgetHours',
      'feature_owned',
      'feature_wanted',
      'feature_lent',
      'feature_artists',
    ],
    24,
  );
  bound(
    [
      'widgetNoServer',
      'widgetNoPlayer',
      'widgetNoLoan',
      'widgetEmptyCollection',
      'widgetNothingAdded',
    ],
    300,
  );
  bound(['widgetDays', 'widgetWishlist'], 16, { n: 3650 });
  bound(['widgetMore'], 80, { n: 100 });
  bound(
    [
      'widgetState',
      'widgetTrack',
      'widgetArtist',
      'widgetAlbum',
      'widgetSource',
      'widgetPlaying',
      'widgetNoQueue',
      'widgetAverageRating',
      'widgetYear',
      'widgetGenre',
      'widgetLabel',
      'widgetRating',
      'widgetLent',
      'widgetPick',
      'widgetPickToday',
      'widgetPickDrawn',
      'widgetByDecade',
      'widgetAlbums',
    ],
    40,
  );
  bound(['widgetStopped'], 40, { ago: 'il y a 23 h' });
  bound(named(/^feature_/), 60);
});

test('docs: both languages, same structure, more than 300 characters', () => {
  const headings = (text) => text.split('\n').filter((line) => /^#{1,3} /.test(line)).length;
  const tables = (text) => text.split('\n').filter((line) => /^\|\s*-/.test(line)).length;
  const docs = Object.fromEntries(
    LANGUAGES.map((language) => {
      const path = new URL(`../docs/${language}.md`, import.meta.url);
      assert.ok(existsSync(path), `docs/${language}.md is missing`);
      return [language, readFileSync(path, 'utf8')];
    }),
  );
  for (const language of LANGUAGES) {
    assert.ok(docs[language].length > 300, `docs/${language}.md is too short`);
    assert.equal(headings(docs[language]), headings(docs.en), `docs/${language}.md headings`);
    assert.equal(tables(docs[language]), tables(docs.en), `docs/${language}.md tables`);
    // The store re-hosts the docs: images by absolute URL only.
    for (const [, url] of docs[language].matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      assert.match(url, /^https:\/\/raw\.githubusercontent\.com\//, `docs/${language}.md: ${url}`);
    }
  }
});

const RAW = 'https://raw.githubusercontent.com/William-De71/gladys-jewelbox/main/';

test('docs: the generated widget image of their language, never the cover', () => {
  for (const language of LANGUAGES) {
    const text = readFileSync(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    assert.ok(text.includes(`(${RAW}docs/assets/widgets.${language}.png)`), language);
    assert.match(text, /generated illustration|illustration générée/);
    assert.doesNotMatch(text, /cover\.jpg/, 'the store already shows the cover');
  }
});

test('README: badges, the cover under them, the widget image of their language', () => {
  const files = { en: 'README.md', fr: 'README.fr.md' };
  for (const [language, file] of Object.entries(files)) {
    const text = read(`../${file}`);
    const lines = text.split('\n');
    const badges = lines.findIndex((line) => line.includes('img.shields.io/badge/'));
    assert.match(lines[badges], /badge\/(license|licence)-Apache--2\.0/, file);
    assert.match(text, /github\/v\/release\/William-De71\/gladys-jewelbox\?sort=semver/, file);
    assert.match(text, /workflow\/status\/William-De71\/gladys-jewelbox\/release\.yml/, file);
    // The Gladys badge says the range of the manifest.
    const gladys = JSON.parse(read('../gladys-assistant-integration.json')).gladys_version;
    assert.ok(text.includes(`Gladys-%E2%89%A5%20${gladys.replace('>=', '')}-`), file);
    // The cover right under the four badges, before the pitch.
    assert.match(
      lines[badges + 5],
      /^!\[JewelBox (for|pour) Gladys Assistant\]\(cover\.jpg\)$/,
      file,
    );
    assert.ok(text.includes(`(docs/assets/widgets.${language}.png)`), `${file} widget image`);
    assert.ok(text.includes('(docs/assets/architecture.svg)'), file);
    assert.ok(text.includes('(docs/assets/release-pipeline.svg)'), file);
    assert.equal((text.match(/```mermaid/g) ?? []).length, 2, `${file}: architecture, sequence`);
  }
});

test('images: every generated widget image and the cover exist', () => {
  for (const language of LANGUAGES) {
    const png = readFileSync(new URL(`../docs/assets/widgets.${language}.png`, import.meta.url));
    assert.equal(png.toString('latin1', 1, 4), 'PNG', language);
  }
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  // JPEG SOF0/SOF2 frame: height then width.
  const frame = cover.findIndex(
    (byte, index) => byte === 0xff && [0xc0, 0xc2].includes(cover[index + 1]),
  );
  assert.deepEqual([cover.readUInt16BE(frame + 7), cover.readUInt16BE(frame + 5)], [800, 534]);
});

test('README: one per language, same structure, linking to each other', () => {
  const files = { en: 'README.md', fr: 'README.fr.md' };
  const headings = (text) => text.split('\n').filter((line) => /^#{1,3} /.test(line)).length;
  const english = read(`../${files.en}`);
  for (const file of Object.values(files)) {
    const path = new URL(`../${file}`, import.meta.url);
    assert.ok(existsSync(path), `${file} is missing`);
    const text = readFileSync(path, 'utf8');
    for (const other of Object.values(files).filter((name) => name !== file)) {
      assert.ok(text.includes(`](${other})`), `${file} does not link to ${other}`);
    }
    assert.equal(headings(text), headings(english), `${file} headings`);
    for (const [, target] of text.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
      assert.ok(
        existsSync(new URL(`../${target.split('#')[0]}`, import.meta.url)),
        `${file}: ${target}`,
      );
    }
  }
});
