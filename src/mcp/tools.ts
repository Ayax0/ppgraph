// The tools, their schemas, and what each one answers.
//
// Every answer carries the report it came from and how old it is, every list-shaped answer can be
// narrowed, and none of them returns the graph itself.
import fs from 'node:fs';
import path from 'node:path';
import { resolveRun } from '../config/resolve.js';
import { configureAuth } from '../platform/auth.js';
import { buildReport } from '../report.js';
import { openExternal } from '../ui/open.js';
import { COLLECTOR_KEYS, type CollectorKey, type KnownSite, type NodeType } from '../types.js';
import { LOCALES, isLocale } from '../i18n/index.js';
import { parseColor } from '../render/brand.js';
import {
  describeNode, findNodes, findings, fit, impact, listReports, overview, posix, resolveOutDir,
  resolveReport, FINDING_KINDS,
} from '../query/index.js';
import type { LoadedReport, ReportLocations } from '../query/index.js';

export interface ToolContext {
  locations: ReportLocations;
  /** Progress and sign-in notices. Never stdout — that channel belongs to the protocol. */
  log(message: string): void;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> | unknown;
}

/** What every answer opens with: which report, and whether it is still worth believing. */
function envelope(report: LoadedReport): Record<string, unknown> {
  return {
    report: {
      path: posix(report.dir),
      tenant: report.graph.tenant,
      environment: report.graph.environment.name ?? report.graph.environment.environmentId,
      generatedAt: report.graph.generatedAt,
      ageDays: report.ageDays,
      ...(report.graph.scope?.length ? { scope: report.graph.scope } : {}),
    },
  };
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const list = (value: unknown): string[] | undefined =>
  (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined);

const REPORT_ARG = {
  report: {
    type: 'string',
    description: 'Which report to read: a path, or part of a tenant or environment name. '
      + 'Only needed when more than one report is available.',
  },
} as const;

const TARGET_ARGS = {
  id: { type: 'string', description: 'Node id, as returned by graph_find. Exact.' },
  query: { type: 'string', description: 'A name instead of an id. Must match exactly one node.' },
} as const;

export const TOOLS: Tool[] = [
  {
    name: 'graph_reports',
    title: 'List reports',
    description: 'Every environment graph this server can read: tenant, environment, when it was '
      + 'generated and how big it is. Start here when you do not know what is available.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: (_args, ctx) => ({ reports: listReports(ctx.locations) }),
  },
  {
    name: 'graph_overview',
    title: 'Environment overview',
    description: 'What is in this environment: counts per technology, every solution with its flow, '
      + 'app and data-source counts, the state of each collector, and the findings worth knowing '
      + '(unconditional self-triggers, shared sources, unresolved references). A few hundred tokens; '
      + 'read it once before asking anything else about an environment you do not know.',
    inputSchema: { type: 'object', properties: { ...REPORT_ARG }, additionalProperties: false },
    handler: (args, ctx) => {
      const report = resolveReport(ctx.locations, str(args['report']));
      return { ...envelope(report), ...overview(report.graph) };
    },
  },
  {
    name: 'graph_find',
    title: 'Find nodes',
    description: 'Turn a name into a node: SharePoint lists, Dataverse tables, cloud flows, canvas '
      + 'apps and sites, matched on substring. Returns id, type, owning solutions and a one-line '
      + 'summary — the entry point for every other tool, and cheap enough to use freely.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of a name. Omit to list everything of one type.' },
        type: { type: 'string', enum: ['site', 'list', 'table', 'flow', 'app'] },
        solution: { type: 'string', description: 'Keep only nodes this solution owns.' },
        limit: { type: 'integer', minimum: 1, description: 'Default 20.' },
        ...REPORT_ARG,
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const report = resolveReport(ctx.locations, str(args['report']));
      const options = {
        ...(str(args['query']) ? { query: str(args['query'])! } : {}),
        ...(str(args['type']) ? { type: str(args['type']) as NodeType } : {}),
        ...(str(args['solution']) ? { solution: str(args['solution'])! } : {}),
      };
      return {
        ...envelope(report),
        ...fit((limit) => findNodes(report.graph, { ...options, limit }), num(args['limit']) ?? 20),
      };
    },
  },
  {
    name: 'graph_node',
    title: 'One node in full',
    description: 'Everything about one thing and what hangs off it: for a flow its trigger, '
      + 'conditions, connectors and every read and write it performs; for a list who triggers on it '
      + 'and who writes to it; for an app what it binds and calls. Also carries the link into the '
      + 'maker portal. This replaces reading a section of graph-flows.md.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TARGET_ARGS,
        edges: { type: 'boolean', description: 'Set false for the node alone, without neighbours.' },
        limit: { type: 'integer', minimum: 1, description: 'Neighbours per direction, default 60.' },
        ...REPORT_ARG,
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const report = resolveReport(ctx.locations, str(args['report']));
      const target = {
        ...(str(args['id']) ? { id: str(args['id'])! } : {}),
        ...(str(args['query']) ? { query: str(args['query'])! } : {}),
        ...(typeof args['edges'] === 'boolean' ? { edges: args['edges'] } : {}),
      };
      return {
        ...envelope(report),
        ...fit((limit) => describeNode(report.graph, { ...target, limit }), num(args['limit']) ?? 60),
      };
    },
  },
  {
    name: 'graph_impact',
    title: 'What a write sets off',
    description: 'Answers "what happens if I write here". Returns the flows a write to this list or '
      + 'table starts, with their trigger conditions, what each of them writes back, and what that '
      + 'sets off in turn. A trigger with no condition fires on every write — the answer says so. '
      + 'Ask this BEFORE bulk-editing data, renaming or deleting anything.',
    inputSchema: {
      type: 'object',
      properties: {
        ...TARGET_ARGS,
        verb: {
          type: 'string',
          enum: ['create', 'update', 'delete'],
          description: 'Which write to simulate. Keeps only the triggers that listen for it.',
        },
        depth: { type: 'integer', minimum: 0, maximum: 3, description: 'How far to follow, default 2.' },
        limit: { type: 'integer', minimum: 1, description: 'Flows at the first level, default 25.' },
        ...REPORT_ARG,
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const report = resolveReport(ctx.locations, str(args['report']));
      const target = {
        ...(str(args['id']) ? { id: str(args['id'])! } : {}),
        ...(str(args['query']) ? { query: str(args['query'])! } : {}),
        ...(str(args['verb']) ? { verb: str(args['verb']) as 'create' | 'update' | 'delete' } : {}),
        ...(num(args['depth']) !== undefined ? { depth: num(args['depth'])! } : {}),
      };
      return {
        ...envelope(report),
        ...fit((limit) => impact(report.graph, { ...target, limit }), num(args['limit']) ?? 25),
      };
    },
  },
  {
    name: 'graph_findings',
    title: 'What is dangerous or broken',
    description: 'The environment\'s problem list: flows that trigger on a list they write to '
      + 'themselves (with and without a guarding condition), lists whose environment variable points '
      + 'at nothing, flows nothing calls, disabled flows, and sources shared across solutions.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...FINDING_KINDS], description: 'One kind instead of all.' },
        solution: { type: 'string' },
        limit: { type: 'integer', minimum: 1, description: 'Per kind, default 40.' },
        ...REPORT_ARG,
      },
      additionalProperties: false,
    },
    handler: (args, ctx) => {
      const report = resolveReport(ctx.locations, str(args['report']));
      const options = {
        ...(str(args['kind']) ? { kind: str(args['kind']) as typeof FINDING_KINDS[number] } : {}),
        ...(str(args['solution']) ? { solution: str(args['solution'])! } : {}),
      };
      return {
        ...envelope(report),
        ...fit((limit) => findings(report.graph, { ...options, limit }), num(args['limit']) ?? 40),
      };
    },
  },
  {
    name: 'graph_build',
    title: 'Build or refresh a report',
    description: 'Reads a Power Platform environment and writes a fresh report. Takes a minute or '
      + 'two on a large environment. Where it lands is configured on this server; pass `out` only to '
      + 'override it. If nobody is signed in for the tenant, a browser window opens.',
    inputSchema: {
      type: 'object',
      properties: {
        tenant: { type: 'string', description: 'Entra tenant id or domain.' },
        environment: { type: 'string', description: 'Environment id or name. Discovered when omitted.' },
        dataverseUrl: { type: 'string' },
        label: { type: 'string', description: 'What the report calls this tenant. Fills {label} in the configured path.' },
        out: { type: 'string', description: 'Override the configured location. Must stay inside it.' },
        solutions: { type: 'array', items: { type: 'string' }, description: 'Narrow the whole report to these solutions.' },
        skip: { type: 'array', items: { type: 'string', enum: [...COLLECTOR_KEYS] } },
        locale: { type: 'string', enum: [...LOCALES], description: 'Language of graph.html only.' },
        siteNames: {
          type: 'array',
          items: { type: 'string' },
          description: 'Friendlier names for sites, each as "<url>=<name>".',
        },
        refreshNames: { type: 'boolean', description: 'Discard the cached SharePoint list names.' },
        account: { type: 'string' },
        sharePointClientId: { type: 'string' },
        noSharePointLogin: { type: 'boolean' },
        brandTitle: { type: 'string' },
        brandLogo: { type: 'string' },
        brandColor: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const skip = new Set((list(args['skip']) ?? []).filter(
        (key): key is CollectorKey => (COLLECTOR_KEYS as readonly string[]).includes(key)));
      const locale = str(args['locale']);
      const brandColor = str(args['brandColor']);

      // Before any sign-in: a target outside the configured locations is a refusal whatever the
      // tenant turns out to be.
      if (str(args['out'])) resolveOutDir(ctx.locations, {}, str(args['out']));

      configureAuth({ log: ctx.log, notice: ctx.log });
      const run = await resolveRun({
        ...(str(args['tenant']) ? { tenant: str(args['tenant'])! } : {}),
        ...(str(args['environment']) ? { environment: str(args['environment'])! } : {}),
        ...(str(args['dataverseUrl']) ? { dataverseUrl: str(args['dataverseUrl'])! } : {}),
        ...(str(args['account']) ? { account: str(args['account'])! } : {}),
        ...(str(args['sharePointClientId']) ? { sharePointClientId: str(args['sharePointClientId'])! } : {}),
        ...(args['noSharePointLogin'] === true ? { noSharePointLogin: true } : {}),
        ...(str(args['label']) ? { label: str(args['label'])! } : {}),
        ...(locale && isLocale(locale) ? { locale } : {}),
        ...(list(args['siteNames']) ? { siteNames: parseSiteNames(list(args['siteNames'])!) } : {}),
        ...(skip.size > 0 ? { skip } : {}),
        log: ctx.log,
      });

      // Decided here, once tenant and environment are known — what the template placeholders need.
      run.outDir = resolveOutDir(ctx.locations, {
        ...(str(args['label']) ? { label: str(args['label'])! } : {}),
        ...(run.tenantId ? { tenant: run.tenantId } : {}),
        environment: run.environmentId,
      }, str(args['out']));

      const { summary } = await buildReport(run, {
        ...(list(args['solutions']) ? { solutions: list(args['solutions'])! } : {}),
        ...(args['refreshNames'] === true ? { refreshNames: true } : {}),
        ...(str(args['brandTitle']) ? { brandTitle: str(args['brandTitle'])! } : {}),
        ...(str(args['brandLogo']) ? { brandLogo: str(args['brandLogo'])! } : {}),
        ...(brandColor ? { brandColor: parseColor(brandColor) } : {}),
        ...(str(args['tenant']) ? { tenant: str(args['tenant'])! } : {}),
        ...(str(args['label']) ? { label: str(args['label'])! } : {}),
        ...(str(args['sharePointClientId']) ? { sharePointClientId: str(args['sharePointClientId'])! } : {}),
        ...(args['noSharePointLogin'] === true ? { noSharePointLogin: true } : {}),
      }, {
        step: ctx.log,
        result: (ok, label, detail) => ctx.log(`${ok ? '✓' : '!'} ${label}: ${detail}`),
        warn: ctx.log,
      });

      return { ...summary, outDir: posix(summary.outDir) };
    },
  },
  {
    name: 'graph_open',
    title: 'Open the report for a person',
    description: 'Opens graph.html in the browser — the interactive diagram, in the maker\'s '
      + 'language. For handing over to a human; there is nothing in it for you that the other tools '
      + 'do not answer more cheaply.',
    inputSchema: { type: 'object', properties: { ...REPORT_ARG }, additionalProperties: false },
    handler: (args, ctx) => {
      const report = resolveReport(ctx.locations, str(args['report']));
      const file = path.join(report.dir, 'graph.html');
      if (!fs.existsSync(file)) throw new Error(`${file} does not exist — build the report first.`);
      openExternal(file);
      return { ...envelope(report), opened: posix(file) };
    },
  },
];

function parseSiteNames(entries: readonly string[]): KnownSite[] {
  return entries.map((raw) => {
    const at = raw.indexOf('=');
    if (at < 1) throw new Error(`siteNames expects "<url>=<name>", received "${raw}".`);
    return { url: raw.slice(0, at).trim().replace(/\/+$/, ''), name: raw.slice(at + 1).trim(), lists: [] };
  });
}

/**
 * What a host shows the model before it has called anything.
 *
 * The route, plus the four rules that decide whether an answer is read CORRECTLY — each of them
 * something the data supports but does not say out loud. Anything specific to one tool belongs in
 * that tool's description instead, which is only read when it is used.
 */
export const INSTRUCTIONS = 'Answers questions about one Power Platform environment: which '
  + 'SharePoint list triggers which cloud flow, what those flows write back, which canvas app binds '
  + 'what. Turn a name into a node with graph_find, then ask graph_node or graph_impact about it. '
  + 'graph_impact before changing or bulk-editing list data — it names every flow a write sets off. '
  + 'Reading the answers: (1) a report is STRUCTURE, not runtime — it says a flow CAN run, never '
  + 'that it did. (2) A write only continues a cascade where the next trigger listens for that '
  + 'verb: `refiredBy` holds the verbs that can actually start a flow, so a chain ending in "no '
  + 'trigger" may be a write that simply does not match. (3) Every answer carries `generatedAt` and '
  + '`ageDays` — a graph older than the last change to the environment is a wrong answer with a '
  + 'timestamp, and graph_build refreshes it. (4) When `scope` is set the report covers those '
  + 'solutions only, so do not describe it as the environment; and `sources` in graph_overview says '
  + 'whether a collector failed, which makes every answer from it partial.';
