// The query layer, against a graph small enough to reason about by hand.
//
// Built with the real `buildGraph` rather than a hand-written fixture: the cascades, the
// `refiredBy` filtering and the self-trigger detection are exactly what these queries select from,
// and a fixture that faked them would only prove the fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { buildGraph } = await import('../dist/graph/build.js');
const { materialize } = await import('../dist/graph/materialize.js');
const { translator } = await import('../dist/i18n/index.js');
const q = await import('../dist/query/index.js');

const SITE = 'https://contoso.sharepoint.com/sites/ops';

const flow = (name, trigger, operations, extra = {}) => ({
  key: name,
  name,
  workflowId: `wf-${name}`,
  flowId: null,
  state: 'enabled',
  managed: false,
  solution: { uniqueName: 'Ops', name: 'Ops' },
  source: 'Dataverse',
  trigger,
  operations,
  childFlows: [],
  connectors: ['sharepointonline'],
  connectionReferences: [],
  parsed: true,
  ...extra,
});

const spTrigger = (list, on, conditions = []) => ({
  name: 'When an item is created',
  kind: 'sharepoint',
  connector: 'sharepointonline',
  label: `item ${on}`,
  on,
  conditions,
  recurrence: null,
  splitOn: false,
  site: SITE,
  list,
});

const write = (verb, list, action) => ({ action, connector: 'sharepointonline', verb, site: SITE, list });

function sample() {
  const raw = buildGraph({
    tenant: 'contoso',
    environment: { name: 'DEV', environmentId: 'env-1' },
    flows: [
      flow('Flow A', spTrigger('Orders', 'create', ["Status == 'new'"]), [write('creates', 'Log', 'Create log entry')]),
      flow('Flow B', spTrigger('Log', 'create'), [write('updates', 'Orders', 'Update order')]),
      flow('Flow C', spTrigger('Orders', 'createOrUpdate'), [write('updates', 'Orders', 'Touch order')]),
      flow('Flow D', spTrigger('Orders', 'delete'), [], { state: 'disabled' }),
    ],
    apps: [{
      id: 'app-1',
      name: 'Order App',
      solution: { uniqueName: 'Ops', name: 'Ops' },
      source: 'Dataverse',
      studioUrl: null,
      lists: [{ site: SITE, name: 'Orders', listId: null }],
      tables: [],
      flows: ['Flow A'],
      connectors: [],
    }],
    listNames: new Map(),
    knownSites: [{ name: 'Ops', url: SITE, lists: [] }],
    sources: [{ name: 'Dataverse', ok: true }],
    warnings: [],
  });
  return materialize(raw, translator('en'));
}

const graph = sample();
const orders = graph.nodes.find((node) => node.type === 'list' && node.label === 'Orders');

test('the sample really is a graph, so the rest of this file means something', () => {
  assert.ok(orders, 'Orders is a node');
  assert.equal(graph.nodes.filter((node) => node.type === 'flow').length, 4);
  assert.ok(graph.cascades[orders.id], 'Orders has a cascade');
});

test('find turns a name into a node, exact matches first', () => {
  const exact = q.findNodes(graph, { query: 'orders' });
  assert.equal(exact.matches[0].label, 'Orders');
  assert.equal(exact.matches[0].type, 'list');

  // "Order" also matches the app; the exact hit still comes first.
  const partial = q.findNodes(graph, { query: 'order' });
  assert.equal(partial.matches[0].label, 'Orders');
  assert.ok(partial.matches.some((match) => match.type === 'app'));
});

test('find filters on machine values, not on prose', () => {
  const flows = q.findNodes(graph, { type: 'flow' });
  assert.equal(flows.matches.length, 4);
  assert.ok(flows.matches.every((match) => match.type === 'flow'));
  const scoped = q.findNodes(graph, { query: 'Flow', solution: 'Ops' });
  assert.equal(scoped.matches.length, 4);
});

test('find says what it left out instead of trimming silently', () => {
  const result = q.findNodes(graph, { type: 'flow', limit: 2 });
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.truncated, { shown: 2, of: 4, narrow: 'query, type or solution' });
});

test('impact names the flows a write starts, with their conditions', () => {
  const result = q.impact(graph, { id: orders.id, depth: 2 });
  const names = result.steps.map((step) => step.flow).sort();
  assert.deepEqual(names, ['Flow A', 'Flow C', 'Flow D']);
  const a = result.steps.find((step) => step.flow === 'Flow A');
  assert.deepEqual(a.conditions, ["Status == 'new'"]);
  const c = result.steps.find((step) => step.flow === 'Flow C');
  assert.equal(c.unconditional, true, 'a trigger with no condition says so');
});

test('the verb filter keeps only the triggers that listen for that write', () => {
  const created = q.impact(graph, { id: orders.id, verb: 'create' }).steps.map((step) => step.flow);
  assert.ok(created.includes('Flow A'), 'A triggers on create');
  assert.ok(!created.includes('Flow D'), 'D triggers on delete only');

  const updated = q.impact(graph, { id: orders.id, verb: 'update' }).steps.map((step) => step.flow);
  assert.deepEqual(updated, ['Flow C'], 'only the createOrUpdate trigger survives an update');

  const deleted = q.impact(graph, { id: orders.id, verb: 'delete' }).steps.map((step) => step.flow);
  assert.deepEqual(deleted, ['Flow D']);
});

test('impact follows the chain to the depth asked for, and marks where it stopped', () => {
  const deep = q.impact(graph, { id: orders.id, depth: 2 });
  const a = deep.steps.find((step) => step.flow === 'Flow A');
  assert.equal(a.writes[0].to, 'Log');
  assert.ok(Array.isArray(a.writes[0].next), 'depth 2 renders what Log sets off');
  assert.equal(a.writes[0].next[0].flow, 'Flow B');

  const shallow = q.impact(graph, { id: orders.id, depth: 1 });
  const shallowA = shallow.steps.find((step) => step.flow === 'Flow A');
  assert.equal(shallowA.writes[0].next, undefined, 'depth 1 does not follow');
  assert.equal(shallowA.writes[0].more, 1, 'but says how much it did not follow');
});

test('a source nothing triggers on says so rather than returning an empty list', () => {
  const log = graph.nodes.find((node) => node.label === 'Log');
  const quiet = graph.nodes.find((node) => node.type === 'site');
  assert.ok(q.impact(graph, { id: log.id }).steps.length > 0, 'Log does trigger something');
  assert.equal(q.impact(graph, { id: quiet.id }).triggersNothing, true);
});

test('node returns the thing and what hangs off it, both directions', () => {
  const result = q.describeNode(graph, { id: orders.id });
  assert.equal(result.node.label, 'Orders');
  const kinds = result.outgoing.map((edge) => edge.kind);
  assert.ok(kinds.includes('triggers'), 'a list triggers flows');
  assert.ok(result.incoming.some((edge) => edge.kind === 'updates'), 'and is written to');
  const trigger = result.outgoing.find((edge) => edge.kind === 'triggers');
  assert.ok(Array.isArray(trigger.refiredBy), 'trigger edges carry the verbs that re-fire them');
});

test('node without edges is the node alone', () => {
  const result = q.describeNode(graph, { id: orders.id, edges: false });
  assert.equal(result.incoming, undefined);
  assert.equal(result.outgoing, undefined);
});

test('an ambiguous name is an error that lists the candidates, never a guess', () => {
  assert.throws(() => q.resolveNode(graph, { query: 'Flow' }), /matches 4 nodes/);
  assert.throws(() => q.resolveNode(graph, { query: 'nothing here' }), /Nothing is called/);
  assert.throws(() => q.resolveNode(graph, { id: 'list:nope' }), /No node has the id/);
});

test('findings separate the guarded self-trigger from the one that repeats forever', () => {
  const all = q.findings(graph, {});
  assert.ok(all.selfTriggers.length >= 1);
  const unguarded = q.findings(graph, { kind: 'unguarded' });
  assert.equal(unguarded.unguarded.length, 1, 'Flow C writes the list it triggers on, unconditionally');
  assert.equal(unguarded.unguarded[0].flow, 'Flow C');
  assert.equal(unguarded.unguarded[0].repeatsIndefinitely, true);
  assert.equal(unguarded.selfTriggers, undefined, 'one kind means one kind');
});

test('findings list the disabled flows', () => {
  const disabled = q.findings(graph, { kind: 'disabled' });
  assert.deepEqual(disabled.disabled.map((entry) => entry.label), ['Flow D']);
  assert.equal(disabled.disabled[0].state, 'disabled');
});

test('overview counts what the index counts, with null for the leftovers group', () => {
  const result = q.overview(graph);
  assert.equal(result.counts.flow, 4);
  assert.equal(result.counts.list, 2);
  assert.equal(result.findings.disabledFlows, 1);
  assert.equal(result.findings.unguarded, 1);
  const ops = result.solutions.find((entry) => entry.solution === 'Ops');
  assert.equal(ops.flows, 4);
  assert.equal(ops.apps, 1);
});

test('fit shrinks an answer until it fits, and the answer stays valid JSON', () => {
  const big = q.fit((limit) => q.findNodes(graph, { limit }), 20, 300);
  const parsed = JSON.parse(JSON.stringify(big));
  assert.ok(JSON.stringify(parsed).length <= 300 || parsed.matches.length === 1);
  assert.ok(parsed.truncated, 'and it says it was cut');
});

// ---------------------------------------------------------------- locations

test('the template fills in, and refuses to become a path traversal', () => {
  // Separators are left exactly as written — the template is the operator's, not ours to normalise.
  assert.equal(
    q.fillTemplate('src/{label}/{environment}/graph', { label: 'acme', environment: 'env-1' }),
    'src/acme/env-1/graph',
  );
  assert.equal(q.fillTemplate('{label}', { label: '../../etc' }), 'etc');
  assert.equal(q.fillTemplate('{tenant}', {}), 'unknown');
});

test('the fixed prefix of a template is what can actually be scanned', () => {
  assert.equal(q.fixedPrefix('src/{label}/{environment}/graph'), 'src');
  assert.equal(q.fixedPrefix(path.join('a', 'b', 'c')), path.join('a', 'b'));
});

test('an explicit target outside the roots is refused, unless it is allowed', () => {
  const locations = q.locationsFrom({ reports: path.join('reports', '{tenant}') });
  assert.throws(
    () => q.resolveOutDir(locations, { tenant: 't' }, path.join(os.tmpdir(), 'somewhere-else')),
    /outside the configured report locations/,
  );
  const open = q.locationsFrom({ reports: path.join('reports', '{tenant}'), allowAnyOut: true });
  assert.ok(q.resolveOutDir(open, { tenant: 't' }, path.join(os.tmpdir(), 'somewhere-else')));
});

test('reports are found where they were written, and loaded once', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ppgraph-reports-'));
  const dir = path.join(home, 'contoso', 'env-1', 'graph');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(graph));

  const locations = q.locationsFrom({ reports: path.join(home, '{tenant}', '{environment}', 'graph') });
  const listed = q.listReports(locations);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].tenant, 'contoso');
  assert.equal(listed[0].counts.flows, 4);
  assert.ok(!listed[0].dir.includes('\\'), 'paths are reported with forward slashes');

  const resolved = q.resolveReport(locations, 'contoso');
  assert.equal(resolved.graph.tenant, 'contoso');
  assert.equal(q.resolveReport(locations, dir).graph.tenant, 'contoso', 'a path works as a hint too');
  fs.rmSync(home, { recursive: true, force: true });
  q.forgetLoaded();
});

test('a hint that ends on a whole path segment beats one that is merely contained', () => {
  // "…/graph" is a substring of "…/graph-sales" too: a plain contains-match makes the obvious
  // hint ambiguous and refuses to answer.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ppgraph-hint-'));
  for (const name of ['graph', 'graph-sales']) {
    const dir = path.join(home, 'acme', 'env-1', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify({ ...graph, tenant: name }));
  }
  const locations = q.locationsFrom({ reports: path.join(home, '{tenant}', '{environment}', 'graph') });
  assert.equal(q.resolveReport(locations, 'env-1/graph').graph.tenant, 'graph');
  assert.equal(q.resolveReport(locations, 'graph-sales').graph.tenant, 'graph-sales');
  // A hint that ends on no segment at all still falls back to the substring set, and stays honest.
  assert.throws(() => q.resolveReport(locations, 'env-1'), /matches 2 reports/);
  fs.rmSync(home, { recursive: true, force: true });
  q.forgetLoaded();
});

test('with several reports and no hint, it refuses instead of picking one', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ppgraph-many-'));
  for (const name of ['one', 'two']) {
    const dir = path.join(home, name, 'graph');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify({ ...graph, tenant: name }));
  }
  const locations = q.locationsFrom({ reports: path.join(home, '{tenant}', 'graph') });
  assert.throws(() => q.resolveReport(locations), /Several reports are available/);
  assert.equal(q.resolveReport(locations, 'two').graph.tenant, 'two');
  fs.rmSync(home, { recursive: true, force: true });
  q.forgetLoaded();
});
