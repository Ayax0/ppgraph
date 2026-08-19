// The MCP server, driven the way a host drives it: a child process and a pipe.
//
// Nothing here is mocked, because the two things most likely to break are exactly the two a mock
// would hide — that a notification gets no answer, and that stdout carries JSON-RPC and nothing
// else. A single stray line desyncs a host, and it would not show up in any unit test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'dist', 'cli.js');

const { buildGraph } = await import('../dist/graph/build.js');
const { materialize } = await import('../dist/graph/materialize.js');
const { translator } = await import('../dist/i18n/index.js');

/** One report on disk, in its own throwaway home. */
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ppgraph-mcp-'));
  const dir = path.join(home, 'contoso', 'env-1', 'graph');
  fs.mkdirSync(dir, { recursive: true });
  const raw = buildGraph({
    tenant: 'contoso',
    environment: { name: 'DEV', environmentId: 'env-1' },
    flows: [{
      key: 'Flow A',
      name: 'Flow A',
      workflowId: 'wf-a',
      flowId: null,
      state: 'enabled',
      managed: false,
      solution: { uniqueName: 'Ops', name: 'Ops' },
      source: 'Dataverse',
      trigger: {
        name: 'When an item is created',
        kind: 'sharepoint',
        connector: 'sharepointonline',
        label: 'item created',
        on: 'create',
        conditions: [],
        recurrence: null,
        splitOn: false,
        site: 'https://contoso.sharepoint.com/sites/ops',
        list: 'Orders',
      },
      operations: [],
      childFlows: [],
      connectors: [],
      connectionReferences: [],
      parsed: true,
    }],
    apps: [],
    listNames: new Map(),
    knownSites: [],
    sources: [{ name: 'Dataverse', ok: true }],
    warnings: [],
  });
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(materialize(raw, translator('en'))));
  return { home, dir };
}

/** Send these messages, collect what comes back on each stream, then let the process end. */
function talk(messages, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, 'mcp', ...args],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PPGRAPH_NO_BROWSER: '1' } });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve({ stdout, stderr }));
    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

const lines = (stdout) => stdout.split('\n').filter((line) => line.trim() !== '');
const parsed = (stdout) => lines(stdout).map((line) => JSON.parse(line));
const payload = (response) => JSON.parse(response.result.content[0].text);

const { home, dir } = fixture();
const rooted = ['--reports', path.join(home, '{tenant}', '{environment}', 'graph')];
/** A path the server must refuse to write to, since it lies outside the configured template. */
const OUTSIDE = path.join(os.tmpdir(), 'ppgraph-elsewhere');

test.after(() => { fs.rmSync(home, { recursive: true, force: true }); });

test('the handshake dialect: initialize answers, the notification does not', async () => {
  const { stdout } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'ping' },
  ], rooted);

  const messages = parsed(stdout);
  assert.equal(messages.length, 2, 'a notification gets no response');
  assert.equal(messages[0].result.protocolVersion, '2025-11-25');
  assert.equal(messages[0].result.serverInfo.name, 'ppgraph');
  assert.ok(messages[0].result.capabilities.tools, 'tools are declared');
  assert.ok(messages[0].result.instructions.length > 0);
  // ping carries no payload of its own — but it is still a result, so it states its type.
  assert.equal(messages[1].result.resultType, 'complete');
});

test('an unknown protocol version still gets a working session, not a refusal', async () => {
  const { stdout } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
  ], rooted);
  const [message] = parsed(stdout);
  assert.equal(message.error, undefined, 'an old client must not be sent away');
  assert.equal(message.result.protocolVersion, '2025-11-25');
});

test('the stateless dialect: server/discover lists the versions and the capabilities', async () => {
  const { stdout } = await talk([{
    jsonrpc: '2.0',
    id: 'd1',
    method: 'server/discover',
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
  }], rooted);
  const [message] = parsed(stdout);
  assert.equal(message.result.resultType, 'complete');
  assert.ok(message.result.supportedVersions.includes('2026-07-28'));
  assert.equal(message.result._meta['io.modelcontextprotocol/serverInfo'].name, 'ppgraph');
});

test('server/discover refuses a version it does not know, and says which it has', async () => {
  const { stdout } = await talk([{
    jsonrpc: '2.0',
    id: 'd2',
    method: 'server/discover',
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } },
  }], rooted);
  const [message] = parsed(stdout);
  assert.equal(message.error.code, -32022);
  assert.equal(message.error.data.requested, '1900-01-01');
  assert.ok(Array.isArray(message.error.data.supported));
});

test('tools/list is stable and every tool is described', async () => {
  const first = await talk([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }], rooted);
  const second = await talk([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }], rooted);
  assert.equal(first.stdout, second.stdout, 'two runs list the tools in the same order');

  const tools = parsed(first.stdout)[0].result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    'graph_reports', 'graph_overview', 'graph_find', 'graph_node',
    'graph_impact', 'graph_findings', 'graph_build', 'graph_open',
  ]);
  for (const tool of tools) {
    assert.ok(tool.description.length > 40, `${tool.name} explains itself`);
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} rejects stray arguments`);
  }
});

test('the reading tools answer out of the report on disk', async () => {
  const { stdout } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph_reports', arguments: {} } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_overview', arguments: {} } },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_find', arguments: { query: 'Orders' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'graph_impact', arguments: { query: 'Orders' } } },
  ], rooted);

  const [reports, overview, find, impact] = parsed(stdout).map(payload);
  assert.equal(reports.reports.length, 1);
  assert.equal(reports.reports[0].tenant, 'contoso');
  assert.equal(overview.counts.flow, 1);
  assert.equal(find.matches[0].label, 'Orders');
  assert.equal(impact.steps[0].flow, 'Flow A');
  // Every answer says which report it came from and how old it is.
  for (const answer of [overview, find, impact]) {
    assert.equal(answer.report.tenant, 'contoso');
    assert.equal(typeof answer.report.ageDays, 'number');
  }
});

test('a tool that cannot answer returns a readable result, not a protocol error', async () => {
  const { stdout } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph_node', arguments: { query: 'nothing here' } } },
  ], rooted);
  const [message] = parsed(stdout);
  assert.equal(message.error, undefined, 'the model has to be able to read the reason');
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /Nothing is called/);
});

test('an unknown tool and an unknown method are told apart', async () => {
  const { stdout } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph_nope', arguments: {} } },
    { jsonrpc: '2.0', id: 2, method: 'no/such/method' },
  ], rooted);
  const [tool, method] = parsed(stdout);
  assert.equal(tool.error.code, -32602);
  assert.equal(method.error.code, -32601);
});

test('a broken line is a parse error, and the session survives it', async () => {
  const child = spawn(process.execPath, [entry, 'mcp', ...rooted],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PPGRAPH_NO_BROWSER: '1' } });
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stdin.write('this is not json\n');
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping' })}\n`);
  child.stdin.end();
  await new Promise((resolve) => child.on('close', resolve));

  const messages = parsed(stdout);
  assert.equal(messages[0].error.code, -32700);
  assert.equal(messages[1].id, 7, 'the next message is still answered');
});

test('stdout carries JSON-RPC and nothing else, even while a tool logs', async () => {
  const { stdout, stderr } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'graph_overview', arguments: {} } },
    // A build that is refused before it signs in — it must not reach a tenant, and everything
    // it says on the way has to go to stderr.
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graph_build', arguments: { tenant: 't', out: OUTSIDE } } },
  ], rooted);

  for (const line of lines(stdout)) {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0', `not a JSON-RPC message: ${line.slice(0, 80)}`);
  }
  assert.equal(parsed(stdout).length, 3);
  assert.ok(!stderr.includes('"jsonrpc"'), 'and the log channel does not carry protocol traffic');
});

test('a target outside the configured locations is refused before anything signs in', async () => {
  const { stdout, stderr } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph_build', arguments: { tenant: 't', out: OUTSIDE } } },
  ], rooted);
  const [message] = parsed(stdout);
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /outside the configured report locations/);
  assert.ok(!fs.existsSync(path.join(OUTSIDE, 'graph.json')), 'and nothing was written there');
  // The order matters as much as the refusal: a sign-in would have logged its way to stderr first.
  assert.ok(!/Signed in|sign-in|browser/i.test(stderr), 'no sign-in was attempted');
});

test('a report can be addressed by path as well as by name', async () => {
  const { stdout } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'graph_overview', arguments: { report: dir } } },
  ], rooted);
  assert.equal(payload(parsed(stdout)[0]).report.tenant, 'contoso');
});

test('no failure path writes to stdout — the only channel the protocol owns', async () => {
  // reportFatal is the last place that could still print past the protocol; it used to send the
  // cancellation line to stdout, which a terminal forgives and a host does not.
  const { reportFatal } = await import('../dist/cli.js');
  const written = [];
  const real = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => { written.push(String(chunk)); return real(chunk, ...rest); };
  try {
    const cancelled = new Error('cancelled');
    cancelled.name = 'ExitPromptError';
    assert.equal(reportFatal(cancelled), 130);
    assert.equal(reportFatal(new Error('anything else')), 1);
  } finally {
    process.stdout.write = real;
  }
  assert.deepEqual(written, [], 'both branches stayed off stdout');
});

// The rule this suite missed, and a real host did not: in revision 2026-07-28 EVERY result response
// carries `resultType`. Our own client was lenient, the host was not — it retried tools/list three
// times and then dropped the server. Encoded here so the next revision cannot slip past the same way.
test('every result carries resultType and the server identity', async () => {
  const { stdout } = await talk([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2026-07-28' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'ping' },
    { jsonrpc: '2.0', id: 4, method: 'server/discover', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'graph_overview', arguments: {} } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'graph_node', arguments: { query: 'nothing here' } } },
  ], rooted);

  const messages = parsed(stdout);
  assert.equal(messages.length, 6);
  for (const message of messages) {
    assert.equal(message.result.resultType, 'complete', `id ${message.id} states its result type`);
    assert.equal(message.result._meta['io.modelcontextprotocol/serverInfo'].name, 'ppgraph');
  }
  // A failed TOOL is still a complete RESULT — the distinction the revision draws.
  assert.equal(messages[5].result.isError, true);
  assert.equal(messages[5].result.resultType, 'complete');

  // Listings must also say how long they may be cached and for whom. The second rule the host
  // enforced and this suite had not: a schema error on ttlMs and cacheScope dropped the server.
  for (const listing of [messages[1].result, messages[3].result]) {
    assert.equal(typeof listing.ttlMs, 'number');
    assert.ok(['public', 'private'].includes(listing.cacheScope));
  }
  // A tool ANSWER is not a listing — it depends on a report on disk and carries no cache promise.
  assert.equal(messages[4].result.ttlMs, undefined);
  assert.equal(messages[4].result.cacheScope, undefined);
});
