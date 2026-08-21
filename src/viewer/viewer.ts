/*
 * Viewer for the environment graph: a lane layout grouped by solution, edges channelled along the
 * resulting grid, a list-centric focus view and a side panel that answers "what happens when
 * something is written here".
 *
 * This file is inlined into the generated HTML as a CLASSIC <script>, so it must compile to a file
 * without a single import or export statement — only `import type` is allowed here.
 */
import type {
  CascadeStep, EdgeKind, Graph, GraphEdge, GraphNode, NodeType,
} from '../types.js';
import type { MessageKey, MessageParams, Messages } from '../i18n/messages.js';

(() => {
  const must = <T extends Element>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing element #${id}`);
    return element as unknown as T;
  };

  const graph: Graph = JSON.parse(must<HTMLScriptElement>('graph-data').textContent ?? '{}') as Graph;

  /*
   * Wording comes from the catalogue the generator embedded next to the data, so the page needs no
   * network and no build step to be readable in another language.
   *
   * `format` below is a COPY of the one in src/i18n/messages.ts. It has to be — this file is
   * inlined as a classic script and cannot import at runtime. i18n.test.mjs runs both over the same
   * cases so the two cannot drift apart unnoticed.
   */
  const i18n = JSON.parse(must<HTMLScriptElement>('graph-i18n').textContent ?? '{}') as {
    locale: string;
    messages: Messages;
  };

  const t = (key: MessageKey, params: MessageParams = {}): string => {
    let text = i18n.messages[key] ?? key;
    // `|` alone does not make a plural — see isPlural in src/i18n/messages.ts.
    if (text.includes('|') && text.includes('{count}')) {
      const [one = '', other = ''] = text.split('|');
      const count = params['count'];
      text = typeof count === 'number' && new Intl.PluralRules(i18n.locale).select(count) === 'one'
        ? one : other;
    }
    return text.replace(/\{(\w+)\}/g, (match: string, name: string) => {
      const value = params[name];
      return value === undefined ? match : String(value);
    });
  };

  const svg = must<SVGSVGElement>('scene');
  const scene = must<SVGGElement>('scene-root');
  const panel = must<HTMLElement>('panel');
  const search = must<HTMLInputElement>('search');
  const solutionPicker = must<HTMLSelectElement>('solution');
  const unfocusButton = must<HTMLButtonElement>('unfocus');
  const filterCount = must<HTMLElement>('filter-count');

  const TYPE_KEY: Record<NodeType, MessageKey> = {
    site: 'typeSite',
    list: 'typeList',
    table: 'typeTable',
    flow: 'typeFlow',
    app: 'typeApp',
  };
  /**
   * One synthetic edge kind the graph itself does not have: the link between two instances of the
   * same node. It exists only in the picture, so it lives here and never in graph.json.
   */
  const MIRROR = 'mirrors';
  type ViewEdgeKind = EdgeKind | typeof MIRROR;

  const VERB_KEY: Record<ViewEdgeKind, MessageKey> = {
    triggers: 'verbTriggers',
    creates: 'verbCreates',
    updates: 'verbUpdates',
    deletes: 'verbDeletes',
    reads: 'verbReads',
    other: 'verbOther',
    uses: 'verbUses',
    calls: 'verbCalls',
    contains: 'verbContains',
    mirrors: 'verbMirrors',
  };
  const typeLabel = (type: NodeType): string => t(TYPE_KEY[type]);
  const verb = (kind: ViewEdgeKind): string => t(VERB_KEY[kind]);
  const allOf = (parts: readonly string[]): string => parts.join(` ${t('uiAnd')} `);
  const COLOR: Record<NodeType, string> = {
    site: 'var(--sharepoint)',
    list: 'var(--sharepoint)',
    table: 'var(--dataverse)',
    flow: 'var(--flow)',
    app: 'var(--app)',
  };
  const NO_SOLUTION = t('uiNoSolutionGroup');
  /**
   * A flow's state arrives as a machine value — `enabled` / `disabled` — because a query has to
   * survive the report language. Here, where a person is reading, it becomes a word. The same two
   * lines live in graph/materialize.ts for the Markdown; the viewer cannot import at runtime.
   */
  const stateLabel = (state: string | null | undefined): string => (state === 'enabled' ? t('stateEnabled')
    : state === 'disabled' ? t('stateDisabled') : state ?? '?');
  const WRITE = new Set<ViewEdgeKind>(['creates', 'updates', 'deletes']);
  const READ = new Set<ViewEdgeKind>(['reads']);
  // "other" is an operation we could not classify — most of them are "Send an HTTP request to
  // SharePoint", which may well write. Counting them as reads would understate the risk, counting
  // them as writes would overstate it, so they stay their own category everywhere.
  const TOUCH = new Set<ViewEdgeKind>(['other']);

  type EdgeGroup = 'triggers' | 'writes' | 'reads' | 'app' | 'contains' | 'mirrors';
  const EDGE_GROUP: Record<ViewEdgeKind, EdgeGroup> = {
    triggers: 'triggers',
    creates: 'writes',
    updates: 'writes',
    deletes: 'writes',
    reads: 'reads',
    other: 'reads',
    uses: 'app',
    calls: 'app',
    contains: 'contains',
    mirrors: 'mirrors',
  };

  // --- geometry. The routing depends on these, so they are derived from each other, not tuned
  // independently (see channelPath).
  const NODE_H = 30;
  const CELL_GAP_X = 30;
  // How far an edge runs straight out of a node before it turns. Sized so the run INTO a node
  // (CHANNEL − 4px stand-off) still holds the corner radius (7px) plus the whole arrowhead (9px):
  // 20 − 4 = 16 = 7 + 9. Below that the head starts inside the bend and the route looks kinked.
  const CHANNEL = 20;
  // The free band between two rows is exactly two channels tall, so the channel below one row and
  // the channel above the next are the SAME line — that is what lets an edge between neighbouring
  // rows collapse into a single straight sideways run instead of taking a small jog.
  const CELL_H = NODE_H + CHANNEL * 2;
  const LANE_GAP = 56;
  const BLOCK_GAP = 26;
  const CAPTION_H = 22;

  const NS = 'http://www.w3.org/2000/svg';
  const el = <T extends SVGElement>(name: string, attrs: Record<string, string | number> = {}): T => {
    const node = document.createElementNS(NS, name) as T;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };

  // ---------------------------------------------------------------- model
  interface LayoutNode extends GraphNode {
    /** The graph node this is an instance of. Several instances can share one `sourceId`. */
    sourceId: string;
    /** How many instances that source has in total — 1 for everything that is not shared. */
    copies: number;
    w: number;
    h: number;
    x: number;
    y: number;
    cell: number;
    group: string;
    hidden: boolean;
    tie: number;
    el: SVGGElement;
  }

  interface LayoutEdge extends Omit<GraphEdge, 'kind'> {
    kind: ViewEdgeKind;
    /** The instances this edge belongs to — which solution's box it is drawn inside. */
    a: LayoutNode;
    b: LayoutNode;
    /**
     * Where it is actually DRAWN. Identical to a/b in the solution view; the focus view collapses
     * every instance back onto one node, and then these point at that one.
     */
    va: LayoutNode;
    vb: LayoutNode;
    curved: boolean;
    visible: boolean;
    el: SVGPathElement;
  }

  const groupLayer = el<SVGGElement>('g');
  const edgeLayer = el<SVGGElement>('g', { class: 'edges' });
  const nodeLayer = el<SVGGElement>('g');
  scene.append(groupLayer, edgeLayer, nodeLayer);

  const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

  /*
   * ── Instances ─────────────────────────────────────────────────────────────
   *
   * A cloud flow or a canvas app belongs to exactly one solution. A SharePoint list, a Dataverse
   * table or a site does not — it belongs wherever something reaches it, and the interesting ones
   * are reached from several solutions at once.
   *
   * Filing such a node under ONE solution leaves every other solution's box incomplete: part of
   * what it depends on sits elsewhere on the canvas. So a shared node is drawn once per solution
   * that uses it — each copy an INSTANCE of the same underlying node, with the same `sourceId`,
   * its own id, and only the edges belonging to its solution.
   *
   * The copies never pretend to be separate things: each sits on an offset outline, a dotted edge
   * runs between them, and selecting one lights up all of them at once.
   */
  /*
   * The assignment itself is made by the graph builder and travels in the data, so the diagram
   * and `--solution` cannot disagree about what a solution contains — and graph.json can be read
   * to see where any node was filed.
   */
  const NODE_SOLUTIONS = new Map<string, string[]>(
    graph.nodes.map((node) => [node.id, node.solutions?.length ? node.solutions : [NO_SOLUTION]]),
  );

  const byId = new Map<string, LayoutNode>();
  const bySource = new Map<string, LayoutNode[]>();
  const nodes: LayoutNode[] = [];

  for (const raw of graph.nodes) {
    const groups = NODE_SOLUTIONS.get(raw.id) ?? [NO_SOLUTION];
    const copies = groups.map((group) => buildNode(raw, group, groups.length));
    for (const node of copies) {
      nodes.push(node);
      byId.set(node.id, node);
    }
    bySource.set(raw.id, copies);
  }

  const instances = (sourceId: string): LayoutNode[] => bySource.get(sourceId) ?? [];
  /** The instance a link points at when the solution does not matter: panels, chips, focus view. */
  const primary = (sourceId: string): LayoutNode | undefined => bySource.get(sourceId)?.[0];

  function buildNode(raw: GraphNode, group: string, copies: number): LayoutNode {
    /*
     * `resolved: false` marks a reference that leads nowhere — a list GUID that is not on its site,
     * or a flow nothing claims to call. Both get the same mark; the panel explains per type.
     *
     * For a list the label is swapped for the environment variable that sets it: a GUID cannot be
     * searched for and does not say where to fix the problem. A flow keeps its own name.
     */
    const broken = raw.resolved === false && (raw.type === 'list' || raw.type === 'flow');
    const label = (broken && raw.envVar) || raw.label || raw.id;
    const element = el<SVGGElement>('g', {
      class: broken ? 'node broken' : 'node', 'data-type': raw.type, tabindex: '0', role: 'button',
    });
    // One height for every node — the routing bands are derived from it, so a shorter site node
    // would put its channel on a different line than its neighbours' and break the collapse.
    const node: LayoutNode = {
      ...raw,
      // A single-instance node keeps the graph's own id, so cascades, self-triggers and every other
      // canonical reference still resolve directly; only a shared node needs a per-solution id.
      id: copies > 1 ? `${raw.id}@@${group}` : raw.id,
      sourceId: raw.id,
      copies,
      label,
      w: Math.min(232, Math.max(60, label.length * 6.9 + 24)),
      h: NODE_H,
      x: 0,
      y: 0,
      cell: 0,
      group,
      hidden: false,
      tie: 0,
      el: element,
    };

    const box = {
      x: -node.w / 2, y: -node.h / 2, width: node.w, height: node.h, rx: raw.type === 'flow' ? node.h / 2 : 6,
    };
    // An offset outline behind the node reads as "there are more of me" at any zoom level — drawn
    // first so the node itself sits on top of it.
    if (copies > 1) element.append(el('rect', { ...box, class: 'replica-ghost', x: box.x + 4, y: box.y - 4 }));
    element.append(el('rect', box));
    // Outside the box, not inside it: the label is centred and runs to both edges, and a badge that
    // overlaps a truncated name costs more than it says.
    if (broken) {
      const badge = el<SVGTextElement>('text', { class: 'broken-mark', x: -node.w / 2 - 9, y: 0, 'text-anchor': 'middle' });
      badge.textContent = '!';
      element.append(badge);
    }

    const text = el<SVGTextElement>('text', { 'text-anchor': 'middle' });
    text.textContent = truncate(label, raw.type === 'site' ? 24 : 30);
    element.append(text);

    /*
     * A bar standing in for the label while zoomed out: an empty box reads as empty, a bar as a name
     * too small to make out. It must be CHEAPER than the text it replaces — a rect has no font
     * metrics, shaping or glyph rasterising — and its length follows the node width, so long names
     * get long bars.
     */
    const stub = Math.max(node.w - 26, 12);
    element.append(el('rect', {
      class: 'label-stub', x: -stub / 2, y: -2.5, width: stub, height: 5, rx: 2.5,
    }));

    const title = el<SVGTitleElement>('title');
    const why = raw.type === 'flow'
      ? t('uiOrphanBody')
      : t('uiUnresolvedBody', { listId: raw.listId ?? raw.label });
    title.textContent = `${typeLabel(raw.type)}: ${label}\n${group}`
      + (broken ? `\n${why}` : '')
      + (copies > 1 ? `\n${t('uiSameInstanceIn', { count: copies })}` : '');
    element.append(title);

    element.addEventListener('click', (event) => {
      event.stopPropagation();
      // A pan that happens to end on a node must not move the selection onto it.
      if (!wasDrag()) select(node.id);
    });
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(node.id); }
    });
    nodeLayer.append(element);
    return node;
  }

  const marker = (kind: ViewEdgeKind): string => {
    if (kind === 'contains' || kind === MIRROR) return '';
    if (kind === 'triggers') return 'url(#arrow-flow)';
    if (kind === 'uses' || kind === 'calls') return 'url(#arrow-app)';
    return 'url(#arrow-muted)';
  };

  const edges: LayoutEdge[] = [];

  function connect(base: Omit<GraphEdge, 'kind'>, kind: ViewEdgeKind,
    a: LayoutNode, b: LayoutNode, title: string): void {
    const element = el<SVGPathElement>('path', { class: `edge ${kind}`, 'marker-end': marker(kind) });
    const label = el<SVGTitleElement>('title');
    label.textContent = title;
    element.append(label);
    edgeLayer.append(element);
    edges.push({ ...base, kind, a, b, va: a, vb: b, curved: false, visible: true, el: element });
  }

  for (const raw of graph.edges) {
    if (raw.from === raw.to) continue;
    const from = instances(raw.from);
    const to = instances(raw.to);
    if (from.length === 0 || to.length === 0) continue;

    // An edge is drawn inside EVERY solution where both ends exist — that is what makes a box
    // complete on its own. Where the two never meet in one solution, it is drawn once between the
    // primary instances and crosses the boxes, as it must.
    const paired = from
      .map((a) => [a, to.find((b) => b.group === a.group)] as const)
      .filter((pair): pair is readonly [LayoutNode, LayoutNode] => pair[1] !== undefined);
    const pairs = paired.length > 0 ? paired : [[from[0]!, to[0]!] as const];
    for (const [a, b] of pairs) connect(raw, raw.kind, a, b, `${a.label} ${verb(raw.kind)} ${b.label}`);
  }

  // "These are one thing" — a chain, not a clique: n−1 quiet links instead of n(n−1)/2.
  for (const copies of bySource.values()) {
    for (let i = 1; i < copies.length; i++) {
      const a = copies[i - 1]!;
      const b = copies[i]!;
      connect({ from: a.sourceId, to: b.sourceId }, MIRROR, a, b,
        `${a.label} — ${t('uiSameInstanceIn', { count: copies.length })}`);
    }
  }
  for (const edge of edges) edge.curved = edges.some((other) => other.a === edge.b && other.b === edge.a);

  // Adjacency at SOURCE level: what a node is related to does not depend on which copy you clicked.
  const neighbours = new Map<string, Set<string>>(graph.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of graph.edges) {
    neighbours.get(edge.from)?.add(edge.to);
    neighbours.get(edge.to)?.add(edge.from);
  }
  const neighboursOf = (sourceId: string): Set<string> => neighbours.get(sourceId) ?? new Set<string>();

  const solutions = [...new Set(nodes.map((node) => node.group))].sort((a, b) => a.localeCompare(b, i18n.locale));

  // ---------------------------------------------------------------- layout
  interface Lane {
    key: string;
    types: NodeType[];
    split?: (node: LayoutNode) => string;
    caption?: (key: string) => string;
  }

  // A lane may split into blocks. The data lane splits by SITE: which list sits on which site is
  // otherwise only readable by tracing edges that all run on top of each other.
  const LANES: Lane[] = [
    { key: 'apps', types: ['app'] },
    { key: 'flows', types: ['flow'] },
    {
      key: 'data',
      types: ['list', 'table'],
      split: (node) => (node.type === 'table' ? '@dataverse' : node.siteId ?? '@nosite'),
      /*
       * `siteId` is a SOURCE id, so it has to be looked up through `primary`: a site that appears
       * in several solutions is stored under a per-solution instance id and `byId` misses it. Left
       * as a plain `byId` lookup, every list on a shared site was captioned "no site" — the same
       * words as a list whose site is genuinely unknown, which reads as a resolution failure in
       * the data rather than as the lookup bug it was.
       */
      caption: (key) => (key === '@dataverse' ? t('uiDataverse')
        : key === '@nosite' ? t('uiWithoutSite')
        : (byId.get(key) ?? primary(key))?.label ?? t('uiWithoutSite')),
    },
    { key: 'sites', types: ['site'] },
  ];

  interface Caption { text: string; x: number; y: number; centred?: boolean }
  interface GroupBox {
    name: string;
    members: LayoutNode[];
    captions: Caption[];
    local: Bounds;
    x: number;
    y: number;
    width: number;
    height: number;
  }
  interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

  let live: { nodes: LayoutNode[]; edges: LayoutEdge[] } = { nodes: [], edges: [] };
  let boxes: GroupBox[] = [];
  // Which routing the current layout supports. The lane layout produces a grid, so edges can be
  // channelled along it; the focus layout is a star and gets straight lines.
  let routing: 'orthogonal' | 'direct' = 'direct';

  function bbox(members: readonly LayoutNode[]): Bounds {
    const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const node of members) {
      box.minX = Math.min(box.minX, node.x - node.w / 2);
      box.maxX = Math.max(box.maxX, node.x + node.w / 2);
      box.minY = Math.min(box.minY, node.y - node.h / 2);
      box.maxY = Math.max(box.maxY, node.y + node.h / 2);
    }
    return box;
  }

  /**
   * A lane as one block, or — when the lane declares a split — several captioned blocks. The order
   * the barycentre produced is preserved inside each block, and the blocks follow the average
   * position of their members, so a block still sits under the flows that use it.
   */
  function splitLane(lane: Lane, items: LayoutNode[]): Array<{ name: string; items: LayoutNode[] }> {
    const { split, caption } = lane;
    if (!split || !caption) return [{ name: '', items }];

    const groups = new Map<string, { key: string; items: LayoutNode[]; order: number }>();
    items.forEach((node, index) => {
      const key = split(node);
      const group = groups.get(key) ?? { key, items: [], order: 0 };
      group.items.push(node);
      group.order += index;
      groups.set(key, group);
    });

    // Even a single block gets its caption — "which site does this sit on" is worth 22px.
    return [...groups.values()]
      .map((group) => ({ name: caption(group.key), items: group.items, order: group.order / group.items.length }))
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, i18n.locale));
  }

  /**
   * Inside one group: one lane per node type, and within a lane the order is decided by the
   * BARYCENTRE of each node's neighbours in the other lanes — the standard layered-graph heuristic.
   * A flow lands above the lists it touches, and two flows sharing a list end up side by side.
   */
  function laneLayout(members: LayoutNode[], links: LayoutEdge[]): Caption[] {
    const laneOf = new Map<string, string>();
    const lanes = LANES
      .map((lane) => ({ lane, items: members.filter((node) => lane.types.includes(node.type)) }))
      .filter((entry) => entry.items.length > 0);

    for (const entry of lanes) {
      entry.items.sort((a, b) => a.label.localeCompare(b.label, i18n.locale));
      for (const node of entry.items) laneOf.set(node.id, entry.lane.key);
    }

    const adjacency = new Map<string, string[]>(members.map((node) => [node.id, []]));
    for (const edge of links) {
      adjacency.get(edge.from)?.push(edge.to);
      adjacency.get(edge.to)?.push(edge.from);
    }

    // Normalised position inside its lane, so lanes of different length stay comparable.
    const place = new Map<string, number>();
    const reindex = (): void => {
      for (const entry of lanes) {
        const last = Math.max(1, entry.items.length - 1);
        entry.items.forEach((node, i) => place.set(node.id, i / last));
      }
    };
    reindex();

    for (let sweep = 0; sweep < 8; sweep++) {
      const order = sweep % 2 ? [...lanes].reverse() : lanes;
      for (const entry of order) {
        const score = new Map<string, number>();
        entry.items.forEach((node, index) => {
          const outside = (adjacency.get(node.id) ?? [])
            .filter((id) => laneOf.get(id) && laneOf.get(id) !== entry.lane.key);
          const current = place.get(node.id) ?? 0;
          score.set(node.id, outside.length > 0
            ? outside.reduce((sum, id) => sum + (place.get(id) ?? 0), 0) / outside.length
            : current);
          node.tie = index;
        });
        entry.items.sort((a, b) => (score.get(a.id) ?? 0) - (score.get(b.id) ?? 0) || a.tie - b.tie);
      }
      reindex();
    }

    const cellWidth = Math.max(...members.map((node) => node.w)) + CELL_GAP_X;
    const widest = Math.max(...lanes.map((entry) => entry.items.length));
    const columns = Math.min(9, Math.max(2, Math.ceil(Math.sqrt(widest * 1.5))));

    const captions: Caption[] = [];
    let y = 0;
    for (const entry of lanes) {
      for (const block of splitLane(entry.lane, entry.items)) {
        if (block.name) {
          y += CAPTION_H;
          // x is fixed up below, once every node has a position.
          captions.push({ text: block.name, x: 0, y: y - NODE_H / 2 - 8 });
        }
        const rows = Math.ceil(block.items.length / columns);
        for (let row = 0; row < rows; row++) {
          const inRow = block.items.slice(row * columns, (row + 1) * columns);
          // A partial row is centred by WHOLE cells, never by half a cell: every node centre has
          // to stay on the same lattice across all rows, blocks and lanes, or the gutter the
          // router runs in is a node centre one row further up.
          const offset = Math.floor((columns - inRow.length) / 2) * cellWidth;
          inRow.forEach((node, i) => {
            node.x = offset + i * cellWidth;
            node.y = y + row * CELL_H;
            // Half a cell to either side of a node is the free gutter between columns — that is
            // where the router is allowed to run vertically past other rows.
            node.cell = cellWidth;
          });
        }
        y += rows * CELL_H + (block.name ? BLOCK_GAP : 0);
      }
      y += LANE_GAP;
    }

    /*
     * All block captions share one left rail: the leftmost node edge in the whole box. Deriving x
     * from the CELL puts the caption outside the frame whenever a block's nodes are narrower than
     * the widest node in the box — a cell is as wide as the longest label anywhere in the solution,
     * while the frame is drawn around the node RECTANGLES.
     */
    const left = bbox(members).minX;
    for (const caption of captions) caption.x = left;
    return captions;
  }

  /** Lay every solution out on its own, then pack the resulting blocks into rows. */
  function clusterLayout(): void {
    routing = 'orthogonal';
    const grouped = new Map<string, LayoutNode[]>();
    for (const node of live.nodes) grouped.set(node.group, [...(grouped.get(node.group) ?? []), node]);

    boxes = [...grouped.entries()]
      .map(([name, members]): GroupBox => ({
        name, members, captions: [], local: bbox(members), x: 0, y: 0, width: 0, height: 0,
      }))
      .sort((a, b) => b.members.length - a.members.length || a.name.localeCompare(b.name, i18n.locale));

    for (const box of boxes) {
      const inside = new Set(box.members.map((node) => node.id));
      box.captions = laneLayout(box.members, live.edges.filter((e) => inside.has(e.from) && inside.has(e.to)));
      box.local = bbox(box.members);
    }

    const PAD = 34;
    const GAP = 88;
    const sized = boxes.map((box) => ({
      box,
      width: box.local.maxX - box.local.minX + PAD * 2,
      height: box.local.maxY - box.local.minY + PAD * 2 + 26,
    }));

    /*
     * Shelf packing. Boxes are shelved TALLEST FIRST, because a shelf is as tall as its tallest
     * member and a 900px box beside a 200px one wastes the difference across the whole row.
     *
     * The row width is SEARCHED rather than computed: √(area × aspect) assumes the shelves pack
     * perfectly, which they do not. Packing two dozen boxes is cheap, so the shelving runs at a
     * range of widths and the result closest to the window's proportions wins.
     */
    sized.sort((a, b) => b.height - a.height || b.box.members.length - a.box.members.length
      || a.box.name.localeCompare(b.box.name, i18n.locale));

    const rect = svg.getBoundingClientRect();
    const aspect = rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9;

    /** Where each box lands at a given row width, plus what the whole thing then measures. */
    const shelve = (rowWidth: number): { at: Array<{ x: number; y: number }>; w: number; h: number } => {
      const at: Array<{ x: number; y: number }> = [];
      let cursorX = 0;
      let cursorY = 0;
      let rowHeight = 0;
      let widest = 0;
      for (const { width, height } of sized) {
        if (cursorX > 0 && cursorX + width > rowWidth) {
          cursorX = 0;
          cursorY += rowHeight + GAP;
          rowHeight = 0;
        }
        at.push({ x: cursorX, y: cursorY });
        cursorX += width + GAP;
        rowHeight = Math.max(rowHeight, height);
        widest = Math.max(widest, cursorX - GAP);
      }
      return { at, w: widest, h: cursorY + rowHeight };
    };

    const widest = Math.max(...sized.map((entry) => entry.width));
    const total = sized.reduce((sum, entry) => sum + entry.width + GAP, 0);
    let best = shelve(total);
    let bestScore = Infinity;
    for (let step = 0; step <= 24; step++) {
      const candidate = widest + ((total - widest) * step) / 24;
      if (candidate < widest) continue;
      const packed = shelve(candidate);
      // Distance in log space, so "twice as wide as it should be" and "half as wide" cost the same.
      const score = Math.abs(Math.log((packed.w / packed.h) / aspect));
      if (score < bestScore) { bestScore = score; best = packed; }
    }

    sized.forEach(({ box, width, height }, index) => {
      const { x, y } = best.at[index]!;
      const dx = x + PAD - box.local.minX;
      const dy = y + PAD + 26 - box.local.minY;
      for (const node of box.members) { node.x += dx; node.y += dy; }
      for (const caption of box.captions) { caption.x += dx; caption.y += dy; }
      box.x = x;
      box.y = y;
      box.width = width;
      box.height = height;
    });
    drawGroups();
  }

  interface RoleBuckets {
    writes: LayoutNode[];
    triggers: LayoutNode[];
    reads: LayoutNode[];
    touches: LayoutNode[];
    apps: LayoutNode[];
    writesBack: number;
  }

  /**
   * Who does what around one data source. The roles are exclusive and ranked — a flow that
   * triggers *and* writes back counts as a trigger, a flow that writes without triggering is a
   * writer, and only what does neither is a reader. Used by the focus view and the side panel, so
   * both tell the same story.
   */
  function rolesAround(centre: LayoutNode): RoleBuckets {
    type Role = 'writes' | 'triggers' | 'reads' | 'touches' | 'apps';
    const rank: Record<Role, number> = { apps: 5, triggers: 4, writes: 3, touches: 2, reads: 1 };
    const role = new Map<string, Role>();

    // Roles are read across ALL instances of the node and keyed by the other end's source, so the
    // answer is the same whichever copy was clicked — a shared list has one set of relationships,
    // not one per solution.
    const self = centre.sourceId;
    const mine = (edge: LayoutEdge): boolean => edge.a.sourceId === self || edge.b.sourceId === self;

    for (const edge of edges) {
      if (edge.kind === MIRROR || !mine(edge)) continue;
      const outgoing = edge.a.sourceId === self;
      const other = outgoing ? edge.b : edge.a;
      if (other.sourceId === self) continue;

      let kind: Role | null = null;
      if (other.type === 'app' || edge.kind === 'uses' || edge.kind === 'contains') kind = 'apps';
      else if (edge.kind === 'triggers' && outgoing) kind = 'triggers';
      else if (WRITE.has(edge.kind)) kind = 'writes';
      else if (TOUCH.has(edge.kind)) kind = 'touches';
      else if (READ.has(edge.kind)) kind = 'reads';
      if (!kind) continue;

      const current = role.get(other.sourceId);
      if (!current || rank[kind] > rank[current]) role.set(other.sourceId, kind);
    }

    const buckets: RoleBuckets = { writes: [], triggers: [], reads: [], touches: [], apps: [], writesBack: 0 };
    for (const [sourceId, kind] of role) {
      const node = primary(sourceId);
      if (node) buckets[kind].push(node);
    }
    for (const key of ['writes', 'triggers', 'reads', 'touches', 'apps'] as const) {
      buckets[key].sort((a, b) => a.label.localeCompare(b.label, i18n.locale));
    }
    // Writing back only counts when the flow's own trigger listens for that verb — a "when created"
    // flow that updates its list does not restart itself.
    buckets.writesBack = buckets.triggers.filter((flow) => {
      const trigger = edges.find((edge) => edge.kind === 'triggers'
        && edge.a.sourceId === self && edge.b.sourceId === flow.sourceId);
      const refires = new Set<ViewEdgeKind>(trigger?.refiredBy ?? ['creates', 'updates', 'deletes']);
      return edges.some((edge) => edge.a.sourceId === flow.sourceId && edge.b.sourceId === self
        && WRITE.has(edge.kind) && refires.has(edge.kind));
    }).length;
    return buckets;
  }

  interface FocusGroup { items: LayoutNode[]; caption: string; suffix?: string }

  /**
   * The four places around a focused node — left column, right column, bottom row, top row — each
   * with the caption it earns for THIS kind of node.
   *
   * The geometry is the same for every type; the wording is not, because the same arrow means
   * different things at its two ends. "Trigger" around a data source names the flows it starts;
   * around a flow the honest caption is what starts THAT. A slot with nothing in it is left out
   * rather than captioned empty.
   */
  function neighbourhood(centre: LayoutNode): (FocusGroup | null)[] {
    const self = centre.sourceId;
    const group = (items: LayoutNode[], caption: string, suffix = ''): FocusGroup | null =>
      (items.length > 0 ? { items, caption, suffix } : null);

    // Each neighbour appears ONCE, in the first group that claims it, so the picks below are
    // written in order of what matters most about that relationship.
    const seen = new Set<string>();
    const pick = (test: (edge: LayoutEdge, outgoing: boolean) => boolean): LayoutNode[] => {
      const found: LayoutNode[] = [];
      for (const edge of edges) {
        if (edge.kind === MIRROR) continue;
        const outgoing = edge.a.sourceId === self;
        if (!outgoing && edge.b.sourceId !== self) continue;
        const other = outgoing ? edge.b : edge.a;
        if (other.sourceId === self || seen.has(other.sourceId) || !test(edge, outgoing)) continue;
        const node = primary(other.sourceId);
        if (!node) continue;
        seen.add(other.sourceId);
        found.push(node);
      }
      return found.sort((a, b) => a.label.localeCompare(b.label, i18n.locale));
    };

    if (centre.type === 'list' || centre.type === 'table') {
      // The one case with its own ranking, shared with the side panel so both tell one story.
      const roles = rolesAround(centre);
      const bottom = [...roles.reads, ...roles.touches];
      return [
        group(roles.writes, t('uiFocusWrites')),
        group(roles.triggers, t('uiFocusTriggers'),
          roles.writesBack ? t('uiFocusWritesBack', { count: roles.writesBack }) : ''),
        group(bottom, t('uiFocusReads'),
          roles.touches.length ? t('uiFocusUndetermined', { count: roles.touches.length }) : ''),
        group(roles.apps, t('uiFocusApps')),
      ];
    }

    if (centre.type === 'flow') {
      // Whatever points AT the flow starts it — a list through its trigger, an app or a parent flow
      // through a call. One rule, because to the reader they are the same question.
      const starts = pick((edge, outgoing) => !outgoing && (edge.kind === 'triggers' || edge.kind === 'calls'));
      const writes = pick((edge, outgoing) => outgoing && WRITE.has(edge.kind));
      const calls = pick((edge, outgoing) => outgoing && edge.kind === 'calls');
      const reads = pick((edge, outgoing) => outgoing && (READ.has(edge.kind) || TOUCH.has(edge.kind)));
      return [
        group(starts, t('uiFocusStarts')),
        group(writes, t('uiFocusWritesTo')),
        group(reads, t('uiFocusReads')),
        group(calls, t('uiFocusCalls')),
      ];
    }

    if (centre.type === 'app') {
      return [
        group(pick((edge, outgoing) => outgoing && edge.kind === 'uses'), t('uiFocusBinds')),
        group(pick((edge, outgoing) => outgoing && edge.kind === 'calls'), t('uiFocusCalls')),
        null,
        null,
      ];
    }

    return [group(pick((edge, outgoing) => outgoing && edge.kind === 'contains'), t('uiFocusLists')), null, null, null];
  }

  function placeColumn(items: LayoutNode[], side: 1 | -1): void {
    const rows = Math.min(11, items.length) || 1;
    const columns = Math.ceil(items.length / rows) || 1;
    const perColumn = Math.ceil(items.length / columns) || 1;
    items.forEach((node, i) => {
      node.x = side * (360 + Math.floor(i / perColumn) * 285);
      node.y = ((i % perColumn) - (perColumn - 1) / 2) * CELL_H;
    });
  }

  function placeRow(items: LayoutNode[], side: 1 | -1): void {
    const columns = Math.min(6, items.length) || 1;
    items.forEach((node, i) => {
      node.x = ((i % columns) - (columns - 1) / 2) * 265;
      node.y = side * (330 + Math.floor(i / columns) * CELL_H);
    });
  }

  function caption(items: LayoutNode[], text: string, suffix = ''): Caption | null {
    if (items.length === 0) return null;
    const box = bbox(items);
    return {
      text: `${text} (${items.length})${suffix ? ` · ${suffix}` : ''}`,
      x: (box.minX + box.maxX) / 2,
      y: box.minY - 22,
      centred: true,
    };
  }

  /** One node in the middle, everything it deals with around it — see `neighbourhood`. */
  function focusLayout(centre: LayoutNode): void {
    routing = 'direct';
    const [left, right, bottom, top] = neighbourhood(centre);

    centre.x = 0;
    centre.y = 0;
    if (left) placeColumn(left.items, -1);
    if (right) placeColumn(right.items, 1);
    if (bottom) placeRow(bottom.items, 1);
    if (top) placeRow(top.items, -1);

    boxes = [];
    drawGroups([left, right, bottom, top]
      .map((entry) => (entry ? caption(entry.items, entry.caption, entry.suffix) : null))
      .filter((entry): entry is Caption => entry !== null));
  }

  // ---------------------------------------------------------------- drawing
  function drawGroups(extra: Caption[] = []): void {
    groupLayer.replaceChildren();
    const addCaption = (item: Caption, cssClass: string): void => {
      const label = el<SVGTextElement>('text', {
        class: cssClass, x: item.x, y: item.y, ...(item.centred ? { 'text-anchor': 'middle' } : {}),
      });
      label.textContent = item.text;
      groupLayer.append(label);
    };

    for (const box of boxes) {
      groupLayer.append(el('rect', {
        class: 'group-box', x: box.x, y: box.y, width: box.width, height: box.height, rx: 14,
      }));

      /*
       * The solution's name as a watermark across its own frame, for finding a solution in the
       * overview — where every other label has shrunk to a bar.
       *
       * Its size is held at a constant SCREEN size (see --zoom in the stylesheet) rather than a
       * constant world size: one world size cannot serve a zoom range of 0.05 to 0.55, it is either
       * illegible at one end or the size of a house at the other. The cap below stops that from
       * overflowing a narrow frame — 0.58em per character is about right for a bold sans face.
       */
      const headline = el<SVGTextElement>('text', {
        class: 'group-headline',
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });
      headline.style.setProperty('--fit', String(box.width * 0.86 / (0.58 * Math.max(box.name.length, 1))));
      headline.textContent = box.name;
      groupLayer.append(headline);
      const label = el<SVGTextElement>('text', { class: 'group-label', x: box.x + 14, y: box.y + 19 });
      // The shared count is part of the headline: it says how much of this box is also somewhere
      // else, which is exactly what breaks on the next export and import.
      const shared = box.members.filter((node) => node.copies > 1).length;
      label.textContent = `${box.name}  ·  ${box.members.length}`
        + (shared > 0 ? `  ·  ${t('uiGroupShared', { count: shared })}` : '');
      groupLayer.append(label);
      for (const item of box.captions) addCaption(item, 'block-label');
    }
    for (const item of extra) addCaption(item, 'group-label');
  }

  function draw(): void {
    for (const node of live.nodes) node.el.setAttribute('transform', `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`);
    for (const edge of live.edges) edge.el.setAttribute('d', path(edge));
  }

  /** Instances of the same node are never adjacent, so their link is always drawn straight. */
  const isMirror = (edge: LayoutEdge): boolean => edge.kind === MIRROR;

  interface Point { x: number; y: number }

  /** Where a straight line from `node` in direction (dx,dy) leaves its RECTANGLE — not its circle. */
  function border(node: LayoutNode, dx: number, dy: number, pad: number): Point {
    const scaleX = Math.abs(dx) < 1e-6 ? Infinity : (node.w / 2 + pad) / Math.abs(dx);
    const scaleY = Math.abs(dy) < 1e-6 ? Infinity : (node.h / 2 + pad) / Math.abs(dy);
    const scale = Math.min(scaleX, scaleY);
    return { x: node.x + dx * scale, y: node.y + dy * scale };
  }

  function path(edge: LayoutEdge): string {
    // Channelling needs the grid the lane layout builds, and it only holds inside one group.
    const routed = routing === 'orthogonal' && !isMirror(edge)
      && edge.va.group === edge.vb.group && edge.va.cell > 0 && edge.vb.cell > 0;
    return routed ? channelPath(edge.va, edge.vb) : directPath(edge);
  }

  function directPath(edge: LayoutEdge): string {
    const a = edge.va;
    const b = edge.vb;
    const distance = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
    const dx = (b.x - a.x) / distance;
    const dy = (b.y - a.y) / distance;
    const start = border(a, dx, dy, 2);
    const end = border(b, -dx, -dy, 4);
    if (!edge.curved) return `M${point(start)}L${point(end)}`;
    const mid = { x: (start.x + end.x) / 2 - dy * 24, y: (start.y + end.y) / 2 + dx * 24 };
    return `M${point(start)}Q${point(mid)} ${point(end)}`;
  }

  /**
   * Route an edge along the grid instead of straight across it. Always the same five moves:
   *
   *   1. leave `a` vertically into the free band next to its row
   *   2. run sideways in that band
   *   3. change height in the free gutter beside `b`'s column
   *   4. run sideways in the free band next to `b`'s row
   *   5. enter `b` vertically
   *
   * Every step stays in space the layout keeps empty — bands are the gap between two rows, gutters
   * the gap between two columns — so nothing is drawn through a node. Neighbouring rows share one
   * band, which collapses steps 2–4 into a single sideways run: that is the bundled strand out of a
   * list, and it falls out of the formula rather than being a case of its own.
   */
  function channelPath(a: LayoutNode, b: LayoutNode): string {
    const sameRow = Math.abs(b.y - a.y) < 1;
    const away = sameRow ? -1 : Math.sign(b.y - a.y);
    const bandA = a.y + away * (a.h / 2 + CHANNEL);
    const bandB = sameRow ? bandA : b.y - away * (b.h / 2 + CHANNEL);
    const gutter = b.x + (a.x <= b.x ? -1 : 1) * (b.cell / 2);

    return roundedPath([
      { x: a.x, y: a.y + away * (a.h / 2) },
      { x: a.x, y: bandA },
      { x: gutter, y: bandA },
      { x: gutter, y: bandB },
      { x: b.x, y: bandB },
      { x: b.x, y: b.y - (sameRow ? -1 : away) * (b.h / 2 + 4) },
    ], 7);
  }

  /** Corner-rounded polyline. Generic — it does not know what it is drawing. */
  function roundedPath(points: Point[], radius: number): string {
    const keep = points.filter((p, i) => {
      const previous = points[i - 1];
      return !previous || Math.abs(p.x - previous.x) > 0.5 || Math.abs(p.y - previous.y) > 0.5;
    });
    const first = keep[0];
    const last = keep[keep.length - 1];
    if (!first || !last || keep.length < 2) return '';

    let d = `M${point(first)}`;
    for (let i = 1; i < keep.length - 1; i++) {
      const previous = keep[i - 1]!;
      const corner = keep[i]!;
      const next = keep[i + 1]!;
      const r = Math.min(radius, distance(previous, corner) / 2, distance(corner, next) / 2);
      d += `L${point(towards(corner, previous, r))}Q${point(corner)} ${point(towards(corner, next, r))}`;
    }
    return `${d}L${point(last)}`;
  }

  const distance = (p: Point, q: Point): number => Math.hypot(q.x - p.x, q.y - p.y);
  const point = (p: Point): string => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;

  function towards(from: Point, to: Point, r: number): Point {
    const length = distance(from, to) || 1;
    return { x: from.x + ((to.x - from.x) / length) * r, y: from.y + ((to.y - from.y) / length) * r };
  }

  // ---------------------------------------------------------------- camera
  const view = { k: 1, x: 0, y: 0 };
  /*
   * Where detail comes back: a 12px label renders at DETAIL_FLOOR × 12 on screen, set to the point
   * where it becomes legible rather than merely present. The class is written only when the state
   * CHANGES — writing to the DOM every frame is the cost being avoided.
   */
  const DETAIL_FLOOR = 0.55;
  let detail = '';

  /*
   * While the view is moving, the dashed strokes come off (the stylesheet does it, keyed on
   * `data-moving`).
   *
   * A dashed path is rasterised as one quad per dash, so its cost grows with the length of the path
   * AND with the zoom — which is exactly why a big report drags at full detail and is fine zoomed
   * out. The pattern is what tells one kind of edge from another while READING a still picture;
   * during a drag nobody is reading it, and it is back a tenth of a second after letting go.
   *
   * Driven from applyView rather than from the pan handler, so it covers every way the view moves:
   * wheel, drag, minimap, fit.
   */
  const SETTLE_MS = 120;
  let moving = false;
  let settle = 0;

  function markMoving(): void {
    if (!moving) {
      moving = true;
      document.body.dataset['moving'] = '';
    }
    clearTimeout(settle);
    settle = setTimeout(() => {
      moving = false;
      delete document.body.dataset['moving'];
    }, SETTLE_MS);
  }

  const applyView = (): void => {
    markMoving();
    scene.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.k})`);
    // One write per frame; the stylesheet divides by it so anything that should keep a constant
    // screen size can, without this code touching two dozen elements itself.
    document.documentElement.style.setProperty('--zoom', String(view.k));
    const wanted = view.k < DETAIL_FLOOR ? 'low' : 'full';
    if (wanted !== detail) {
      detail = wanted;
      document.body.dataset['detail'] = wanted;
    }
    drawViewport();
  };

  /*
   * ── Minimap ───────────────────────────────────────────────────────────────
   * Drawn from positions the page already holds, so it adds code and no data.
   *
   * It shows the solution FRAMES rather than the nodes: five hundred rectangles at this size are a
   * grey smear, while two dozen frames keep the shape of the layout recognisable. The focus view
   * has no frames and falls back to nodes, of which there are only ever a handful.
   */
  const minimap = must<SVGSVGElement>('minimap');
  const minimapShapes = must<SVGGElement>('minimap-shapes');
  const minimapView = must<SVGRectElement>('minimap-view');
  /** The world rectangle the minimap is currently showing, or null while there is nothing to show. */
  let mapped: Bounds | null = null;

  function drawMinimap(): void {
    if (live.nodes.length === 0) {
      mapped = null;
      minimap.style.display = 'none';
      return;
    }
    minimap.style.display = '';

    const box = bbox(live.nodes);
    const width = Math.max(box.maxX - box.minX, 1);
    const height = Math.max(box.maxY - box.minY, 1);

    /*
     * The inset is measured in MAP pixels: the same number of world units is a third of a small
     * focus view and one pixel of a large environment. Reserving it on both axes first makes the
     * scale computable without circularity — fit the world into the box minus the margins, then
     * express those margins back in world units.
     */
    const INSET = 12;
    const rect = minimap.getBoundingClientRect();
    const usable = Math.min((rect.width - INSET * 2) / width, (rect.height - INSET * 2) / height);
    const pad = usable > 0 ? INSET / usable : Math.max(width, height) * 0.07;
    mapped = { minX: box.minX - pad, minY: box.minY - pad, maxX: box.maxX + pad, maxY: box.maxY + pad };
    // A viewBox does the world→map scaling, so everything below is drawn in world coordinates.
    minimap.setAttribute('viewBox',
      `${mapped.minX} ${mapped.minY} ${mapped.maxX - mapped.minX} ${mapped.maxY - mapped.minY}`);

    minimapShapes.replaceChildren(...(boxes.length > 0
      ? boxes.map((group) => el('rect', {
        class: 'mini-shape', x: group.x, y: group.y, width: group.width, height: group.height, rx: 10,
      }))
      : live.nodes.map((node) => el('rect', {
        class: 'mini-shape', x: node.x - node.w / 2, y: node.y - node.h / 2, width: node.w, height: node.h, rx: 4,
      }))));
    drawViewport();
  }

  /** The slice of the world the canvas is showing, as a rectangle on the map. */
  function drawViewport(): void {
    if (!mapped) return;
    const rect = svg.getBoundingClientRect();
    minimapView.setAttribute('x', (-view.x / view.k).toFixed(1));
    minimapView.setAttribute('y', (-view.y / view.k).toFixed(1));
    minimapView.setAttribute('width', (rect.width / view.k).toFixed(1));
    minimapView.setAttribute('height', (rect.height / view.k).toFixed(1));
  }

  /**
   * Map coordinates → world coordinates. `preserveAspectRatio="xMidYMid meet"` fits the world into
   * the box with ONE scale and letterboxes the spare axis, so the offset has to be undone by hand —
   * without it every click lands short on whichever axis has the bars.
   */
  function worldAt(clientX: number, clientY: number): Point | null {
    if (!mapped) return null;
    const rect = minimap.getBoundingClientRect();
    const width = mapped.maxX - mapped.minX;
    const height = mapped.maxY - mapped.minY;
    const scale = Math.min(rect.width / width, rect.height / height);
    return {
      x: mapped.minX + (clientX - rect.left - (rect.width - width * scale) / 2) / scale,
      y: mapped.minY + (clientY - rect.top - (rect.height - height * scale) / 2) / scale,
    };
  }

  function centreOn(point: Point): void {
    const rect = svg.getBoundingClientRect();
    view.x = rect.width / 2 - point.x * view.k;
    view.y = rect.height / 2 - point.y * view.k;
    applyView();
  }

  let steering = false;
  minimap.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    steering = true;
    minimap.setPointerCapture(event.pointerId);
    const point = worldAt(event.clientX, event.clientY);
    if (point) centreOn(point);
  });
  minimap.addEventListener('pointermove', (event) => {
    if (!steering) return;
    const point = worldAt(event.clientX, event.clientY);
    if (point) centreOn(point);
  });
  const stopSteering = (): void => { steering = false; };
  minimap.addEventListener('pointerup', stopSteering);
  minimap.addEventListener('pointercancel', stopSteering);

  function fit(): void {
    if (live.nodes.length === 0) return;
    const box = bbox(live.nodes);
    const rect = svg.getBoundingClientRect();
    const pad = 70;
    view.k = Math.max(0.08, Math.min(1.4, Math.min(
      (rect.width - pad * 2) / (box.maxX - box.minX || 1),
      (rect.height - pad * 2) / (box.maxY - box.minY || 1),
    )));
    view.x = rect.width / 2 - ((box.minX + box.maxX) / 2) * view.k;
    view.y = rect.height / 2 - ((box.minY + box.maxY) / 2) * view.k;
    applyView();
  }

  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const next = Math.max(0.05, Math.min(4, view.k * Math.exp(-event.deltaY * 0.0016)));
    view.x = px - (px - view.x) * (next / view.k);
    view.y = py - (py - view.y) * (next / view.k);
    view.k = next;
    applyView();
  }, { passive: false });

  /*
   * A drag is not a click: letting go after a pan fires a `click` on the SVG, and a click on empty
   * space clears the selection — so a pan that ends over nothing would deselect what the reader
   * had just picked, and one that ends over a node would select it.
   *
   * So the pointer's travel since it went down is measured, and anything past a few pixels counts
   * as a drag. Registered in the CAPTURE phase so it sees every press regardless of what the press
   * landed on, even if something below stops the event from bubbling.
   */
  const CLICK_SLOP = 4;
  let pressedAt: Point | null = null;
  let travelled = false;

  svg.addEventListener('pointerdown', (event) => {
    pressedAt = { x: event.clientX, y: event.clientY };
    travelled = false;
  }, { capture: true });
  svg.addEventListener('pointermove', (event) => {
    if (!pressedAt) return;
    if (Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > CLICK_SLOP) travelled = true;
  }, { capture: true });

  /** True when the click that is being handled ended a drag. Consumed, so it cannot go stale. */
  const wasDrag = (): boolean => {
    const value = travelled;
    travelled = false;
    return value;
  };

  let panning: Point | null = null;
  svg.addEventListener('pointerdown', (event) => {
    if ((event.target as Element).closest('.node')) return;
    panning = { x: event.clientX - view.x, y: event.clientY - view.y };
    svg.classList.add('dragging');
    svg.setPointerCapture(event.pointerId);
  });
  /*
   * Panning is coalesced into animation frames. A mouse reports movement far more often than the
   * screen redraws — a 1000 Hz pointer against a 60 Hz display means sixteen full repaints of the
   * whole scene for every frame anyone sees, and on a graph this size that is most of the lag.
   */
  let queued: Point | null = null;
  let frame = 0;
  svg.addEventListener('pointermove', (event) => {
    if (!panning) return;
    queued = { x: event.clientX - panning.x, y: event.clientY - panning.y };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!queued) return;
      view.x = queued.x;
      view.y = queued.y;
      applyView();
    });
  });
  const endPan = (): void => {
    panning = null;
    queued = null;
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', endPan);
  svg.addEventListener('pointercancel', endPan);
  svg.addEventListener('click', (event) => {
    if (wasDrag()) return;
    if (!(event.target as Element).closest('.node')) select(null);
  });

  // ---------------------------------------------------------------- panel
  let selected: string | null = null;
  let focused: string | null = null;

  function select(id: string | null): void {
    const node = id ? byId.get(id) : null;
    selected = node && !node.hidden ? node.id : null;
    emphasise();
    renderPanel();
  }

  function emphasise(): void {
    const needle = search.value.trim().toLowerCase();
    // Selection is by SOURCE, not by copy: clicking one instance of a shared list lights up every
    // instance of it: that is how the picture says "one thing, several boxes".
    const active = selected ? byId.get(selected)?.sourceId ?? null : null;

    for (const node of nodes) {
      node.el.classList.toggle('selected', node.id === selected);
      node.el.classList.toggle('sibling', Boolean(active) && node.sourceId === active && node.id !== selected);
      const bySelection = !active || node.sourceId === active || neighboursOf(active).has(node.sourceId);
      const bySearch = !needle || node.label.toLowerCase().includes(needle);
      node.el.classList.toggle('dimmed', !(bySelection && bySearch));
    }
    for (const edge of edges) {
      const touches = Boolean(active) && (edge.a.sourceId === active || edge.b.sourceId === active);
      edge.el.classList.toggle('dimmed', Boolean(active) && !touches);
      // The link between the copies is quiet until one of them is selected, then it is the point.
      edge.el.classList.toggle('active', isMirror(edge) && touches);
    }
  }

  const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeHtml = (value: unknown): string =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

  /**
   * Takes either an instance id or a canonical graph id — cascades and self-triggers carry the
   * canonical one — and always lands on a real instance.
   */
  const chip = (id: string, suffix = ''): string => {
    const node = byId.get(id) ?? primary(id);
    if (!node) return escapeHtml(id);
    return `<button class="chip" data-goto="${escapeHtml(node.id)}">`
      + `<span class="dot" style="background:${COLOR[node.type]}"></span>${escapeHtml(node.label)}`
      + (suffix ? `<span class="verb">${escapeHtml(suffix)}</span>` : '')
      + '</button>';
  };

  // Which panel sections are open. Kept across selections, so a section the reader opened once
  // stays open while they click through the graph.
  const openSections = new Set<string>(['cascade']);

  function section(key: string, title: string, body: string, count?: number): string {
    if (!body) return '';
    return `<details class="sect" data-sect="${escapeHtml(key)}"${openSections.has(key) ? ' open' : ''}>`
      + `<summary><span class="sect-title">${escapeHtml(title)}</span>`
      + `${count != null ? `<span class="count">${count}</span>` : ''}</summary>`
      + `<div class="sect-body">${body}</div></details>`;
  }

  const stat = (value: string | number, label: string): string =>
    `<span class="stat"><b>${escapeHtml(value)}</b> ${escapeHtml(label)}</span>`;
  /**
   * A counted stat, worded by the catalogue so singular and plural agree with the number.
   * The count sits inside the phrase because German puts the noun ending, not the article,
   * under the count — so the number cannot be rendered apart from the words around it. The
   * catalogue supplies the <b> the same way uiUnguardedBanner supplies its <strong>.
   */
  const statOf = (count: number, key: MessageKey): string =>
    `<span class="stat">${t(key, { count })}</span>`;

  function renderPanel(): void {
    const node = selected ? byId.get(selected) : null;
    panel.innerHTML = node ? nodePanel(node) : overviewPanel();

    for (const button of panel.querySelectorAll<HTMLElement>('[data-goto]')) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        select(button.dataset['goto'] ?? null);
      });
    }
    for (const button of panel.querySelectorAll<HTMLElement>('[data-focus]')) {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setFocus(button.dataset['focus'] ?? null);
      });
    }
    for (const details of panel.querySelectorAll<HTMLDetailsElement>('details[data-sect]')) {
      details.addEventListener('toggle', () => {
        const key = details.dataset['sect'];
        if (!key) return;
        if (details.open) openSections.add(key);
        else openSections.delete(key);
      });
    }
  }

  function overviewPanel(): string {
    // Counted per SOURCE, not per drawn instance: a list used by three solutions is drawn three
    // times and is still one list. Counting instances here disagreed with graph.json and the index.
    const counts: Record<string, number> = {};
    const counted = new Set<string>();
    for (const node of nodes) {
      if (counted.has(node.sourceId)) continue;
      counted.add(node.sourceId);
      counts[node.type] = (counts[node.type] ?? 0) + 1;
    }
    const scope = [
      t('countLists', { count: counts['list'] ?? 0 }),
      counts['table'] ? t('countTables', { count: counts['table'] }) : '',
      t('countFlows', { count: counts['flow'] ?? 0 }),
      t('countApps', { count: counts['app'] ?? 0 }),
      t('countSites', { count: counts['site'] ?? 0 }),
    ].filter(Boolean);
    const more = (rest: number): string =>
      (rest > 0 ? `<p class="kind">${escapeHtml(t('uiMoreEntries', { count: rest }))}</p>` : '');

    const unguarded = graph.selfTriggers.filter((entry) => !entry.guarded).length;
    const failed = graph.sources.filter((source) => !source.ok).length;

    // Numbers and findings only. What a frame means, what a colour means and what the doubled
    // outline means are all answered by the legend in the header — repeating them here turned the
    // top of the panel into a paragraph nobody reads twice.
    const parts = [`<h2>${escapeHtml(t('uiOverview'))}</h2>`,
      `<p class="kind">${escapeHtml(graph.tenant)} · ${escapeHtml(graph.environment.name ?? graph.environment.environmentId)}</p>`,
      `<div class="stats">${scope.map((entry) => `<span class="stat">${escapeHtml(entry)}</span>`).join('')}</div>`];

    if (unguarded > 0) {
      parts.push(`<div class="banner">${t('uiUnguardedBanner', { count: unguarded })}</div>`);
    }

    // Flow on its own line, the list it writes back into indented under it — a long name then
    // wraps inside its own chip instead of pushing the ↻ onto a line of its own.
    parts.push(section('self', t('uiSelfTriggers'),
      graph.selfTriggers.length > 0
        ? `<p class="sub">${escapeHtml(t('uiSelfTriggerIntro'))}</p>`
          + graph.selfTriggers.slice(0, 60).map((entry) => `<div class="rel-row">${chip(entry.flow)}`
            + `<div class="loop">↻ ${chip(entry.list)}`
            + `${entry.guarded ? '' : `<strong>${escapeHtml(t('uiWithoutCondition'))}</strong>`}</div></div>`).join('')
          + more(graph.selfTriggers.length - 60)
        : '',
      graph.selfTriggers.length));

    parts.push(section('warn', t('uiUnresolved'),
      graph.warnings.length > 0
        ? graph.warnings.slice(0, 30).map((warning) => `<div class="banner warn">${escapeHtml(warning)}</div>`).join('')
          + more(graph.warnings.length - 30)
        : '',
      graph.warnings.length));

    parts.push(section('sources', `${t('uiSources')}${failed ? ' ⚠' : ''}`,
      `<ul class="rel">${graph.sources.map((source) =>
        `<li>${escapeHtml(source.name)} <span class="verb">${source.ok ? '✓' : '✗'} `
        + `${escapeHtml(source.detail ?? '')}</span></li>`).join('')}</ul>`));

    return parts.join('');
  }

  function nodePanel(node: LayoutNode): string {
    // Counted across every instance and deduplicated, so the numbers describe the NODE rather than
    // the copy that happens to be selected.
    const outgoing = dedupe(edges.filter((edge) => edge.kind !== 'contains' && edge.kind !== MIRROR
      && edge.a.sourceId === node.sourceId));
    const isData = node.type === 'list' || node.type === 'table';
    const parts = [`<h2>${escapeHtml(node.label)}</h2>`,
      `<p class="kind">${escapeHtml(typeLabel(node.type))} · ${escapeHtml(node.group)}</p>`];

    if (isData) {
      const roles = rolesAround(node);
      parts.push('<div class="stats">',
        statOf(roles.triggers.length, 'uiStatStarts'),
        statOf(roles.writes.length, 'uiStatWritesOnly'),
        statOf(roles.reads.length, 'uiStatReads'),
        roles.touches.length ? statOf(roles.touches.length, 'uiStatUndetermined') : '',
        roles.apps.length ? statOf(roles.apps.length, 'uiStatApps') : '',
        '</div>');
      if (roles.writesBack > 0) {
        parts.push(`<p class="sub">${escapeHtml(t('uiWritesBack', { count: roles.writesBack }))}</p>`);
      }
      if (roles.triggers.length === 0) {
        parts.push(`<p class="sub">${escapeHtml(t('uiNoTriggerHere'))}</p>`);
      }
      if (node.resolved === false) {
        parts.push(`<div class="banner">${t('uiUnresolvedTitle')} `
          + escapeHtml(t('uiUnresolvedBody', { listId: node.listId ?? node.label }))
          + `<br>${escapeHtml(node.envVar
            ? t('uiUnresolvedVia', { envVar: node.envVar })
            : t('uiUnresolvedNoVar'))}</div>`);
      }
      // Driven by usedBy rather than by how many copies are on screen: a report narrowed to one
      // solution draws the list once, and that is exactly when "four other solutions also write
      // here" is the thing the reader must not miss.
      if ((node.usedBy ?? []).length > 1) {
        parts.push(`<div class="banner warn">${t('uiSharedTitle')} ${escapeHtml(t('uiSharedBody'))}<br>`
          + (node.usedBy ?? []).map((entry) =>
            `${escapeHtml(entry.solution)} <span class="verb">${entry.links}</span>`).join(' · ')
          + '</div>');
      }
    }

    if (node.type === 'flow') {
      if (node.resolved === false) {
        parts.push(`<div class="banner">${t('uiOrphanTitle')} ${escapeHtml(t('uiOrphanBody'))}</div>`);
      }
      const trigger = edges.find((edge) => edge.kind === 'triggers' && edge.b.sourceId === node.sourceId);
      parts.push(`<p class="lead">${escapeHtml(node.trigger?.label ?? t('uiTriggerUnknown'))}`
        + `${trigger ? ` · ${chip(trigger.a.id)}` : ''}</p>`);
      for (const condition of node.trigger?.conditions ?? []) {
        parts.push(`<p class="cond">${escapeHtml(t('uiOnlyIf'))} <code>${escapeHtml(condition)}</code></p>`);
      }
      const count = (test: (edge: LayoutEdge) => boolean): number => outgoing.filter(test).length;
      parts.push('<div class="stats">',
        stat(stateLabel(node.state), ''),
        statOf(count((edge) => WRITE.has(edge.kind)), 'uiStatWrites'),
        statOf(count((edge) => READ.has(edge.kind)), 'uiStatReads'),
        count((edge) => TOUCH.has(edge.kind)) ? statOf(count((edge) => TOUCH.has(edge.kind)), 'uiStatUndetermined') : '',
        count((edge) => edge.kind === 'calls') ? statOf(count((edge) => edge.kind === 'calls'), 'uiStatCalls') : '',
        '</div>');
    }

    if (node.type === 'app') {
      parts.push('<div class="stats">',
        statOf(outgoing.filter((edge) => edge.kind === 'uses').length, 'uiStatDataSources'),
        statOf(outgoing.filter((edge) => edge.kind === 'calls').length, 'uiStatFlows'),
        '</div>');
    }

    // Every node offers the same two things, in the same order and the same place. Isolating works
    // for all of them — it is "show me what this one deals with", which every type has an answer
    // to. Opening needs a link the platform itself gave us, so a Dataverse table has none.
    const actions: string[] = [];
    actions.push(`<button class="chip" data-focus="${escapeHtml(node.id)}">${escapeHtml(t('uiFocusOnSource'))}</button>`);
    if (node.url) actions.push(`<a class="chip" href="${escapeHtml(node.url)}" target="_blank" rel="noopener">${escapeHtml(t('uiOpen'))}</a>`);
    if (actions.length > 0) parts.push(`<div class="actions">${actions.join('')}</div>`);

    // Everything the graph itself computed is keyed by the canonical id, never by an instance.
    const cascade = graph.cascades[node.sourceId];
    if (cascade?.length) {
      parts.push(section('cascade', t('uiSecCascade'),
        `<ul class="cascade">${cascade.map((step) => renderStep(step, 0)).join('')}</ul>`, cascade.length));
    }

    // Where else the very same node sits. One click and the diagram jumps to that solution's copy.
    if (node.copies > 1) {
      const elsewhere = instances(node.sourceId).filter((other) => other.id !== node.id);
      parts.push(section('siblings', t('uiSecAlsoIn'),
        `<ul class="rel">${elsewhere.map((other) => `<li>${chip(other.id, other.group)}</li>`).join('')}</ul>`,
        instances(node.sourceId).length));
    }

    for (const part of relationSections(node)) parts.push(part);

    const details: string[] = [];
    const detail = (label: string, value: unknown): void => {
      details.push(`<li>${escapeHtml(label)} <span class="verb">${escapeHtml(value)}</span></li>`);
    };
    if (node.site) detail(t('uiDetailSite'), node.site.replace(/^https?:\/\//, ''));
    if (node.itemCount != null) detail(t('uiDetailEntries'), node.itemCount);
    if (node.solution) detail(t('uiDetailSolution'), node.solutionName ?? node.solution);
    if (node.connectors?.length) detail(t('uiDetailConnectors'), node.connectors.join(', '));
    if (node.source) detail(t('uiDetailSource'), node.source);
    if (node.envVar) detail(t('uiDetailEnvVar'), node.envVar);
    if (node.listId) detail(t('uiDetailListId'), node.listId);
    if (node.flowId) detail(t('uiDetailFlowId'), node.flowId);
    if (node.workflowId) detail(t('uiDetailWorkflowId'), node.workflowId);
    parts.push(section('meta', t('uiSecTechnical'), details.length > 0 ? `<ul class="rel">${details.join('')}</ul>` : ''));

    return parts.join('');
  }

  /**
   * The relationship sections. Named after what the relationship MEANS for this node — "incoming"
   * and "outgoing" describe the arrow, not the fact. Every incident edge is claimed exactly once
   * and whatever no section claims lands in uiSecOther, so nothing is silently dropped when a new
   * edge kind appears.
   */
  function relationSections(node: LayoutNode): string[] {
    const incident = dedupe(edges.filter((edge) => edge.kind !== MIRROR
      && (edge.a.sourceId === node.sourceId || edge.b.sourceId === node.sourceId)));
    const claimed = new Set<LayoutEdge>();
    const take = (predicate: (edge: LayoutEdge) => boolean): LayoutEdge[] => {
      const got = incident.filter((edge) => !claimed.has(edge) && predicate(edge));
      for (const edge of got) claimed.add(edge);
      return got;
    };
    const out = (edge: LayoutEdge): boolean => edge.a.sourceId === node.sourceId;

    const specs: Array<[string, string, LayoutEdge[]]> = [];
    if (node.type === 'list' || node.type === 'table') {
      specs.push(['triggers', t('uiSecTriggers'), take((e) => e.kind === 'triggers' && out(e))]);
      specs.push(['writes', t('uiSecWritesInto'), take((e) => !out(e) && WRITE.has(e.kind))]);
      specs.push(['reads', t('uiSecReadsHere'), take((e) => !out(e) && READ.has(e.kind))]);
      specs.push(['touches', t('uiSecUndetermined'), take((e) => TOUCH.has(e.kind))]);
      specs.push(['apps', t('uiSecUsedByApps'), take((e) => e.kind === 'uses')]);
      specs.push(['site', t('uiSecOnSite'), take((e) => e.kind === 'contains')]);
    } else if (node.type === 'flow') {
      specs.push(['startedBy', t('uiSecStartedBy'), take((e) => e.kind === 'triggers' && !out(e))]);
      specs.push(['calledBy', t('uiSecCalledBy'), take((e) => e.kind === 'calls' && !out(e))]);
      specs.push(['writes', t('uiSecWritesTo'), take((e) => out(e) && WRITE.has(e.kind))]);
      specs.push(['reads', t('uiSecReadsFrom'), take((e) => out(e) && READ.has(e.kind))]);
      specs.push(['touches', t('uiSecUndetermined'), take((e) => TOUCH.has(e.kind))]);
      specs.push(['calls', t('uiSecCallsFlows'), take((e) => e.kind === 'calls' && out(e))]);
    } else if (node.type === 'app') {
      specs.push(['uses', t('uiSecUsesData'), take((e) => e.kind === 'uses' && out(e))]);
      specs.push(['calls', t('uiSecCallsTheseFlows'), take((e) => e.kind === 'calls' && out(e))]);
    } else {
      specs.push(['contains', t('uiSecContainsLists'), take((e) => e.kind === 'contains' && out(e))]);
    }
    specs.push(['rest', t('uiSecOther'), incident.filter((edge) => !claimed.has(edge))]);

    return specs
      .filter(([, , list]) => list.length > 0)
      .map(([key, title, list]) => section(key, title, edgeList(node, list), list.length));
  }

  function edgeList(node: LayoutNode, list: LayoutEdge[]): string {
    const rows = list
      .map((edge) => {
        const other = edge.a.sourceId === node.sourceId ? edge.b : edge.a;
        const detail = edge.conditions?.length
          ? `${t('uiOnlyIf')} ${allOf(edge.conditions)}`
          : (edge.actions?.length ? edge.actions.join(', ') : '');
        return {
          label: other.label,
          html: `<li>${chip(other.id)}${detail ? ` <span class="verb">${escapeHtml(detail)}</span>` : ''}</li>`,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, i18n.locale));
    return `<ul class="rel">${rows.map((row) => row.html).join('')}</ul>`;
  }

  /**
   * One relationship, once. A shared node carries the same edge in every solution that uses it, and
   * the side panel describes the node rather than the copy — so the duplicates collapse here.
   */
  function dedupe(list: LayoutEdge[]): LayoutEdge[] {
    const seen = new Set<string>();
    return list.filter((edge) => {
      const key = `${edge.a.sourceId}|${edge.b.sourceId}|${edge.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** A cascade step: the flow as the summary line, its consequences folded inside. */
  function renderStep(step: CascadeStep, depth: number): string {
    const conditions = step.conditions.length > 0
      ? `<div class="cond">${escapeHtml(t('uiOnlyIf'))} <code>${escapeHtml(allOf(step.conditions))}</code></div>` : '';
    const head = `▶ ${chip(step.flow)} <span class="cond">${escapeHtml(step.on ?? '')}</span>`;
    if (step.writes.length === 0) return `<li>${head}${conditions}</li>`;

    const body = step.writes.map((write) => {
      const line = `<span class="verb">${verb(write.verb)} →</span> ${chip(write.list)}`;
      if (write.cycle) return `<li>${line} <span class="cond">${escapeHtml(t('uiBackInChain'))}</span></li>`;
      if (write.next.length === 0) return `<li>${line} <span class="cond">${escapeHtml(t('uiStartsNothing'))}</span></li>`;
      return `<li>${line}<ul class="cascade">${write.next.map((next) => renderStep(next, depth + 1)).join('')}</ul></li>`;
    }).join('');

    return `<li><details class="step"${depth === 0 ? '' : ' open'}><summary>${head}`
      + `<span class="count">${step.writes.length}</span></summary>${conditions}`
      + `<ul class="cascade">${body}</ul></details></li>`;
  }

  // ---------------------------------------------------------------- controls
  const typeFilters = [...document.querySelectorAll<HTMLElement>('[data-filter]')];
  const edgeFilters = [...document.querySelectorAll<HTMLElement>('[data-edge]')];
  const isChecked = (filter: HTMLElement): boolean => filter.querySelector<HTMLInputElement>('input')?.checked ?? false;

  for (const name of solutions) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    solutionPicker.append(option);
  }

  function setFocus(id: string | null): void {
    // The focus view is about the node, not about one of its boxes, so it always centres the
    // primary instance however the reader got here.
    const node = id ? byId.get(id) ?? primary(id) : null;
    focused = node ? primary(node.sourceId)?.id ?? null : null;
    document.body.dataset['focus'] = focused ? '1' : '';
    if (focused) selected = focused;
    rebuild();
    renderPanel();
  }

  function rebuild(): void {
    const activeTypes = new Set(typeFilters.filter(isChecked).map((filter) => filter.dataset['filter']));
    const activeEdges = new Set(edgeFilters.filter(isChecked).map((filter) => filter.dataset['edge']));
    const wanted = solutionPicker.value;
    const centre = focused ? byId.get(focused) : null;

    if (centre) {
      // Solutions do not exist in this view, so every node collapses onto its primary instance and
      // the edges are redrawn between those — otherwise a shared list would appear several times
      // around its own centre.
      const keep = new Set([centre.sourceId, ...neighboursOf(centre.sourceId)]);
      for (const node of nodes) node.hidden = !(keep.has(node.sourceId) && node === primary(node.sourceId));
      const drawn = new Set<string>();
      for (const edge of edges) {
        const va = primary(edge.a.sourceId);
        const vb = primary(edge.b.sourceId);
        edge.va = va ?? edge.a;
        edge.vb = vb ?? edge.b;
        const key = `${edge.va.id}|${edge.vb.id}|${edge.kind}`;
        edge.visible = !isMirror(edge) && !edge.va.hidden && !edge.vb.hidden && edge.va !== edge.vb
          && (edge.a.sourceId === centre.sourceId || edge.b.sourceId === centre.sourceId)
          && !drawn.has(key);
        if (edge.visible) drawn.add(key);
      }
    } else {
      for (const node of nodes) {
        node.hidden = !activeTypes.has(node.type) || (wanted ? node.group !== wanted : false);
      }
      for (const edge of edges) {
        edge.va = edge.a;
        edge.vb = edge.b;
        edge.visible = !edge.a.hidden && !edge.b.hidden && activeEdges.has(EDGE_GROUP[edge.kind]);
      }
    }

    for (const node of nodes) node.el.classList.toggle('hidden', node.hidden);
    for (const edge of edges) edge.el.classList.toggle('hidden', !edge.visible);
    for (const filter of [...typeFilters, ...edgeFilters]) filter.dataset['off'] = String(!isChecked(filter));

    // The menu hides its own state, so the count on the button has to carry it — otherwise a reader
    // wonders why half the diagram is missing with nothing on screen saying anything is filtered.
    const off = [...typeFilters, ...edgeFilters].filter((filter) => !isChecked(filter)).length;
    filterCount.textContent = String(off);
    filterCount.hidden = off === 0;

    live = { nodes: nodes.filter((node) => !node.hidden), edges: edges.filter((edge) => edge.visible) };
    if (selected && byId.get(selected)?.hidden) selected = null;

    if (centre) focusLayout(primary(centre.sourceId) ?? centre);
    else clusterLayout();
    draw();
    fit();
    drawMinimap();
    emphasise();
  }

  search.addEventListener('input', emphasise);
  solutionPicker.addEventListener('change', () => setFocus(null));
  for (const filter of [...typeFilters, ...edgeFilters]) {
    filter.querySelector<HTMLInputElement>('input')?.addEventListener('change', rebuild);
  }
  unfocusButton.addEventListener('click', () => setFocus(null));

  must<HTMLButtonElement>('fit').addEventListener('click', fit);
  const viewToggle = must<HTMLButtonElement>('view-toggle');
  viewToggle.addEventListener('click', () => {
    const next = document.body.dataset['view'] === 'table' ? 'graph' : 'table';
    document.body.dataset['view'] = next;
    viewToggle.textContent = next === 'table' ? t('uiDiagram') : t('uiTable');
    if (next === 'graph') fit();
  });
  must<HTMLButtonElement>('theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.dataset['theme'] === 'dark'
      || (!document.documentElement.dataset['theme'] && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset['theme'] = dark ? 'light' : 'dark';
  });

  // Table view — easy to copy out, and the text version of everything the diagram encodes with
  // position and colour. Built from the GRAPH's edges, not the drawn ones: an edge that appears in
  // three solution boxes is still one relationship, and the solution column names all three.
  const tbody = document.querySelector('#table-view tbody');
  if (tbody) {
    const label = (id: string): string => primary(id)?.label ?? id;
    const rows = graph.edges
      .filter((edge) => edge.kind !== 'contains')
      .sort((a, b) => label(a.from).localeCompare(label(b.from), i18n.locale));
    for (const edge of rows) {
      const row = document.createElement('tr');
      const detail = [...(edge.conditions ?? []).map((c) => `${t('uiOnlyIf')} ${c}`), ...(edge.actions ?? [])].join('; ');
      const where = (NODE_SOLUTIONS.get(edge.from) ?? []).join(' · ');
      row.innerHTML = `<td>${escapeHtml(where)}</td><td>${escapeHtml(label(edge.from))}</td>`
        + `<td>${escapeHtml(verb(edge.kind))}</td><td>${escapeHtml(label(edge.to))}</td><td>${escapeHtml(detail)}</td>`;
      tbody.append(row);
    }
  }

  rebuild();
  renderPanel();
  addEventListener('resize', fit);
})();
