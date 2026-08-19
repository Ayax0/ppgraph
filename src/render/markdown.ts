// The machine-readable half of the output: a compact digest that answers "if this record changes,
// which flow starts" without touching the environment again.
//
// Two documents, because environments get big: `graph.md` is the digest (read this first) and
// `graph-flows.md` carries one section per flow for when a specific flow is the question.
//
// All wording comes from the catalogue (src/i18n) — there is no literal report text in this file.
import { nodeMap } from '../graph/build.js';
import { stateLabel } from '../graph/materialize.js';
import type { Translator, MessageKey } from '../i18n/index.js';
import type { CascadeStep, EdgeKind, Graph, GraphNode } from '../types.js';

const VERB_KEY: Record<EdgeKind, MessageKey> = {
  creates: 'verbCreates',
  updates: 'verbUpdates',
  deletes: 'verbDeletes',
  reads: 'verbReads',
  other: 'verbOther',
  triggers: 'verbTriggers',
  uses: 'verbUses',
  calls: 'verbCalls',
  contains: 'verbContains',
};

/** Several trigger conditions all have to hold — joined with the catalogue's word for "and". */
const allOf = (parts: readonly string[], t: Translator): string => parts.join(` ${t('uiAnd')} `);

export interface MarkdownOutput {
  /** The entry point: small enough to read whole, and it says where everything else is. */
  index: string;
  digest: string;
  flows: string;
}

export interface MarkdownOptions {
  command: string;
  t: Translator;
  /** The serialized `graph.json`, so the index can quote its real size instead of a guess. */
  jsonBytes?: number;
}

export function renderMarkdown(graph: Graph, options: MarkdownOptions): MarkdownOutput {
  // Digest and flows first: the index quotes what they weigh, which it can only do once they
  // exist. Every size is measured in this run rather than carried over.
  const digest = renderDigest(graph, options);
  const flows = renderFlows(graph, options);
  return { index: renderIndex(graph, options, measure(digest, flows, options.jsonBytes)), digest, flows };
}

/** What the three big files cost, in the only unit that decides whether to open one. */
interface Sizes {
  digest: string;
  flows: string;
  json: string;
  cascadeSection: string;
  flowSection: string;
}

/**
 * Rough token counts from real byte counts — four bytes to the token, the usual rule of thumb for
 * English prose. Rough is enough: the decision it informs is "search this file or read it", where
 * the two answers are an order of magnitude apart, and every value is marked `≈`.
 */
function measure(digest: string, flows: string, jsonBytes?: number): Sizes {
  const median = (text: string, heading: string): number => {
    const parts = text.split(new RegExp(`^${heading} `, 'm')).slice(1);
    if (parts.length === 0) return 0;
    const lengths = parts.map((part) => part.length).sort((a, b) => a - b);
    return lengths[Math.floor(lengths.length / 2)] ?? 0;
  };
  return {
    digest: approx(digest.length),
    flows: approx(flows.length),
    json: approx(jsonBytes ?? 0),
    cascadeSection: approx(median(digest, '###')),
    flowSection: approx(median(flows, '##')),
  };
}

function approx(bytes: number): string {
  const tokens = Math.round(bytes / 4);
  return tokens >= 10000 ? `≈${Math.round(tokens / 1000)}k` : `≈${Math.max(1, Math.round(tokens / 10)) * 10}`;
}

/**
 * The index exists because the digest runs to tens of thousands of tokens while a single question
 * answered from it costs a fraction of one percent of that. Without an entry point an agent reads
 * the whole file to find one section — so this file answers "what is in this environment" by
 * itself, and for everything else says which file to search and what to search for. It is
 * deliberately the only one meant to be read end to end.
 */
function renderIndex(graph: Graph, { command, t }: MarkdownOptions, sizes: Sizes): string {
  const { sortBy } = sorters(t.locale);
  const counts = countBy(graph.nodes);
  const out: string[] = [];
  const push = (...lines: string[]): void => { out.push(...lines.flatMap((line) => line.split('\n'))); };

  push(`# ${t('idxTitle', { tenant: graph.tenant, environment: graph.environment.name ?? graph.environment.environmentId })}`, '');
  push(...rebuildBlock(command, graph.generatedAt, t), '');
  push(t('idxIntro'), '');
  if (graph.scope?.length) push(t('repScopeSolution', { solutions: graph.scope.join(', ') }), '');
  push(t('repScope', {
    scope: [
      t('countSites', { count: counts['site'] ?? 0 }),
      t('countLists', { count: counts['list'] ?? 0 }),
      counts['table'] ? t('countTables', { count: counts['table'] }) : null,
      t('countFlows', { count: counts['flow'] ?? 0 }),
      t('countApps', { count: counts['app'] ?? 0 }),
    ].filter((entry): entry is string => entry !== null).join(' · '),
  }), '');

  // Per solution, the three numbers that say how big a thing it is before anything is opened.
  const perSolution = new Map<string, { flows: number; apps: number; sources: number }>();
  for (const node of graph.nodes) {
    for (const solution of node.solutions?.length ? node.solutions : [t('uiNoSolutionGroup')]) {
      const entry = perSolution.get(solution) ?? { flows: 0, apps: 0, sources: 0 };
      if (node.type === 'flow') entry.flows++;
      else if (node.type === 'app') entry.apps++;
      else if (node.type === 'list' || node.type === 'table') entry.sources++;
      perSolution.set(solution, entry);
    }
  }
  push(t('idxSolutions'), '');
  for (const [solution, entry] of sortBy([...perSolution.entries()], ([name]) => name)) {
    push(t('idxSolution', { solution, flows: entry.flows, apps: entry.apps, sources: entry.sources }));
  }
  push('');

  const unguarded = graph.selfTriggers.filter((entry) => !entry.guarded).length;
  const quiet = graph.nodes.filter((node) => (node.type === 'list' || node.type === 'table')
    && !Object.keys(graph.cascades).includes(node.id)).length;
  push(t('idxFindings'), '');
  if (unguarded > 0) push(t('idxFindingUnguarded', { count: unguarded }));
  push(t('idxFindingSelf', { count: graph.selfTriggers.length }));
  if (graph.sharedSources.length > 0) push(t('idxFindingShared', { count: graph.sharedSources.length }));
  if (graph.warnings.length > 0) push(t('idxFindingUnresolved', { count: graph.warnings.length }));
  push(t('idxFindingQuiet', { count: quiet }), '');

  push(t('idxLookup'), '');
  push(
    t('idxLookupCascade', { tokens: sizes.cascadeSection }),
    t('idxLookupTrigger'),
    t('idxLookupFlow', { tokens: sizes.flowSection }),
    t('idxLookupJson', { tokens: sizes.json }),
    '',
  );
  push(t('idxWarnWhole', { digest: sizes.digest, flows: sizes.flows }), '');
  return out.join('\n');
}

function renderDigest(graph: Graph, { command, t }: MarkdownOptions): string {
  const byId = nodeMap(graph);
  const name = (id: string): string => sourceLabel(byId, id, t);
  const verb = (kind: EdgeKind): string => t(VERB_KEY[kind]);
  const { byLabel, sortBy } = sorters(t.locale);
  const out: string[] = [];
  const push = (...lines: string[]): void => { out.push(...lines.flatMap((line) => line.split('\n'))); };

  const counts = countBy(graph.nodes);
  const triggerEdges = graph.edges.filter((edge) => edge.kind === 'triggers');
  const hasOwnSection = new Set(Object.keys(graph.cascades));

  push(...header(graph, command, counts, t));

  // 1 — the answer to "who reacts to this data source"
  push(t('repSec1'), '');
  if (triggerEdges.length === 0) {
    push(t('repSec1Empty'));
  } else {
    push(t('repSec1Head'), '|---|---|---|---|---|');
    for (const edge of sortBy(triggerEdges, (e) => `${name(e.from)} ${name(e.to)}`)) {
      const flow = byId.get(edge.to);
      push(`| ${cell(name(edge.from))} | ${cell(name(edge.to))} | ${cell(edge.label)} | `
        + `${cell(allOf(edge.conditions ?? [], t) || '—')} | ${cell(stateLabel(flow?.state, t) ?? '?')} |`);
    }
  }
  push('');

  // 2 — the cascade: the reason the tool exists
  push(t('repSec2'), '', t('repSec2Intro'), '');
  const cascadeKeys = sortBy([...hasOwnSection], (id) => name(id));
  if (cascadeKeys.length === 0) push(t('repSec2Empty'));
  for (const listId of cascadeKeys) {
    push(`### ${name(listId)}`);
    for (const step of graph.cascades[listId] ?? []) push(...renderStep(step, 0, name, 2, t));
    push('');
  }

  // 3 — self-triggering flows
  push(t('repSec3'), '');
  if (graph.selfTriggers.length === 0) {
    push(t('repNone'));
  } else {
    push(t('repSec3Intro'), '', t('repSec3Note'), '');
    for (const self of sortBy(graph.selfTriggers, (s) => name(s.flow))) {
      push(`- **${name(self.flow)}** ↻ ${name(self.list)} — ${[...new Set(self.verbs)].map(verb).join(', ')}`
        + ` · ${self.guarded ? t('repGuarded') : t('repUnguarded')}`);
    }
  }
  push('');

  // 4 — one line per flow; the sections live in graph-flows.md
  push(t('repSec4'), '', t('repSec4Intro'), '', t('repSec4Head'), '|---|---|---|---|');
  for (const flow of graph.nodes.filter((node) => node.type === 'flow').sort(byLabel)) {
    push(`| ${cell(flow.label)} | ${cell(triggerSummary(flow, byId, graph, t))} | ${cell(stateLabel(flow.state, t) ?? '?')} | `
      + `${cell(flow.solutionName ?? flow.solution ?? '—')} |`);
  }
  push('');

  // 5 — apps
  const apps = graph.nodes.filter((node) => node.type === 'app').sort(byLabel);
  push(t('repSec5'), '');
  if (apps.length === 0) push(t('repNone'));
  for (const app of apps) {
    const outgoing = graph.edges.filter((edge) => edge.from === app.id);
    push(`### ${app.label}`);
    if (app.solution) push(`- ${t('repSolution', { solution: app.solutionName ?? app.solution })}`);
    push(t('repDataSources', { sources: outgoing.filter((e) => e.kind === 'uses').map((e) => name(e.to)).join(', ') || '—' }));
    push(t('repCallsFlows', { flows: outgoing.filter((e) => e.kind === 'calls').map((e) => name(e.to)).join(', ') || '—' }));
    push('');
  }

  // 6 — the quiet ones
  const quiet = graph.nodes.filter((node) => (node.type === 'list' || node.type === 'table') && !hasOwnSection.has(node.id));
  push(t('repSec6'), '', t('repSec6Intro'), '');
  if (quiet.length === 0) push(t('repNone'));
  for (const node of quiet.sort(byLabel)) {
    const touchedBy = graph.edges
      .filter((edge) => edge.to === node.id && edge.kind !== 'contains')
      .map((edge) => `${name(edge.from)} ${verb(edge.kind)}`);
    push(`- **${name(node.id)}** — ${touchedBy.length ? touchedBy.join('; ') : t('repUnusedSource')}`);
  }
  push('');

  // 7 — cross-solution coupling
  push(t('repSec7'), '', t('repSec7Intro'), '');
  const shared = sortBy(graph.sharedSources, (entry) => name(entry.node));
  if (shared.length === 0) push(t('repNone'));
  for (const entry of shared) {
    push(`- **${name(entry.node)}** — ${entry.usedBy.map((u) => `${u.solution} (${u.links})`).join(', ')}`);
  }
  push('');

  return out.join('\n');
}

function renderFlows(graph: Graph, { command, t }: MarkdownOptions): string {
  const byId = nodeMap(graph);
  const name = (id: string): string => sourceLabel(byId, id, t);
  const { byLabel } = sorters(t.locale);
  const out: string[] = [];
  const push = (...lines: string[]): void => { out.push(...lines.flatMap((line) => line.split('\n'))); };

  push(`# ${t('repFlowsTitle', { tenant: graph.tenant, environment: graph.environment.name ?? graph.environment.environmentId })}`, '');
  push(...rebuildBlock(command, graph.generatedAt, t, t('repOverviewNote')), '');

  for (const flow of graph.nodes.filter((node) => node.type === 'flow').sort(byLabel)) {
    const incoming = graph.edges.filter((edge) => edge.to === flow.id);
    const outgoing = graph.edges.filter((edge) => edge.from === flow.id);

    push(`## ${flow.label}`);
    push(t('repStatus', { state: stateLabel(flow.state, t) ?? t('repUnknown') })
      + (flow.solution ? ` · ${t('repSolution', { solution: flow.solutionName ?? flow.solution })}` : ` · ${t('repNoSolution')}`)
      + (flow.managed ? ` · ${t('repManaged')}` : ''));
    push(t('repTrigger', { label: flow.trigger ? flow.trigger.label : t('repUnknown') })
      + (flow.resolved === false ? ` ${t('repNoCaller')}` : '')
      + (flow.trigger?.conditions.length ? ` — ${t('repOnlyIf', { condition: allOf(flow.trigger.conditions, t) })}` : ''));
    for (const edge of incoming.filter((e) => e.kind === 'triggers')) {
      push(t('repTriggeredBy', { source: name(edge.from) }));
    }
    for (const edge of outgoing.filter((e) => e.kind !== 'calls')) {
      push(`- ${t(VERB_KEY[edge.kind])}: ${name(edge.to)}${edge.actions?.length ? ` (${edge.actions.join(', ')})` : ''}`);
    }
    for (const edge of outgoing.filter((e) => e.kind === 'calls')) push(t('repCalls', { flow: name(edge.to) }));
    for (const edge of incoming.filter((e) => e.kind === 'calls')) push(t('repCalledBy', { flow: name(edge.from) }));
    if (flow.connectors?.length) push(t('repConnectors', { connectors: flow.connectors.join(', ') }));
    if (flow.url) push(`- ${flow.url}`);
    push('');
  }

  return out.join('\n');
}

/**
 * The refresh instruction, at the top of every generated document and deliberately not an HTML
 * comment: whoever opens the file must be able to bring it up to date without knowing where the
 * values came from. The command carries all of them.
 */
function rebuildBlock(command: string, generatedAt: string, t: Translator, note?: string): string[] {
  return [
    `> ${t('repGenerated')}`,
    `> ${t('repRebuild', { date: stamp(generatedAt), note: note ? ` ${note}` : '' })}`,
    '>',
    '> ```',
    `> ${command}`,
    '> ```',
  ];
}

function header(graph: Graph, command: string, counts: Record<string, number>, t: Translator): string[] {
  const scope = [
    t('countSites', { count: counts['site'] ?? 0 }),
    t('countLists', { count: counts['list'] ?? 0 }),
    counts['table'] ? t('countTables', { count: counts['table'] }) : null,
    t('countFlows', { count: counts['flow'] ?? 0 }),
    t('countApps', { count: counts['app'] ?? 0 }),
  ].filter((entry): entry is string => entry !== null);

  const lines = [
    `# ${t('repTitle', { tenant: graph.tenant, environment: graph.environment.name ?? graph.environment.environmentId })}`,
    '',
    ...rebuildBlock(command, graph.generatedAt, t),
    '',
    // A narrowed report says so once, in the header. Repeating the caveat in every section would
    // only make it read like an apology.
    ...(graph.scope?.length ? [t('repScopeSolution', { solutions: graph.scope.join(', ') }), ''] : []),
    t('repScope', { scope: scope.join(' · ') }),
    '',
    t('repSources', { sources: graph.sources.map((s) => `${s.name} ${s.ok ? '✓' : '✗'} (${s.detail ?? ''})`).join(' · ') }),
  ];

  if (graph.warnings.length > 0) {
    lines.push('', t('repUnresolved'));
    for (const warning of graph.warnings.slice(0, 25)) lines.push(`- ${warning}`);
    if (graph.warnings.length > 25) lines.push(`- ${t('repMoreEntries', { count: graph.warnings.length - 25 })}`);
  }
  lines.push('');
  return lines;
}

function triggerSummary(flow: GraphNode, byId: Map<string, GraphNode>, graph: Graph, t: Translator): string {
  if (!flow.trigger) return t('repUnknown');
  // For a flow, `resolved: false` means nothing was found that starts it.
  const orphan = flow.resolved === false ? ` ${t('repNoCaller')}` : '';
  const incoming = graph.edges.find((edge) => edge.kind === 'triggers' && edge.to === flow.id);
  if (!incoming) return `${flow.trigger.label}${orphan}`;
  return `${sourceLabel(byId, incoming.from, t)}: ${flow.trigger.label}${orphan}`;
}

function renderStep(step: CascadeStep, depth: number, name: (id: string) => string, maxDepth: number, t: Translator): string[] {
  const indent = '  '.repeat(depth);
  const lines: string[] = [];
  const conditions = step.conditions.length > 0 ? ` — ${t('repOnlyIf', { condition: allOf(step.conditions, t) })}` : '';
  lines.push(`${indent}- ▶ **${name(step.flow)}** (${step.on ?? ''})${conditions}`);

  for (const write of step.writes) {
    const label = `${indent}  - ${t(VERB_KEY[write.verb])} → ${name(write.list)}`;
    if (write.cycle) {
      lines.push(`${label} ${t('repBackIntoChain')}`);
    } else if (write.next.length === 0) {
      lines.push(`${label} — ${t('repStartsNothing')}`);
    } else if (depth + 1 >= maxDepth) {
      lines.push(`${label} ↦ ${t('repOwnSection', { list: name(write.list) })}`);
    } else {
      lines.push(label);
      for (const next of write.next) lines.push(...renderStep(next, depth + 2, name, maxDepth, t));
    }
  }
  return lines;
}

/**
 * How a trigger source is written out. Every one names its technology, because the two behave
 * differently and a reader must not have to infer which is which from the shape of a name.
 */
function sourceLabel(byId: Map<string, GraphNode>, id: string, t: Translator): string {
  const node = byId.get(id);
  if (!node) return id;
  if (node.type === 'list') {
    const site = node.siteId ? byId.get(node.siteId)?.label : null;
    // `resolved: false` covers two different gaps, and only one of them is a missing NAME:
    //   · no site → an app named a list without saying where it lives; the name is known
    //   · site known → the reference was a GUID the site never resolved; the label IS that GUID
    // Marking the first as "name unresolved" would be plainly wrong, so the site-less form carries
    // the unknown segment in the path instead.
    if (!site) return t('repSourceSharePointNoSite', { list: node.label });
    const label = t('repSourceSharePoint', { site, list: node.label });
    if (node.resolved !== false) return label;
    // Naming the environment variable turns "this is broken" into "go and fix this knob".
    return `${label} ${node.envVar ? t('repUnresolvedVia', { envVar: node.envVar }) : t('repNameUnresolved')}`;
  }
  if (node.type === 'table') return t('repSourceDataverse', { table: node.label });
  return node.label;
}

function cell(text: string | undefined): string {
  return String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Sorting is language-dependent — ä belongs next to a in German and after z in Swedish — so the
 * comparators are bound to the report's locale rather than to whatever locale the machine runs in.
 */
function sorters(locale: string): {
  byLabel: (a: GraphNode, b: GraphNode) => number;
  sortBy: <T>(items: readonly T[], key: (item: T) => string) => T[];
} {
  const collator = new Intl.Collator(locale);
  return {
    byLabel: (a, b) => collator.compare(a.label, b.label),
    sortBy: (items, key) => [...items].sort((a, b) => collator.compare(key(a), key(b))),
  };
}

function countBy(nodes: GraphNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
  return counts;
}

/** Locale-aware, so a report reads its date the way its language writes dates. */
/**
 * The generation time in the machine-readable files: `2026-08-14 13:40`, local time, always.
 *
 * Not `formatDate`: a locale-formatted stamp turns `14.08.2026` into `08/14/2026` between two
 * languages, which is ambiguous in exactly the half of the world that reads the other one. The
 * viewer, where a person is reading, uses the locale form.
 */
export function stamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDate(iso: string, locale = 'de'): string {
  return new Date(iso).toLocaleString(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
