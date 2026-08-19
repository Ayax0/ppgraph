// The MCP server: JSON-RPC 2.0 over stdin/stdout, newline-delimited, nothing else on stdout ever.
//
// Hand-written rather than taken from the official SDK, which pulls in seventeen direct
// dependencies — express, hono, cors, jose, ajv among them — none of which a stdio server needs.
//
// TWO DIALECTS, one tool table: the handshake dialect (2025-11-25 and older) uses `initialize`,
// the stateless one (2026-07-28) uses `server/discover` and no handshake at all. `tools/list` and
// `tools/call` are identical in both, so this server never requires a handshake and answers
// whichever door a client knocks on.
//
// ⚠ Advertising 2026-07-28 means meeting rules the older revisions do not have — `resultType` on
// every result, `ttlMs` and `cacheScope` on every listing — with no reference implementation to
// check against: the official SDK tops out at 2025-11-25 and knows neither. Dropping it from
// PROTOCOL_VERSIONS is the one-line retreat if a further requirement surfaces.
//
// The method surface is complete for what this server DECLARES. A tools-only server sees
// `initialize`, `ping`, `tools/list`, `tools/call` and two notifications; prompts, resources,
// completion and logging only ever reach a server that advertises those capabilities.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locationsFrom } from '../query/index.js';
import { INSTRUCTIONS, TOOLS } from './tools.js';
import type { ToolContext } from './tools.js';

/** Newest first. The first entry is what a client that asks for something unknown gets back. */
const PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'] as const;
const PREFERRED = '2025-11-25';
const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

/**
 * Required on every LISTING under 2026-07-28; a client on that revision rejects a result without
 * them. `public` because the tool table is a constant. Deliberately not on `tools/call`, whose
 * answer depends on a report on disk.
 */
const CACHEABLE = { ttlMs: 300_000, cacheScope: 'public' } as const;

interface Request {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpOptions {
  reports?: string;
  roots?: string[];
  allowAnyOut?: boolean;
}

export function parseMcpArgs(argv: readonly string[]): McpOptions {
  const options: McpOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const value = (): string => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`Missing value for ${argv[i]}.`);
      i += 1;
      return next;
    };
    switch (argv[i]) {
      case '--reports': options.reports = value(); break;
      case '--root': options.roots = [...(options.roots ?? []), value()]; break;
      case '--allow-any-out': options.allowAnyOut = true; break;
      default:
        if (argv[i]?.startsWith('-')) throw new Error(`Unknown option ${argv[i]} for the mcp subcommand.`);
    }
  }
  return options;
}

export async function runMcp(argv: readonly string[]): Promise<void> {
  const options = parseMcpArgs(argv);
  const ctx: ToolContext = {
    locations: locationsFrom(options),
    // stderr is the only channel a stdio server may talk on; hosts surface it as the server's log.
    log: (message: string) => { process.stderr.write(`${message}\n`); },
  };

  const send = (message: Record<string, unknown>): void => {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  };

  await pump(process.stdin, async (line) => {
    let request: Request;
    try {
      request = JSON.parse(line) as Request;
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    const response = await handle(request, ctx);
    // A notification carries no id and gets no answer — writing one is a protocol violation that
    // some clients treat as a fatal desync.
    if (response) send(response);
  });
}

async function handle(request: Request, ctx: ToolContext): Promise<Record<string, unknown> | null> {
  const { id, method } = request;
  const isNotification = id === undefined || id === null;
  // `resultType` and the server identity on EVERY result: 2026-07-28 requires both. Earlier
  // revisions treat an absent `resultType` as `complete` and ignore unknown fields, so sending
  // them unconditionally is correct for every client and needs no branch.
  const reply = (result: Record<string, unknown>): Record<string, unknown> | null =>
    (isNotification ? null : {
      jsonrpc: '2.0',
      id,
      result: { resultType: 'complete', ...result, _meta: { [META_SERVER_INFO]: serverInfo() } },
    });
  const fail = (code: number, message: string, data?: unknown): Record<string, unknown> | null =>
    (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });

  switch (method) {
    case 'initialize': {
      // Never an error: an older client that receives one gives up rather than renegotiating.
      const asked = String(request.params?.['protocolVersion'] ?? '');
      const version = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PREFERRED;
      return reply({
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: serverInfo(),
        instructions: INSTRUCTIONS,
      });
    }

    case 'server/discover': {
      const asked = versionFromMeta(request.params);
      if (asked && !(PROTOCOL_VERSIONS as readonly string[]).includes(asked)) {
        return fail(-32022, 'Unsupported protocol version', {
          supported: [...PROTOCOL_VERSIONS], requested: asked,
        });
      }
      return reply({
        supportedVersions: [...PROTOCOL_VERSIONS],
        capabilities: { tools: {} },
        instructions: INSTRUCTIONS,
        ...CACHEABLE,
      });
    }

    case 'ping':
      return reply({});

    // Notifications the handshake dialect sends and nothing has to answer.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;

    case 'tools/list':
      return reply({
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
        ...CACHEABLE,
      });

    case 'tools/call': {
      const name = String(request.params?.['name'] ?? '');
      const tool = TOOLS.find((entry) => entry.name === name);
      if (!tool) return fail(-32602, `Unknown tool "${name}"`);
      const args = (request.params?.['arguments'] ?? {}) as Record<string, unknown>;
      try {
        const result = await tool.handler(args, ctx);
        return reply(content(JSON.stringify(result), false));
      } catch (error) {
        // A tool that could not answer is a RESULT, not a protocol error — the model has to read
        // the reason, and a JSON-RPC error would not reach it.
        return reply(content(error instanceof Error ? error.message : String(error), true));
      }
    }

    default:
      return isNotification ? null : fail(-32601, `Unknown method "${method ?? ''}"`);
  }
}

const content = (text: string, isError: boolean): Record<string, unknown> => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

function versionFromMeta(params: Record<string, unknown> | undefined): string | null {
  const meta = params?.['_meta'];
  if (!meta || typeof meta !== 'object') return null;
  const value = (meta as Record<string, unknown>)[META_VERSION];
  return typeof value === 'string' ? value : null;
}

let cachedInfo: { name: string; version: string } | null = null;

function serverInfo(): { name: string; version: string } {
  if (cachedInfo) return cachedInfo;
  let version = '0.0.0';
  try {
    // dist/mcp/server.js → the package root.
    const manifest = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    version = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version?: string }).version ?? version;
  } catch { /* a server that cannot read its own manifest still works */ }
  cachedInfo = { name: 'ppgraph', version };
  return cachedInfo;
}

/**
 * Read newline-delimited messages one at a time. Sequential on purpose: two builds at once would
 * fight over the same token store and output directory.
 */
async function pump(input: NodeJS.ReadableStream, onLine: (line: string) => Promise<void>): Promise<void> {
  let buffer = '';
  input.setEncoding('utf8');
  for await (const chunk of input as AsyncIterable<string>) {
    buffer += chunk;
    let at = buffer.indexOf('\n');
    while (at !== -1) {
      const line = buffer.slice(0, at).trim();
      buffer = buffer.slice(at + 1);
      if (line !== '') await onLine(line);
      at = buffer.indexOf('\n');
    }
  }
  const rest = buffer.trim();
  if (rest !== '') await onLine(rest);
}
