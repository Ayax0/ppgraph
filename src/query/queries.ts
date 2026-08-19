// The questions, as functions: each takes a loaded graph and returns a payload — no protocol, no
// I/O. Two rules hold throughout: filter on MACHINE values (`state`, `on`, `kind`, `verb`,
// `resolved`) rather than on prose, and say what was left out.
import type {
  CascadeStep, EdgeKind, Graph, GraphEdge, GraphNode, NodeType, SelfTrigger,
} from '../types.js';

export interface Truncation {
  shown: number;
  of: number;
  /** Which argument makes the question smaller. Written for whoever reads the answer. */
  narrow: string;
}

const cut = <T>(items: T[], limit: number, narrow: string): { items: T[]; truncated?: Truncation } => (
  items.length <= limit
    ? { items }
    : { items: items.slice(0, limit), truncated: { shown: limit, of: items.length, narrow } });

/** The ceiling an answer may not cross, in bytes of JSON — roughly six thousand tokens. */
export const MAX_BYTES = 24_000;

/**
 * Build an answer that fits, by asking for fewer items until it does. Halving rather than trimming
 * the rendered JSON keeps the answer valid, and lets `cut` record what was left out.
 */
export function fit<T>(build: (limit: number) => T, limit: number, max = MAX_BYTES): T {
  let current = Math.max(1, limit);
  let payload = build(current);
  while (JSON.stringify(payload).length > max && current > 1) {
    current = Math.floor(current / 2);
    payload = build(current);
  }
  return payload;
}

/** Drop empty arrays, nulls and `false` — a field that says nothing costs the reader anyway. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null || entry === false) continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    out[key] = entry;
  }
  return out as Partial<T>;
}

// ---------------------------------------------------------------- overview

export interface SolutionCount {
  /** `null` is the leftovers group — nodes no solution owns. Not a caption; a grouping key. */
  solution: string | null;
  flows: number;
  apps: number;
  sources: number;
}

export function overview(graph: Graph): Record<string, unknown> {
  const counts = {} as Record<NodeType, number>;
  for (const node of graph.nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;

  const perSolution = new Map<string | null, SolutionCount>();
  for (const node of graph.nodes) {
    const owners: (string | null)[] = node.solutions?.length ? node.solutions : [null];
    for (const solution of owners) {
      const entry = perSolution.get(solution) ?? { solution, flows: 0, apps: 0, sources: 0 };
      if (node.type === 'flow') entry.flows += 1;
      else if (node.type === 'app') entry.apps += 1;
      else if (node.type === 'list' || node.type === 'table') entry.sources += 1;
      perSolution.set(solution, entry);
    }
  }

  const withCascade = new Set(Object.keys(graph.cascades));
  return compact({
    environment: compact({
      name: graph.environment.name,
      environmentId: graph.environment.environmentId,
      dataverseUrl: graph.environment.dataverseUrl,
    }),
    scope: graph.scope ?? null,
    counts,
    solutions: [...perSolution.values()].sort((a, b) => (a.solution ?? '').localeCompare(b.solution ?? '')),
    findings: {
      selfTriggers: graph.selfTriggers.length,
      unguarded: graph.selfTriggers.filter((entry) => !entry.guarded).length,
      sharedSources: graph.sharedSources.length,
      unresolvedLists: graph.nodes.filter((node) => node.type === 'list' && node.resolved === false).length,
      flowsWithoutCaller: graph.nodes.filter((node) => node.type === 'flow' && node.resolved === false).length,
      disabledFlows: graph.nodes.filter((node) => node.type === 'flow' && node.state !== 'enabled').length,
      sourcesNothingTriggersOn: graph.nodes.filter((node) =>
        (node.type === 'list' || node.type === 'table') && !withCascade.has(node.id)).length,
    },
    sources: graph.sources.map((source) => compact({
      name: source.name, ok: source.ok, detail: source.detail,
    })),
    warnings: graph.warnings,
  });
}

// ---------------------------------------------------------------- find

export interface FindOptions {
  query?: string;
  type?: NodeType;
  solution?: string;
  limit?: number;
}

export function findNodes(graph: Graph, options: FindOptions): Record<string, unknown> {
  const needle = options.query?.trim().toLowerCase() ?? '';
  const matched = graph.nodes.filter((node) => {
    if (options.type && node.type !== options.type) return false;
    if (options.solution && !ownedBy(node, options.solution)) return false;
    if (!needle) return true;
    return node.label.toLowerCase().includes(needle) || node.id.toLowerCase().includes(needle);
  });

  // Exact matches first, then the closest: "Orders" beats "Order Approval Log" for "order".
  const ranked = matched.sort((a, b) => rank(a, needle) - rank(b, needle)
    || (needle ? a.label.length - b.label.length : 0)
    || a.type.localeCompare(b.type) || a.label.localeCompare(b.label));
  const { items, truncated } = cut(ranked, options.limit ?? 20, 'query, type or solution');
  return compact({ matches: items.map(summarise), truncated });
}

const rank = (node: GraphNode, needle: string): number => {
  if (!needle) return 1;
  const label = node.label.toLowerCase();
  if (label === needle) return 0;
  return label.startsWith(needle) ? 1 : 2;
};

const ownedBy = (node: GraphNode, solution: string): boolean => {
  const needle = solution.toLowerCase();
  return (node.solutions ?? []).some((name) => name.toLowerCase() === needle)
    || (node.solutionName ?? '').toLowerCase() === needle
    || (node.solution ?? '').toLowerCase() === needle;
};

/** One line per node: enough to choose, never enough to answer with. */
function summarise(node: GraphNode): Record<string, unknown> {
  return compact({
    id: node.id,
    type: node.type,
    label: node.label,
    solutions: node.solutions,
    state: node.state,
    trigger: node.trigger ? { kind: node.trigger.kind, on: node.trigger.on } : undefined,
    site: node.site,
    itemCount: node.itemCount,
    // `resolved: false` means a list nobody could name or a flow nobody calls, depending on type.
    resolved: node.resolved === false ? false : undefined,
    envVar: node.envVar,
  });
}

// ---------------------------------------------------------------- one node

export interface NodeOptions {
  id?: string;
  query?: string;
  edges?: boolean;
  limit?: number;
}

export function describeNode(graph: Graph, options: NodeOptions): Record<string, unknown> {
  const node = resolveNode(graph, options);
  const limit = options.limit ?? 60;
  if (options.edges === false) return { node: full(node) };

  const incoming = graph.edges.filter((edge) => edge.to === node.id);
  const outgoing = graph.edges.filter((edge) => edge.from === node.id);
  const label = labeller(graph);
  const inCut = cut(incoming, limit, 'limit');
  const outCut = cut(outgoing, limit, 'limit');

  return compact({
    node: full(node),
    incoming: inCut.items.map((edge) => describeEdge(edge, edge.from, label)),
    outgoing: outCut.items.map((edge) => describeEdge(edge, edge.to, label)),
    truncated: inCut.truncated ?? outCut.truncated,
  });
}

function full(node: GraphNode): Record<string, unknown> {
  return compact({
    id: node.id,
    type: node.type,
    label: node.label,
    url: node.url,
    solutions: node.solutions,
    solutionName: node.solutionName,
    state: node.state,
    managed: node.managed,
    source: node.source,
    connectors: node.connectors,
    trigger: node.trigger
      ? compact({
        kind: node.trigger.kind,
        on: node.trigger.on,
        label: node.trigger.label,
        conditions: node.trigger.conditions,
        connector: node.trigger.connector,
      })
      : undefined,
    site: node.site,
    listId: node.listId,
    itemCount: node.itemCount,
    resolved: node.resolved === false ? false : undefined,
    envVar: node.envVar,
    usedBy: node.usedBy,
    workflowId: node.workflowId,
  });
}

function describeEdge(edge: GraphEdge, other: string, label: (id: string) => string): Record<string, unknown> {
  return compact({
    kind: edge.kind,
    node: other,
    label: label(other),
    on: edge.on,
    trigger: edge.kind === 'triggers' ? edge.label : undefined,
    conditions: edge.conditions,
    refiredBy: edge.refiredBy,
    actions: edge.actions,
  });
}

const labeller = (graph: Graph): ((id: string) => string) => {
  const byId = new Map(graph.nodes.map((node) => [node.id, node.label]));
  return (id) => byId.get(id) ?? id;
};

/** `id` when given, otherwise the single node `query` matches. Ambiguity is an error, not a guess. */
export function resolveNode(graph: Graph, options: { id?: string; query?: string }): GraphNode {
  if (options.id) {
    const exact = graph.nodes.find((node) => node.id === options.id);
    if (exact) return exact;
    throw new Error(`No node has the id "${options.id}". Use graph_find to look one up.`);
  }
  const needle = options.query?.trim().toLowerCase();
  if (!needle) throw new Error('Pass either id or query.');

  const matches = graph.nodes.filter((node) => node.label.toLowerCase().includes(needle));
  const exact = matches.filter((node) => node.label.toLowerCase() === needle);
  const candidates = exact.length > 0 ? exact : matches;
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) throw new Error(`Nothing is called "${options.query}".`);
  throw new Error(`"${options.query}" matches ${candidates.length} nodes — pass id. `
    + `Candidates: ${candidates.slice(0, 8).map((node) => `${node.type} ${node.label} (${node.id})`).join(' | ')}`);
}

// ---------------------------------------------------------------- impact

export interface ImpactOptions {
  id?: string;
  query?: string;
  /** Which write to simulate. Filters the first level by what each trigger actually listens for. */
  verb?: 'create' | 'update' | 'delete';
  depth?: number;
  limit?: number;
}

const VERB_EDGE: Record<'create' | 'update' | 'delete', EdgeKind> = {
  create: 'creates', update: 'updates', delete: 'deletes',
};

export function impact(graph: Graph, options: ImpactOptions): Record<string, unknown> {
  const node = resolveNode(graph, options);
  const label = labeller(graph);
  const depth = Math.max(0, Math.min(options.depth ?? 2, 3));
  const steps = graph.cascades[node.id] ?? [];

  const wanted = options.verb ? VERB_EDGE[options.verb] : null;
  const kept = wanted
    ? steps.filter((step) => {
      const edge = graph.edges.find((candidate) =>
        candidate.kind === 'triggers' && candidate.from === node.id && candidate.to === step.flow);
      return (edge?.refiredBy ?? ['creates', 'updates', 'deletes']).includes(wanted);
    })
    : steps;

  const { items, truncated } = cut(kept, options.limit ?? 25, 'limit, verb or depth');
  return compact({
    source: compact({ id: node.id, type: node.type, label: node.label, solutions: node.solutions }),
    verb: options.verb,
    depth,
    triggersNothing: steps.length === 0 ? true : undefined,
    steps: items.map((step) => renderStep(step, label, depth, 0)),
    truncated,
  });
}

function renderStep(step: CascadeStep, label: (id: string) => string, max: number, level: number): Record<string, unknown> {
  return compact({
    flow: label(step.flow),
    id: step.flow,
    on: step.on,
    conditions: step.conditions,
    // A trigger with no condition fires on EVERY write, which is the finding, not the absence.
    unconditional: step.conditions.length === 0 ? true : undefined,
    // Label only: a write target's id is a site URL plus a list name and would double the size of
    // a cascade. Every tool here takes a name as readily as an id.
    writes: step.writes.map((write) => compact({
      verb: write.verb,
      to: label(write.list),
      actions: write.actions,
      cycle: write.cycle,
      next: level + 1 < max ? write.next.map((next) => renderStep(next, label, max, level + 1)) : undefined,
      more: level + 1 >= max && write.next.length > 0 ? write.next.length : undefined,
    })),
    more: step.truncated,
  });
}

// ---------------------------------------------------------------- findings

export type FindingKind = 'unguarded' | 'selfTriggers' | 'unresolved' | 'noCaller' | 'disabled' | 'shared';

export const FINDING_KINDS: readonly FindingKind[] = [
  'unguarded', 'selfTriggers', 'unresolved', 'noCaller', 'disabled', 'shared',
];

export interface FindingsOptions {
  kind?: FindingKind;
  solution?: string;
  limit?: number;
}

export function findings(graph: Graph, options: FindingsOptions): Record<string, unknown> {
  const limit = options.limit ?? 40;
  const label = labeller(graph);
  const wanted = options.kind ? [options.kind] : FINDING_KINDS;
  const keep = (node: GraphNode): boolean => !options.solution || ownedBy(node, options.solution);
  const result: Record<string, unknown> = {};
  let truncated: Truncation | undefined;

  const put = (key: FindingKind, all: unknown[], narrow: string): void => {
    if (!wanted.includes(key)) return;
    const { items, truncated: over } = cut(all, limit, narrow);
    result[key] = items;
    truncated = truncated ?? over;
  };

  const selfTriggers = graph.selfTriggers.filter((entry) => {
    const flow = graph.nodes.find((node) => node.id === entry.flow);
    return flow ? keep(flow) : true;
  });
  put('unguarded', selfTriggers.filter((entry) => !entry.guarded).map((entry) => selfTrigger(entry, label)),
    'solution or limit');
  put('selfTriggers', selfTriggers.map((entry) => selfTrigger(entry, label)), 'solution or limit');

  put('unresolved', graph.nodes
    .filter((node) => node.type === 'list' && node.resolved === false && keep(node))
    .map((node) => compact({ id: node.id, label: node.label, site: node.site, envVar: node.envVar,
      solutions: node.solutions })), 'solution or limit');

  put('noCaller', graph.nodes
    .filter((node) => node.type === 'flow' && node.resolved === false && keep(node))
    .map((node) => compact({ id: node.id, label: node.label, state: node.state,
      solutions: node.solutions })), 'solution or limit');

  put('disabled', graph.nodes
    .filter((node) => node.type === 'flow' && node.state !== 'enabled' && keep(node))
    .map((node) => compact({ id: node.id, label: node.label, state: node.state,
      solutions: node.solutions })), 'solution or limit');

  put('shared', graph.sharedSources.map((entry) => compact({
    id: entry.node, label: label(entry.node), usedBy: entry.usedBy,
  })), 'limit');

  return compact({ ...result, truncated });
}

const selfTrigger = (entry: SelfTrigger, label: (id: string) => string): Record<string, unknown> => compact({
  flow: label(entry.flow),
  id: entry.flow,
  list: label(entry.list),
  verbs: entry.verbs,
  actions: entry.actions,
  guarded: entry.guarded,
  repeatsIndefinitely: entry.guarded ? undefined : true,
});
