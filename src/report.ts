// Producing a report: collect → build → word → render → write.
//
// Two callers — the CLI and the MCP server — must reach the same five files, one of them without a
// terminal. So what a run has to SAY goes through `hooks` and what it has to REPORT comes back as
// a summary; nothing here writes to a stream.
import fs from 'node:fs';
import path from 'node:path';
import { collectEnvironment, resolveSharePointLists } from './platform/collect.js';
import { buildGraph } from './graph/build.js';
import { materialize } from './graph/materialize.js';
import { renderMarkdown } from './render/markdown.js';
import { renderHtml } from './render/html.js';
import { DEFAULT_LOCALE, msg, translator } from './i18n/index.js';
import { LOGO_LIMIT, bandContrast, dataUri, mimeFor, readableOn } from './render/brand.js';
import type { Branding } from './render/brand.js';
import type { Phrase } from './i18n/index.js';
import type { CollectContext, Graph, ListIndex, NodeType, RunConfig } from './types.js';

/**
 * The parts of a caller's options that change the OUTPUT. The last four are needed only by the
 * rebuild command written into every generated file, which must name them or a refresh differs.
 */
export interface ReportOptions {
  solutions?: string[];
  refreshNames?: boolean;
  brandTitle?: string;
  brandLogo?: string;
  brandColor?: string;
  tenant?: string;
  label?: string;
  sharePointClientId?: string;
  noSharePointLogin?: boolean;
}

/** What a run says while it works — three shapes so a caller can style them without parsing. */
export interface ReportHooks {
  /** Progress: interesting while waiting, worthless afterwards. */
  step(message: string): void;
  result(ok: boolean, label: string, detail: string): void;
  /** Something the operator should fix — never report content. */
  warn(message: string): void;
}

export interface ReportSummary {
  tenant: string;
  environment: { environmentId: string; name?: string; dataverseUrl?: string };
  signedInAs?: string;
  generatedAt: string;
  /** The solutions the report was narrowed to, or null for the whole environment. */
  scope: string[] | null;
  outDir: string;
  files: string[];
  counts: Record<NodeType, number>;
  flows: number;
  apps: number;
  triggerEdges: number;
  selfTriggers: number;
  /** Self-triggers with no condition — the finding worth interrupting for. */
  unguarded: number;
  sharePoint?: { reached: number; total: number; via: string };
  /** Each collector with its outcome, already worded in English. */
  sources: { name: string; ok: boolean; detail?: string }[];
  /** The command that reproduces this run, as written into every generated file. */
  command: string;
}

export interface BuiltReport {
  graph: Graph;
  summary: ReportSummary;
}

const FILE_ORDER = ['graph.json', 'graph-index.md', 'graph.md', 'graph-flows.md', 'graph.html'] as const;

export async function buildReport(
  run: RunConfig,
  options: ReportOptions,
  hooks: ReportHooks,
): Promise<BuiltReport> {
  const t = translator(run.locale);

  // 1 — collect
  fs.mkdirSync(run.outDir, { recursive: true });
  const warnings: Phrase[] = [];
  const ctx: CollectContext = {
    tenantId: run.tenantId,
    environmentId: run.environmentId,
    dataverseUrl: run.dataverseUrl,
    cacheFile: path.join(run.outDir, 'list-names.json'),
    refreshNames: options.refreshNames,
    sharePoint: run.sharePoint,
    skip: run.skip,
    // Warnings end up in the REPORT, in two languages, so they are noted rather than worded.
    warn: (message) => { warnings.push(message); },
    log: hooks.step,
  };

  if (!run.dataverseUrl && !run.skip.has('dataverse')) warnings.push(msg('warnNoDataverse'));

  hooks.step('Reading flows, apps and solutions …');
  const collected = await collectEnvironment(ctx);
  hooks.result(true, 'Collected', `${collected.flows.length} flows · ${collected.apps.length} apps`);

  let listNames: ListIndex = new Map();
  let sharePoint: ReportSummary['sharePoint'];
  if (!run.skip.has('sharepoint')) {
    const siteUrls = [
      ...run.knownSites.map((site) => site.url),
      ...collected.flows.flatMap((flow) => [flow.trigger?.site, ...flow.operations.map((op) => op.site)]),
      ...collected.apps.flatMap((app) => app.lists.map((list) => list.site)),
    ];
    if (siteUrls.some(Boolean)) {
      // What is recorded is report content, so it is noted as a phrase; the caller phrases its own
      // line from the returned counts rather than echoing it.
      const record = (name: Phrase, ok: boolean, detail?: Phrase): void => {
        collected.sources.push({ name, ok, detail });
      };
      const resolved = await resolveSharePointLists(ctx, siteUrls, record);
      listNames = resolved.index;
      sharePoint = { reached: resolved.reached, total: resolved.total, via: resolved.via };
      hooks.result(resolved.reached === resolved.total, 'SharePoint list names',
        `${resolved.reached}/${resolved.total} sites read (${resolved.via})`);
    }
  } else {
    collected.sources.push({ name: msg('srcSharePointNames'), ok: true, detail: msg('srcSkipped') });
  }

  // 2 — build
  const raw = buildGraph({
    solutions: options.solutions,
    tenant: run.label,
    environment: {
      name: run.environmentName,
      environmentId: run.environmentId,
      dataverseUrl: run.dataverseUrl ?? null,
    },
    flows: collected.flows,
    apps: collected.apps,
    listNames,
    tableIds: collected.tableIds,
    knownSites: run.knownSites,
    sources: collected.sources,
    warnings,
  });

  // 3 — write. One graph, worded twice: English for whatever reads the files, the chosen language
  // for the one a person opens.
  const brand = await resolveBranding(options, hooks);
  const graph = materialize(raw, translator('en'));
  const json = `${JSON.stringify(graph, null, 2)}\n`;
  const command = rebuildCommand(run, options);
  const rendered = renderMarkdown(graph, { command, t: translator('en'), jsonBytes: json.length });
  const files: Record<string, string> = {
    'graph.json': json,
    'graph-index.md': `${rendered.index}\n`,
    'graph.md': `${rendered.digest}\n`,
    'graph-flows.md': `${rendered.flows}\n`,
    'graph.html': renderHtml(run.locale === 'en' ? graph : materialize(raw, t), t, brand),
  };
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(run.outDir, name), content, 'utf8');
  }

  return { graph, summary: summarize(graph, run, command, collected.flows.length, collected.apps.length, sharePoint) };
}

function summarize(
  graph: Graph,
  run: RunConfig,
  command: string,
  flows: number,
  apps: number,
  sharePoint: ReportSummary['sharePoint'],
): ReportSummary {
  const counts = { site: 0, list: 0, table: 0, flow: 0, app: 0 } as Record<NodeType, number>;
  for (const node of graph.nodes) counts[node.type] += 1;
  return {
    tenant: graph.tenant,
    environment: {
      environmentId: run.environmentId,
      ...(run.environmentName ? { name: run.environmentName } : {}),
      ...(run.dataverseUrl ? { dataverseUrl: run.dataverseUrl } : {}),
    },
    ...(run.signedInAs ? { signedInAs: run.signedInAs } : {}),
    generatedAt: graph.generatedAt,
    scope: graph.scope ?? null,
    outDir: run.outDir,
    files: [...FILE_ORDER],
    counts,
    flows,
    apps,
    triggerEdges: graph.edges.filter((edge) => edge.kind === 'triggers').length,
    selfTriggers: graph.selfTriggers.length,
    unguarded: graph.selfTriggers.filter((entry) => !entry.guarded).length,
    ...(sharePoint ? { sharePoint } : {}),
    sources: graph.sources.map((source) => ({
      name: source.name,
      ok: source.ok,
      ...(source.detail ? { detail: source.detail } : {}),
    })),
    command,
  };
}

/**
 * The command that reproduces this run, written into every generated file.
 *
 * Built from the RESOLVED values rather than from what was typed — an environment picked from a
 * list comes back as its id — so the next reader can refresh the report without knowing what the
 * first one knew. Always a CLI command, even when an MCP tool produced the report.
 */
function rebuildCommand(run: RunConfig, options: ReportOptions): string {
  const parts = [invocation()];
  if (options.tenant) parts.push('--tenant', quote(options.tenant));
  parts.push('--environment', run.environmentId);
  if (run.dataverseUrl) parts.push('--dataverse-url', run.dataverseUrl);
  if (options.sharePointClientId) parts.push('--sharepoint-client-id', options.sharePointClientId);
  if (options.noSharePointLogin) parts.push('--no-sharepoint-login');
  if (options.label) parts.push('--label', quote(options.label));
  for (const site of run.knownSites) parts.push('--site-name', quote(`${site.url}=${site.name}`));
  if (run.skip.size > 0) parts.push('--skip', [...run.skip].join(','));
  for (const solution of options.solutions ?? []) parts.push('--solution', quote(solution));
  // The RESOLVED language, so a locale picked at the prompt is recorded just like one passed as an
  // option. Only when it deviates from the default — a refresh must come back with the same viewer.
  if (run.locale !== DEFAULT_LOCALE) parts.push('--locale', run.locale);
  if (options.brandTitle) parts.push('--brand-title', quote(options.brandTitle));
  if (options.brandLogo) parts.push('--brand-logo', quote(options.brandLogo));
  if (options.brandColor) parts.push('--brand-color', options.brandColor);
  parts.push('--out', quote(displayPath(run.outDir)));
  return parts.join(' ');
}

/** Reproduce how this process was started — a global binary, or `node <path>` from a checkout. */
function invocation(): string {
  const entry = process.argv[1];
  if (!entry || /[\\/]\.bin[\\/]|(^|[\\/])ppgraph$/.test(entry)) return 'ppgraph';
  return `node ${displayPath(entry)}`;
}

const quote = (value: string): string => (/[\s|]/.test(value) ? `"${value}"` : value);

/** Relative to the working directory when that is shorter, and always with forward slashes. */
export function displayPath(target: string): string {
  const relative = path.relative(process.cwd(), target);
  const useRelative = relative !== '' && !relative.startsWith('..') && relative.length < target.length;
  return (useRelative ? relative : target).replace(/\\/g, '/');
}

/**
 * The three branding flags, ready for the renderer. The logo is INLINED so the report can be
 * emailed and opened anywhere; one that cannot be read is a warning, never a failed run.
 */
async function resolveBranding(options: ReportOptions, hooks: ReportHooks): Promise<Branding> {
  const brand: Branding = {};
  if (options.brandTitle) brand.title = options.brandTitle;
  if (options.brandColor) {
    brand.color = options.brandColor;
    brand.onColor = readableOn(options.brandColor);
    const ratio = bandContrast(options.brandColor);
    hooks.step(`Brand colour ${options.brandColor}, header text ${brand.onColor} (${ratio.toFixed(1)}:1)`);
    // 3:1 is WCAG's floor for large text, which the band title is. Below it the header is not
    // readable at all and the brand colour needs to move, so it is worth interrupting for.
    if (ratio < 3) {
      hooks.warn(`Brand colour ${options.brandColor} carries its header at only ${ratio.toFixed(1)}:1 `
        + '— pick a darker or lighter colour');
    }
  }

  if (!options.brandLogo) return brand;
  try {
    const source = options.brandLogo;
    const remote = source.toLowerCase().startsWith('http://') || source.toLowerCase().startsWith('https://');
    const bytes = remote
      ? new Uint8Array(await (await fetchOrThrow(source)).arrayBuffer())
      : new Uint8Array(fs.readFileSync(source));
    if (bytes.byteLength > LOGO_LIMIT) {
      throw new Error(`${Math.round(bytes.byteLength / 1024)} kB exceeds the ${LOGO_LIMIT / 1024} kB limit`);
    }
    const mime = mimeFor(source) ?? 'image/png';
    brand.logo = dataUri(bytes, mime);
    hooks.step(`Logo inlined (${Math.round(bytes.byteLength / 1024)} kB, ${mime})`);
  } catch (error) {
    // To the operator, not into the report — which may be going to a customer.
    hooks.warn(`Logo ${options.brandLogo} could not be read `
      + `(${error instanceof Error ? error.message : String(error)}) — generated without it`);
  }
  return brand;
}

async function fetchOrThrow(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}
