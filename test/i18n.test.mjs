// Guards the two things about i18n that break silently:
//
//   1. a catalogue drifting out of step with the reference one — a missing key still compiles when
//      it is reached through a computed MessageKey, and a changed placeholder never fails to compile
//   2. the viewer's COPY of `format` drifting from the real one. The viewer is inlined as a classic
//      script and cannot import, so the duplication is unavoidable; what is avoidable is not
//      noticing when the two stop agreeing.
//
// Runs against dist/, so `pnpm test` builds first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LOCALE, LOCALES, format, isPlural, localeName, messagesFor } from '../dist/index.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REFERENCE = 'de';

const placeholders = (value) => new Set([...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]));

// What the interactive picker offers. A language that cannot name itself would show up as a bare
// code in the prompt, and a default outside the registry would make `--locale` unreachable.
test('every locale names itself and the default is one of them', () => {
  assert.ok(LOCALES.includes(DEFAULT_LOCALE), `${DEFAULT_LOCALE} is not a registered locale`);
  for (const locale of LOCALES) {
    const name = localeName(locale);
    assert.notEqual(name, locale, `${locale} has no display name`);
    assert.equal(name, name.charAt(0).toUpperCase() + name.slice(1), `${locale}: not capitalised`);
  }
  assert.equal(localeName('de'), 'Deutsch');
  assert.equal(localeName('en'), 'English');
});

test('every locale carries every key of the reference catalogue', () => {
  const reference = Object.keys(messagesFor(REFERENCE));
  for (const locale of LOCALES) {
    const keys = Object.keys(messagesFor(locale));
    assert.deepEqual(reference.filter((key) => !keys.includes(key)), [], `${locale} is missing keys`);
    assert.deepEqual(keys.filter((key) => !reference.includes(key)), [], `${locale} has keys ${REFERENCE} does not`);
  }
});

test('a translation keeps the placeholders and the plural shape of the reference', () => {
  const reference = messagesFor(REFERENCE);
  for (const locale of LOCALES.filter((entry) => entry !== REFERENCE)) {
    const messages = messagesFor(locale);
    for (const [key, value] of Object.entries(reference)) {
      const translated = messages[key];
      assert.deepEqual(
        [...placeholders(translated)].sort(), [...placeholders(value)].sort(),
        `${locale}.${key} does not use the same placeholders as ${REFERENCE}.${key}`,
      );
      assert.equal(isPlural(translated), isPlural(value), `${locale}.${key} disagrees on having a plural form`);
      if (isPlural(translated)) {
        assert.equal(translated.split('|').length, 2, `${locale}.${key} needs exactly one | (singular|plural)`);
      }
    }
  }
});

// The Markdown table headers are full of pipes. They must survive the translator untouched — this
// is the regression guard for treating `|` alone as a plural separator.
test('a pipe without {count} is table syntax, not a plural', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(messagesFor(locale))) {
      if (!value.includes('|') || isPlural(value)) continue;
      assert.equal(format(value, { count: 3 }, locale), value, `${locale}.${key} was cut at a pipe`);
    }
  }
  assert.equal(format('| A | B |', { count: 1 }, 'de'), '| A | B |');
});

/**
 * Lifts the viewer's `format` out of the COMPILED viewer — types are erased there, so the extracted
 * text is plain JS. `i18n` is the only free name it closes over, which is what makes it liftable.
 */
function viewerFormat() {
  const source = fs.readFileSync(path.join(ROOT, 'dist/viewer/viewer.js'), 'utf8');
  const start = source.indexOf('const t = (key, params = {}) => {');
  assert.notEqual(start, -1, 'the viewer no longer declares `const t = (key, params = {}) => {` — update this test');
  const end = source.indexOf('\n    };', start);
  assert.notEqual(end, -1, 'could not find the end of the viewer translator');

  const body = source.slice(start + 'const t = '.length, end + '\n    }'.length);
  const make = new Function('i18n', `return ${body};`);
  return (locale, messages) => make({ locale, messages });
}

test('the viewer translator agrees with the exported one', () => {
  const build = viewerFormat();
  const cases = [
    ['countLists', { count: 0 }], ['countLists', { count: 1 }], ['countLists', { count: 2 }],
    ['uiEntries', { count: 1 }], ['uiEntries', { count: 11 }],
    ['uiWritesBack', { count: 1 }], ['uiFocusWritesBack', { count: 3 }],
    ['uiUnguardedBanner', { count: 1 }], ['uiUnguardedBanner', { count: 7 }],
    ['uiSolutionIs', { solution: 'Field Service' }],
    ['uiConnectors', { connectors: 'sharepointonline, office365' }],
    ['uiSameInstanceIn', { count: 1 }], ['uiSameInstanceIn', { count: 4 }],
    ['uiGroupShared', { count: 2 }],
    // count missing on a plural value → plural; unknown placeholder stays literal
    ['countFlows', {}], ['uiSolutionIs', {}],
  ];

  for (const locale of LOCALES) {
    const messages = messagesFor(locale);
    const t = build(locale, messages);
    for (const [key, params] of cases) {
      assert.equal(t(key, params), format(messages[key], params, locale), `${locale}.${key} ${JSON.stringify(params)}`);
    }
    // An unknown key must not throw on either side — the viewer sees whatever the file carries.
    assert.equal(t('nope', {}), 'nope');
  }
});

test('the generated page carries the catalogue it was rendered with', async () => {
  const { renderHtml, translator } = await import('../dist/index.js');
  const graph = {
    schemaVersion: 1,
    generatedAt: '2026-08-13T09:00:00.000Z',
    tenant: 'contoso',
    environment: { name: 'PROD', environmentId: 'Default-0000', dataverseUrl: null },
    sources: [], nodes: [], edges: [], warnings: [], selfTriggers: [], cascades: {}, sharedSources: [],
  };

  for (const locale of LOCALES) {
    const html = renderHtml(graph, translator(locale));
    assert.match(html, new RegExp(`<html lang="${locale}"`), `${locale}: wrong lang attribute`);
    const embedded = /<script id="graph-i18n" type="application\/json">(.*?)<\/script>/s.exec(html);
    assert.ok(embedded, `${locale}: no embedded catalogue`);
    const parsed = JSON.parse(embedded[1]);
    assert.equal(parsed.locale, locale);
    assert.deepEqual(parsed.messages, messagesFor(locale));
    // Nothing in the page may close a script tag early.
    assert.doesNotMatch(embedded[1], /<\/script/i);
  }
});
