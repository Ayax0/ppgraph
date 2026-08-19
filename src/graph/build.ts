// Assemble the graph: nodes, edges, and the derived answers the tool exists for — "what does this
// set off" (cascade), "which flow triggers itself" and "what hangs off more than one solution".
import { connectorLabel, normalizeSite, prettyCondition } from '../platform/parse.js';
import { normalizeName, squashName } from '../platform/collect.js';
import { msg } from '../i18n/index.js';
import type { Phrase } from '../i18n/index.js';
import type {
  BuildGraphInput, CascadeStep, EdgeKind, FlowRecord, FlowTrigger, GraphEdge, GraphNode, RawGraph, SelfTrigger,
  UsedBySolution,
} from '../types.js';

/**
 * Inside this module every node, edge and cascade step still carries phrases rather than text —
 * these three aliases keep that visible without repeating the parameter on every signature.
 */
type Node = GraphNode<Phrase>;
type Edge = GraphEdge<Phrase>;
type Step = CascadeStep<Phrase>;

const WRITE_VERBS = new Set<EdgeKind>(['creates', 'updates', 'deletes']);
const ALL_WRITES: EdgeKind[] = ['creates', 'updates', 'deletes'];

/**
 * Which write verbs can actually re-fire a trigger — the difference between "a flow writes here"
 * and "a flow starts something here".
 *
 * Treating every write as a re-trigger reports self-triggers that cannot happen, including ones an
 * overview then flags as the most dangerous.
 *
 * The two connectors differ in kind, so they are answered separately:
 *
 * - **Dataverse** registers a webhook per MESSAGE (Create / Update / Delete). No overlap: an update
 *   trigger hears updates and nothing else.
 * - **SharePoint** POLLS a column. "When an item is created" reads `Created`, so only inserts show
 *   up. The "modified" triggers read `Modified` — and a freshly created item carries one, so an
 *   insert reaches them too.
 *
 * An operation we could not classify keeps every verb: under-reporting a loop is the dangerous
 * error, over-reporting is only noise.
 */
function refiredBy(trigger: FlowTrigger): EdgeKind[] {
  if (trigger.kind === 'dataverse') {
    switch (trigger.on) {
      case 'create': return ['creates'];
      case 'update': return ['updates'];
      case 'delete': return ['deletes'];
      default: return [];
    }
  }
  switch (trigger.on) {
    case 'create': return ['creates'];
    case 'createOrUpdate':
    case 'update': return ['creates', 'updates'];
    case 'delete': return ['deletes'];
    default: return ALL_WRITES;
  }
}

/**
 * The graph as data — nodes, edges, cascades — with every sentence still a key.
 *
 * Nothing here picks a language. That happens once per artefact in `materialize`, which is what
 * lets one build become an English `graph.json` and a German `graph.html`.
 */
export function buildGraph(input: BuildGraphInput): RawGraph {
  const { tenant, environment, flows, apps, listNames, tableIds, knownSites, sources, warnings } = input;
  // Fixed, not the report language: this is the order of `graph.json`, and a file that reshuffles
  // itself because somebody picked another language is a file nobody can diff.
  const collator = new Intl.Collator('en');
  const wanted = input.solutions?.length ? input.solutions : null;

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const notes: Phrase[] = [...warnings];

  const addNode = (node: Node): Node => {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return node;
    }
    const target = existing as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(node)) {
      if (value != null && target[key] == null) target[key] = value;
    }
    return existing;
  };

  const addEdge = (edge: Edge): Edge => {
    const key = `${edge.from}|${edge.to}|${edge.kind}`;
    const existing = edges.find((candidate) => `${candidate.from}|${candidate.to}|${candidate.kind}` === key);
    if (existing) {
      existing.actions = [...new Set([...(existing.actions ?? []), ...(edge.actions ?? [])])];
      return existing;
    }
    edges.push(edge);
    return edge;
  };

  // --- sites and lists -------------------------------------------------
  const siteTitle = new Map(knownSites.map((site) => [site.url.toLowerCase(), site.name]));
  const titleIndex = new Map<string, string[]>(); // list title → node ids, to attach site-less references

  function index(title: string, node: Node): void {
    const key = normalizeName(title);
    const list = titleIndex.get(key) ?? [];
    if (!list.includes(node.id)) list.push(node.id);
    titleIndex.set(key, list);
  }

  function siteNode(url: string | null | undefined): Node | null {
    const site = normalizeSite(url);
    if (!site) return null;
    return addNode({
      id: `site:${site.toLowerCase()}`,
      type: 'site',
      label: siteTitle.get(site.toLowerCase()) || siteLabel(site),
      url: site,
    });
  }

  function orphanList(name: string): Node {
    // An app can name a list without naming its site — attach it if the name is unambiguous.
    const candidates = titleIndex.get(normalizeName(name)) ?? [];
    const single = candidates.length === 1 ? nodes.get(candidates[0] ?? '') : undefined;
    if (single) return single;

    const node = addNode({
      id: `list:?::${normalizeName(name)}`,
      type: 'list',
      label: name,
      site: null,
      siteId: null,
      resolved: false,
    });
    index(name, node);
    return node;
  }

  function listNode(siteUrl: string | null | undefined, reference: string | null | undefined,
    options: { isGuid?: boolean; envVar?: string | null } = {}): Node | null {
    if (!reference) return null;
    const site = normalizeSite(siteUrl);
    if (!site) return orphanList(reference);

    const resolved = listNames.get(`${site.toLowerCase()}::${String(reference).toLowerCase()}`);
    const title = resolved?.title ?? reference;
    const parent = siteNode(site);
    const found = Boolean(resolved) || !options.isGuid;
    const node = addNode({
      id: `list:${site.toLowerCase()}::${String(title).toLowerCase()}`,
      type: 'list',
      label: title,
      site,
      siteId: parent?.id ?? null,
      listId: options.isGuid ? reference : resolved?.id ?? null,
      resolved: found,
      // Only worth carrying when the list did NOT resolve. Then the GUID on screen says nothing and
      // the variable says everything: this is the knob that points at a list which is not there.
      envVar: found ? null : options.envVar ?? null,
      itemCount: resolved?.itemCount ?? null,
      url: resolved?.url ?? null,
    });
    index(title, node);
    if (parent) addEdge({ from: parent.id, to: node.id, kind: 'contains' });
    return node;
  }

  /**
   * One node per TABLE, not per spelling.
   *
   * A flow definition names a Dataverse table by its entity set — `slakpiinstances` — where an app
   * or another action names the logical `slakpiinstance`, and without the lookup below both became
   * their own node: one table drawn twice, its dependencies split across the two. Dataverse settles
   * it, since both spellings resolve to one MetadataId.
   */
  function tableNode(reference: string): Node {
    const known = tableIds?.get(reference.toLowerCase());
    const name = known?.logicalName ?? reference;
    return addNode({
      id: `table:${name.toLowerCase()}`,
      type: 'table',
      label: name,
      // The portal addresses a table by MetadataId, so a table without one simply has no link.
      url: known
        ? `https://make.powerapps.com/environments/${environment.environmentId}/entities/${known.metadataId}`
        : null,
    });
  }

  // Sites the caller named for us (--site-name) — so a friendlier label than the URL survives.
  for (const site of knownSites) {
    siteNode(site.url);
    for (const listTitle of site.lists) listNode(site.url, listTitle);
  }

  // --- flows -----------------------------------------------------------
  const flowById = new Map<string, Node>();
  for (const flow of flows) {
    const id = `flow:${flow.workflowId ?? flow.flowId ?? flow.key}`;
    const node = addNode({
      id,
      type: 'flow',
      label: flow.name,
      state: flow.state,
      solution: flow.solution?.uniqueName ?? null,
      solutionName: flow.solution?.name ?? null,
      managed: flow.managed,
      workflowId: flow.workflowId,
      flowId: flow.flowId,
      source: flow.source,
      connectors: flow.connectors.map(connectorLabel),
      trigger: flow.trigger
        ? {
          kind: flow.trigger.kind,
          label: flow.trigger.label,
          on: flow.trigger.on,
          conditions: flow.trigger.conditions.map(prettyCondition),
          conditionsRaw: flow.trigger.conditions,
          connector: flow.trigger.connector ? connectorLabel(flow.trigger.connector) : null,
        }
        : null,
      url: flowUrl(flow, environment.environmentId),
    });
    flowById.set(id, node);
    if (flow.workflowId) flowById.set(flow.workflowId.toLowerCase(), node);
    flow.nodeId = id;
  }

  for (const flow of flows) {
    const flowId = flow.nodeId;
    if (!flowId) continue;

    if (flow.trigger?.kind === 'sharepoint') {
      const list = listNode(flow.trigger.site, flow.trigger.list,
        { isGuid: flow.trigger.listIsGuid, envVar: flow.trigger.listParam?.schemaName });
      if (list) {
        addEdge({
          from: list.id,
          to: flowId,
          kind: 'triggers',
          label: flow.trigger.label,
          on: flow.trigger.on,
          conditions: flow.trigger.conditions.map(prettyCondition),
          refiredBy: refiredBy(flow.trigger),
        });
      } else {
        notes.push(msg('warnTriggerUnresolved', { flow: flow.name }));
      }
    } else if (flow.trigger?.kind === 'dataverse' && flow.trigger.table) {
      addEdge({
        from: tableNode(flow.trigger.table).id,
        to: flowId,
        kind: 'triggers',
        label: flow.trigger.label,
        on: flow.trigger.on,
        conditions: flow.trigger.conditions.map(prettyCondition),
        refiredBy: refiredBy(flow.trigger),
      });
    }

    for (const operation of flow.operations) {
      const target = operation.table
        ? tableNode(operation.table)
        : listNode(operation.site, operation.list,
          { isGuid: operation.listIsGuid, envVar: operation.listParam?.schemaName });
      if (!target) continue;
      addEdge({ from: flowId, to: target.id, kind: operation.verb, actions: [prettyAction(operation.action)] });
    }

    for (const child of flow.childFlows) {
      const target = flowById.get(child.workflowId.toLowerCase());
      if (target) addEdge({ from: flowId, to: target.id, kind: 'calls', actions: [prettyAction(child.action)] });
      else notes.push(msg('warnChildFlowMissing', { flow: flow.name, id: child.workflowId }));
    }
  }

  // --- apps ------------------------------------------------------------
  const flowByName = new Map(flows.map((flow) => [normalizeName(flow.name), flow.nodeId]));
  // Keyed on the identifier form Power Apps stores. A key two flows share is set to null rather
  // than guessed at — a wrong edge is worse than a missing one.
  const flowBySquashed = new Map<string, string | null>();
  for (const flow of flows) {
    const key = flow.nodeId ? squashName(flow.name) : '';
    if (key) flowBySquashed.set(key, flowBySquashed.has(key) ? null : flow.nodeId ?? null);
  }
  const flowByRawId = new Map<string, string>();
  for (const flow of flows) {
    if (flow.nodeId && flow.flowId) flowByRawId.set(flow.flowId.toLowerCase(), flow.nodeId);
    if (flow.nodeId && flow.workflowId) flowByRawId.set(flow.workflowId.toLowerCase(), flow.nodeId);
  }

  for (const app of apps) {
    const id = `app:${app.id}`;
    addNode({
      id,
      type: 'app',
      label: app.name || app.id,
      solution: app.solution?.uniqueName ?? null,
      solutionName: app.solution?.name ?? null,
      connectors: app.connectors.map(connectorLabel),
      url: app.studioUrl,
      source: app.source,
    });

    for (const list of app.lists) {
      const target = list.site
        ? listNode(list.site, list.listId ?? list.name, { isGuid: Boolean(list.listId), envVar: list.envVar })
        : orphanList(list.name);
      if (target) addEdge({ from: id, to: target.id, kind: 'uses' });
    }
    for (const table of app.tables) addEdge({ from: id, to: tableNode(table).id, kind: 'uses' });
    for (const flowRef of app.flows) {
      const target = flowByName.get(normalizeName(flowRef))
        ?? flowByRawId.get(flowRef.toLowerCase())
        ?? flowBySquashed.get(squashName(flowRef)) ?? undefined;
      if (target) addEdge({ from: id, to: target, kind: 'calls' });
    }
  }

  // A flow that can only be started from an app, and that nothing claims. Marked on the node as
  // well as listed — a warning buried in a list of seventeen is not something anyone spots in the
  // diagram, which is where the flow is actually looked at.
  for (const flow of flows) {
    if (flow.trigger?.kind !== 'app') continue;
    const claimed = edges.some((edge) => edge.kind === 'calls' && edge.to === flow.nodeId);
    if (claimed) continue;
    notes.push(msg('warnAppUnknown', { flow: flow.name }));
    const node = flow.nodeId ? nodes.get(flow.nodeId) : null;
    if (node) node.resolved = false;
  }

  // Which solutions actually touch each data source. A list is filed under whichever solution has
  // the most links to it, so this is the evidence behind that call — and a list several solutions
  // write to is a cross-solution dependency worth naming out loud.
  for (const node of nodes.values()) {
    if (node.type !== 'list' && node.type !== 'table') continue;
    const counts = new Map<string, number>();
    for (const edge of edges) {
      const otherId = edge.from === node.id ? edge.to : (edge.to === node.id ? edge.from : null);
      const other = otherId ? nodes.get(otherId) : null;
      if (!other || (other.type !== 'flow' && other.type !== 'app')) continue;
      const name = other.solutionName ?? other.solution;
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    node.usedBy = [...counts.entries()]
      .map(([solution, links]): UsedBySolution => ({ solution, links }))
      .sort((a, b) => b.links - a.links || collator.compare(a.solution, b.solution));
  }

  // Which solutions each node belongs in — computed once, here, and carried in the graph. The
  // diagram draws a shared node once per entry, and `--solution` keeps exactly the entries it wants,
  // so the picture and the filter cannot disagree about what a solution contains.
  assignSolutions([...nodes.values()], edges, collator);

  if (wanted) {
    const { keep, targets } = scopeTo([...nodes.values()], wanted);
    for (const id of [...nodes.keys()]) if (!keep.has(id)) nodes.delete(id);
    // A shared list keeps only the solutions still in scope — otherwise the diagram draws an
    // otherwise empty frame per foreign solution around that one list. Nothing is lost by it:
    // `usedBy` was computed over the whole environment and still names every solution using it.
    for (const node of nodes.values()) {
      node.solutions = (node.solutions ?? []).filter((solution) => targets.has(solution));
    }
  }

  const graph: RawGraph = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    tenant,
    environment,
    scope: wanted ?? null,
    sources,
    nodes: [...nodes.values()].sort(byTypeThenLabel(collator)),
    // Sorted, because the collection order is not stable: the Flow API pages in whatever order it
    // likes, so two runs a minute apart produced the same edges in a different sequence and every
    // diff of two reports was noise. Measured 18.08.2026 — two runs, identical sets, 1109 edges,
    // different order.
    edges: edges
      .filter((edge) => nodes.has(edge.from) && nodes.has(edge.to))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind)),
    warnings: [...new Set(notes)],
    selfTriggers: [],
    cascades: {},
    sharedSources: [],
  };

  graph.selfTriggers = findSelfTriggers(graph);
  graph.cascades = buildCascades(graph);
  graph.sharedSources = graph.nodes
    .filter((node) => (node.usedBy ?? []).length > 1)
    .map((node) => ({ node: node.id, usedBy: node.usedBy ?? [] }));
  return graph;
}

function prettyAction(name: string): string {
  return name.replace(/_/g, ' ').trim();
}

/** `…/sites/FieldService` → `FieldService`; a root site keeps its host rather than the whole URL. */
/**
 * Where the maker opens this flow.
 *
 * A flow that lives in a solution — which is nearly all of them — is addressed THROUGH that
 * solution, by its Dataverse workflow id. The flat `/flows/<id>/details` form only works for the
 * Flow API's own id, which Dataverse-sourced records do not carry, and that is why almost no flow
 * had a link before. A flow in neither gets none rather than a guess.
 */
function flowUrl(flow: FlowRecord, environmentId: string): string | null {
  const portal = `https://make.powerautomate.com/environments/${environmentId}`;
  if (flow.solution?.id && flow.workflowId) return `${portal}/solutions/${flow.solution.id}/flows/${flow.workflowId}`;
  if (flow.flowId) return `${portal}/flows/${flow.flowId}/details`;
  return null;
}

function siteLabel(url: string): string {
  const path = /\/(?:sites|teams)\/([^/]+)/i.exec(url);
  if (path?.[1]) return path[1];
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Which solutions a node belongs in.
 *
 * Only a flow or an app that IS in a solution owns its place. Everything else — lists, tables,
 * sites, and a flow nobody ever added to a solution — has no home of its own, so it belongs in each
 * solution that reaches it, and the diagram draws it once per entry.
 *
 * Three hops from an owner, and deliberately no more. One hop puts a list in every solution whose
 * flows touch it. That is not enough: a flow that was never added to any solution — the kind that
 * writes into somebody's trigger list and will not travel on export — reaches no owner directly, so
 * one hop would leave it alone in the leftovers box while the list it writes to sits in three
 * others. The second hop carries the list's solutions out to such a flow, the third lets that flow
 * pull in the rest of its own edges. Running to a fixpoint instead would smear one busy hub across
 * the whole graph.
 */
function assignSolutions(nodes: Node[], edges: Edge[], collator: Intl.Collator): void {
  const owner = new Map<string, string>();
  for (const node of nodes) {
    const own = node.solutionName ?? node.solution;
    if ((node.type === 'flow' || node.type === 'app') && own) owner.set(node.id, own);
  }

  const derived = new Map<string, Set<string>>();
  const add = (id: string, solution: string): void => {
    const found = derived.get(id) ?? new Set<string>();
    found.add(solution);
    derived.set(id, found);
  };

  for (let hop = 0; hop < 3; hop++) {
    const snapshot = new Map([...derived].map(([id, set]) => [id, new Set(set)]));
    const reach = (id: string): Iterable<string> => (owner.get(id) ? [owner.get(id)!] : snapshot.get(id) ?? []);
    for (const edge of edges) {
      // A site is a container, not a dependency, so it must not carry solutions between the lists
      // that sit on it. Left in, this is the widest leak there is: one site collects every solution
      // that touches ANY of its lists and the next hop hands that whole set back down to all the
      // others, so a list ends up in a solution whose flows never mention it. The pass below still
      // lets a site follow its lists, which is the direction that is wanted.
      if (edge.kind === 'contains') continue;
      if (!owner.has(edge.to)) for (const solution of reach(edge.from)) add(edge.to, solution);
      if (!owner.has(edge.from)) for (const solution of reach(edge.to)) add(edge.from, solution);
    }
  }
  // A site follows the lists it contains, so every box captions its own site block.
  for (const edge of edges) {
    if (edge.kind !== 'contains' || owner.has(edge.from)) continue;
    const own = owner.get(edge.to);
    for (const solution of own ? [own] : derived.get(edge.to) ?? []) add(edge.from, solution);
  }

  for (const node of nodes) {
    const own = owner.get(node.id);
    // No solution reaches it → an EMPTY list, never a caption. Both renderers put their own words
    // on that case; a caption here would be a language in what is otherwise a grouping key, and it
    // would be the German one in an English file.
    node.solutions = own ? [own] : [...(derived.get(node.id) ?? [])].sort(collator.compare);
  }
}

/**
 * The node ids a `--solution` run keeps: exactly what that solution's frame shows in the diagram.
 *
 * A shared list stays — the solution really does depend on it — but the foreign flows hanging off it
 * do not, because a document about one solution should not be half full of another's objects. What
 * that costs is recorded rather than hidden: `usedBy` was computed over the whole environment before
 * this ran, so §7 still names every solution the list belongs to.
 */
function scopeTo(nodes: Node[], wanted: string[]): { keep: Set<string>; targets: Set<string> } {
  const byName = new Map<string, string>();
  for (const node of nodes) {
    const display = node.solutionName ?? node.solution;
    if (!display) continue;
    byName.set(display.toLowerCase(), display);
    if (node.solution) byName.set(node.solution.toLowerCase(), display);
  }

  const targets = new Set<string>();
  const unknown: string[] = [];
  for (const name of wanted) {
    const hit = byName.get(name.trim().toLowerCase());
    if (hit) targets.add(hit);
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    const available = [...new Set(byName.values())].sort().join(', ');
    throw new Error(`No solution called "${unknown.join('", "')}" in this environment. Available: ${available}.`);
  }

  const keep = new Set<string>();
  for (const node of nodes) {
    if ((node.solutions ?? []).some((solution) => targets.has(solution))) keep.add(node.id);
  }
  if (keep.size === 0) throw new Error(`Nothing to report for ${[...targets].join(', ')}.`);
  return { keep, targets };
}

const TYPE_ORDER: Record<string, number> = { site: 0, list: 1, table: 2, flow: 3, app: 4 };

/** Sorting is language-dependent (ä next to a, or after z), so the report's locale decides it. */
/**
 * Type, then label, then id — and the id is not decoration.
 *
 * Two nodes of one type CAN share a label: an environment may hold two cloud flows with the same
 * name. Without the last comparison they tie, the sort keeps whatever order the API happened to
 * deliver, and two runs a minute apart produce byte-different files with identical content.
 */
function byTypeThenLabel(collator: Intl.Collator): (a: Node, b: Node) => number {
  return (a, b) => (TYPE_ORDER[a.type]! - TYPE_ORDER[b.type]!)
    || collator.compare(a.label, b.label)
    || a.id.localeCompare(b.id);
}

/**
 * A flow that writes into its own trigger list re-triggers itself — but only with a write the
 * trigger actually listens for (see `refiredBy`). A "when an item is created" flow that updates
 * that list is not a loop, and reporting it as one buries the real ones.
 */
function findSelfTriggers(graph: RawGraph): SelfTrigger[] {
  const result: SelfTrigger[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== 'triggers') continue;
    const refires = new Set(edge.refiredBy ?? ALL_WRITES);
    const writes = graph.edges.filter((other) => other.from === edge.to
      && other.to === edge.from
      && WRITE_VERBS.has(other.kind)
      && refires.has(other.kind));
    if (writes.length === 0) continue;
    result.push({
      flow: edge.to,
      list: edge.from,
      verbs: writes.map((write) => write.kind),
      actions: writes.flatMap((write) => write.actions ?? []),
      guarded: (edge.conditions ?? []).length > 0,
    });
  }
  return result;
}

/**
 * For every list: what runs when someone writes into it — including the follow-on writes of those
 * flows. Depth-limited, cycles marked instead of followed.
 */
function buildCascades(graph: RawGraph, maxDepth = 4): Record<string, Step[]> {
  const triggersOf = new Map<string, Edge[]>();
  const writesOf = new Map<string, Edge[]>();

  for (const edge of graph.edges) {
    if (edge.kind === 'triggers') {
      triggersOf.set(edge.from, [...(triggersOf.get(edge.from) ?? []), edge]);
    } else if (WRITE_VERBS.has(edge.kind)) {
      writesOf.set(edge.from, [...(writesOf.get(edge.from) ?? []), edge]);
    }
  }

  /**
   * `incoming` is the write that got us here. Only a trigger that listens for THAT verb continues
   * the chain — without it the cascade claimed that updating a list starts a flow which only ever
   * reacts to new items.
   *
   * At the root there is no incoming verb: "when something is written here" is deliberately generic,
   * and each step names the action that starts it anyway.
   */
  function expand(listId: string, seen: Set<string>, depth: number, incoming?: EdgeKind): Step[] {
    return (triggersOf.get(listId) ?? [])
      .filter((triggerEdge) => !incoming || (triggerEdge.refiredBy ?? ALL_WRITES).includes(incoming))
      .map((triggerEdge): Step => {
        const step: Step = {
          flow: triggerEdge.to,
          on: triggerEdge.label,
          conditions: triggerEdge.conditions ?? [],
          writes: [],
        };
        if (depth >= maxDepth) {
          step.truncated = true;
          return step;
        }
        for (const write of writesOf.get(triggerEdge.to) ?? []) {
          // Only a write something actually listens for can close a loop; otherwise this is a
          // dead end, not a cycle.
          const continues = (triggersOf.get(write.to) ?? [])
            .some((next) => (next.refiredBy ?? ALL_WRITES).includes(write.kind));
          const cycle = continues && seen.has(write.to);
          step.writes.push({
            list: write.to,
            verb: write.kind,
            actions: write.actions ?? [],
            cycle,
            next: cycle ? [] : expand(write.to, new Set([...seen, write.to]), depth + 1, write.kind),
          });
        }
        return step;
      });
  }

  const cascades: Record<string, Step[]> = {};
  for (const listId of triggersOf.keys()) cascades[listId] = expand(listId, new Set([listId]), 0);
  return cascades;
}

export function nodeMap<T>(graph: { nodes: GraphNode<T>[] }): Map<string, GraphNode<T>> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}
