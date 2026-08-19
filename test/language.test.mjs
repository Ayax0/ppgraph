// The language split, tested where it is decided rather than where it shows.
//
// One collected environment becomes an English graph.json and a German graph.html. That only works
// if nothing upstream of `materialize` ever picks a language — so these tests build a small graph
// by hand, word it twice, and assert that the two copies differ in prose and in NOTHING else.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGraph } from '../dist/graph/build.js';
import { materialize, stateLabel } from '../dist/graph/materialize.js';
import { renderMarkdown } from '../dist/render/markdown.js';
import { msg, say, translator } from '../dist/i18n/index.js';

const de = translator('de');
const en = translator('en');

/** One flow, triggered by one list, writing back to it — enough to exercise every prose field. */
function sample() {
  const trigger = {
    name: 'When_an_item_is_created_or_modified',
    kind: 'sharepoint',
    connector: 'shared_sharepointonline',
    label: msg('trgItemCreatedOrModified'),
    on: 'createOrUpdate',
    conditions: [],
    recurrence: null,
    splitOn: false,
    site: 'https://example.sharepoint.com/sites/demo',
    list: 'Requests',
  };
  return buildGraph({
    tenant: 'demo',
    environment: { environmentId: 'env', name: 'DEV' },
    flows: [{
      key: 'a', name: 'Handle request', workflowId: 'w1', flowId: null, state: 'enabled',
      managed: false, solution: { uniqueName: 'Demo', name: 'Demo' }, source: 'Dataverse',
      trigger,
      operations: [{
        action: 'Update item', connector: 'shared_sharepointonline', verb: 'updates',
        site: 'https://example.sharepoint.com/sites/demo', list: 'Requests',
      }],
      childFlows: [], connectors: ['shared_sharepointonline'], connectionReferences: [], parsed: true,
    }],
    apps: [],
    listNames: new Map(),
    knownSites: [],
    sources: [{ name: msg('srcDataverse'), ok: true, detail: msg('srcFound', { count: 1 }) }],
    warnings: [msg('warnNoDataverse')],
  });
}

test('the builder leaves every sentence unworded', () => {
  const raw = sample();
  assert.equal(typeof raw.warnings[0], 'object', 'a warning is still a phrase');
  assert.equal(typeof raw.sources[0].name, 'object');
  const trigger = raw.nodes.find((node) => node.type === 'flow').trigger;
  assert.equal(typeof trigger.label, 'object', 'the trigger wording is still a phrase');
  assert.equal(raw.locale, undefined, 'and no language has been chosen');
});

test('wording it twice changes the prose and nothing else', () => {
  const raw = sample();
  const english = materialize(raw, en);
  const german = materialize(raw, de);

  assert.equal(english.locale, 'en');
  assert.equal(german.locale, 'de');
  assert.notEqual(english.warnings[0], german.warnings[0], 'the warning is worded per language');
  assert.match(english.sources[0].detail, /found/);
  assert.match(german.sources[0].detail, /gefunden/);

  // Everything a query filters on is identical in both copies.
  const machine = (graph) => JSON.stringify({
    nodes: graph.nodes.map((n) => [n.id, n.type, n.state, n.solutions, n.trigger?.on, n.trigger?.kind]),
    edges: graph.edges.map((e) => [e.from, e.to, e.kind, e.on, e.refiredBy, e.conditions]),
    selfTriggers: graph.selfTriggers,
    schemaVersion: graph.schemaVersion,
  });
  assert.equal(machine(english), machine(german), 'ids, kinds, states and conditions do not move');
});

test('a state stays a machine value and is worded on the way out', () => {
  const graph = materialize(sample(), de);
  const flow = graph.nodes.find((node) => node.type === 'flow');
  assert.equal(flow.state, 'enabled', 'the value a query filters on survives translation');
  assert.equal(stateLabel('enabled', de), 'Aktiviert');
  assert.equal(stateLabel('enabled', en), 'Enabled');
  assert.equal(stateLabel(null, de), null);
  // An unfamiliar state keeps what the platform called it rather than being hidden.
  assert.equal(stateLabel('paused', en), 'paused');
});

test('a node no solution owns carries an empty list, never a caption', () => {
  const raw = buildGraph({
    tenant: 'demo',
    environment: { environmentId: 'env' },
    flows: [{
      key: 'a', name: 'Loose flow', workflowId: 'w1', flowId: null, state: 'disabled', managed: false,
      solution: null, source: 'Dataverse', trigger: null, operations: [], childFlows: [],
      connectors: [], connectionReferences: [], parsed: true,
    }],
    apps: [], listNames: new Map(), knownSites: [], sources: [], warnings: [],
  });
  const flow = raw.nodes.find((node) => node.type === 'flow');
  assert.deepEqual(flow.solutions, [], 'the grouping key is a key, not a translated caption');
});

test('a plain string is a phrase too — service errors pass through untouched', () => {
  const error = 'AADSTS50076: MFA required';
  assert.equal(say(error, de), error);
  assert.equal(say(error, en), error);
});

test('the markdown quotes sizes it measured, not sizes it remembers', () => {
  const graph = materialize(sample(), en);
  const rendered = renderMarkdown(graph, { command: 'ppgraph --demo', t: en, jsonBytes: 40000 });
  assert.match(rendered.index, /≈10k tokens/, 'the json size comes from the bytes handed in');
  assert.doesNotMatch(rendered.index, /288k|median 71|median 112/, 'no number from another environment');
  // The stamp in a machine file is unambiguous in every language.
  assert.match(rendered.index, /Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2}\./);
});
