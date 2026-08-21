import type { Locale, Phrase } from './i18n/index.js';

/**
 * The shared vocabulary of the tool. Everything that crosses a module boundary is described here,
 * so the collectors, the graph builder, both renderers and the browser viewer agree on one shape.
 *
 * **Two states of the same graph.** The types that carry report prose are written once, over a type
 * parameter: `Graph<Phrase>` is what the builder produces — language-free, every sentence still a
 * key — and `Graph` (the default, `Graph<string>`) is what a renderer receives once `materialize`
 * has worded it. Both artefacts come from one build, which is why `graph.json` can be English while
 * `graph.html` is German without anything being collected twice.
 */

export type NodeType = 'site' | 'list' | 'table' | 'flow' | 'app';

export type EdgeKind =
  | 'triggers'
  | 'creates'
  | 'updates'
  | 'deletes'
  | 'reads'
  | 'other'
  | 'uses'
  | 'calls'
  | 'contains';

/** What a trigger reacts to. `on` is the coarse class, `label` the wording a reader sees. */
export type TriggerClass =
  | 'create'
  | 'update'
  | 'createOrUpdate'
  | 'createOrDelete'
  | 'updateOrDelete'
  | 'anyChange'
  | 'delete'
  | 'call'
  | 'schedule'
  | 'event'
  | 'unknown';

export type TriggerKind = 'sharepoint' | 'dataverse' | 'app' | 'http' | 'schedule' | 'connector' | 'other';

// ---------------------------------------------------------------- inputs from the caller

/** A SharePoint site the caller knows a friendlier name for than the URL carries. */
export interface KnownSite {
  name: string;
  url: string;
  lists: string[];
}

// ---------------------------------------------------------------- flow definitions

export interface ParameterReference {
  name: string;
  displayName: string;
  schemaName?: string;
}

export interface DataTarget {
  site?: string | null;
  siteParam?: ParameterReference | null;
  list?: string | null;
  listIsGuid?: boolean;
  listParam?: ParameterReference | null;
  table?: string | null;
}

export interface FlowTrigger extends DataTarget {
  name: string;
  type?: string;
  kind: TriggerKind;
  connector: string | null;
  label: Phrase;
  on: TriggerClass;
  operationId?: string;
  conditions: string[];
  recurrence: Record<string, unknown> | null;
  splitOn: boolean;
}

export type OperationVerb = 'creates' | 'updates' | 'deletes' | 'reads' | 'other';

export interface FlowOperation extends DataTarget {
  action: string;
  connector: string;
  operationId?: string;
  verb: OperationVerb;
}

export interface ChildFlowReference {
  action: string;
  workflowId: string;
}

export interface ParsedFlow {
  trigger: FlowTrigger | null;
  operations: FlowOperation[];
  childFlows: ChildFlowReference[];
  connectors: string[];
  connectionReferences: string[];
  parsed: boolean;
}

export interface AppListReference {
  site: string | null;
  name: string;
  listId: string | null;
  /** The environment variable the app binds this list through, when it binds one. */
  envVar?: string | null;
}

export interface AppReferences {
  lists: AppListReference[];
  tables: string[];
  flows: string[];
  connectors: string[];
}

// ---------------------------------------------------------------- collected records

export interface SolutionRef {
  uniqueName: string;
  name?: string;
  managed?: boolean;
  /** The Dataverse solutionid. Kept because the maker portal addresses a flow through it. */
  id?: string;
}

/**
 * Whether a flow would run. A machine value, not wording: it is the field a query filters on, and
 * `state !== 'enabled'` has to keep working whatever language the report was written in.
 */
export type FlowState = 'enabled' | 'disabled' | 'unknown';

export interface FlowRecord extends ParsedFlow {
  key: string;
  name: string;
  workflowId: string | null;
  flowId: string | null;
  state: FlowState | null;
  managed: boolean;
  modified?: string;
  solution: SolutionRef | null;
  source: string;
  /** Filled in by the graph builder. */
  nodeId?: string;
}

export interface AppRecord extends AppReferences {
  id: string;
  name: string;
  solution: SolutionRef | null;
  source: string;
  studioUrl: string | null;
}

export interface SourceStatus<T = string> {
  name: T;
  ok: boolean;
  detail?: T;
}

export interface ListInfo {
  title: string;
  id?: string;
  itemCount?: number | null;
  hidden?: boolean;
  url?: string | null;
}

/** `<site url lowercased>::<list id or title lowercased>` → the list. */
export type ListIndex = Map<string, ListInfo>;

export interface TableInfo {
  /** The singular name Dataverse itself considers canonical. */
  logicalName: string;
  metadataId: string;
}

/** Any spelling a flow or an app used, lowercased → the table it means. */
export type TableIndex = Map<string, TableInfo>;

/** Which application signs in for SharePoint, when the well-known one will not do. */
export interface SharePointSettings {
  clientId?: string;
  tenant?: string;
}

/**
 * The parts of the collection that can be left out; `--skip` takes these names.
 *
 * Named after the PRODUCT each one reads, not after the shape of the call. Four are services —
 * powerapps, powerautomate, dataverse, sharepoint — and two are the pieces of Dataverse that are
 * worth leaving out on their own, because they cost a query each and a graph is still readable
 * without them.
 */
export type CollectorKey =
  | 'powerapps'
  | 'powerautomate'
  | 'dataverse'
  | 'solutions'
  | 'variables'
  | 'sharepoint';

export const COLLECTOR_KEYS: readonly CollectorKey[] = [
  'powerapps', 'powerautomate', 'dataverse', 'solutions', 'variables', 'sharepoint',
];

export interface CollectContext {
  tenantId?: string;
  environmentId: string;
  dataverseUrl?: string;
  cacheFile: string;
  refreshNames?: boolean;
  sharePoint: SharePointSettings | null;
  skip: ReadonlySet<CollectorKey>;
  /** Goes into the report, so it is noted as a phrase and worded once per artefact. */
  warn(message: Phrase): void;
  /** Goes to the terminal, which is English by construction. */
  log(message: string): void;
}

/** An environment as the Flow API reports it — this is what replaces a configuration file. */
export interface DiscoveredEnvironment {
  environmentId: string;
  name: string;
  isDefault: boolean;
  sku?: string;
  dataverseUrl?: string;
}

/** Everything one run needs, once flags, discovery and questions have been merged. */
export interface RunConfig {
  /** What the graph calls this tenant in its headers. */
  label: string;
  tenantId?: string;
  account?: string;
  /** The account the run actually reads with — reported, never guessed at. */
  signedInAs?: string;
  environmentId: string;
  environmentName?: string;
  dataverseUrl?: string;
  sharePoint: SharePointSettings | null;
  knownSites: KnownSite[];
  outDir: string;
  /** The language the report is written in — resolved, so the rebuild command can record it. */
  locale: Locale;
  skip: Set<CollectorKey>;
}

export interface CollectedEnvironment {
  flows: FlowRecord[];
  apps: AppRecord[];
  envVars: Map<string, string>;
  /**
   * Every name a Dataverse table is referenced by — logical AND entity-set — mapped to the one
   * identity behind it. Two spellings of one table therefore become one node, and the portal link
   * needs the MetadataId anyway.
   */
  tableIds: TableIndex;
  sources: SourceStatus<Phrase>[];
}

// ---------------------------------------------------------------- the graph

export interface UsedBySolution {
  solution: string;
  links: number;
}

export interface GraphNode<T = string> {
  id: string;
  type: NodeType;
  /** The object's own name, as the platform spells it — never translated. */
  label: string;
  url?: string | null;

  // data sources
  site?: string | null;
  siteId?: string | null;
  listId?: string | null;
  resolved?: boolean;
  /**
   * The environment variable this reference came from. Only kept when the list did NOT resolve —
   * then it is the whole answer to "where do I go and fix this", which a bare GUID never is.
   */
  envVar?: string | null;
  itemCount?: number | null;
  usedBy?: UsedBySolution[];
  /**
   * Every solution this node belongs in. A flow or an app has exactly one; a list, table or site
   * has as many as reach it, and the diagram draws one instance per entry. **Empty means no
   * solution owns it** — the leftovers group. That case is an empty array rather than a caption
   * because a caption is language, and this field is a grouping key.
   */
  solutions?: string[];

  // flows and apps
  state?: FlowState | null;
  solution?: string | null;
  solutionName?: string | null;
  managed?: boolean;
  workflowId?: string | null;
  flowId?: string | null;
  source?: string;
  connectors?: string[];
  trigger?: {
    kind: TriggerKind;
    label: T;
    on: TriggerClass;
    conditions: string[];
    conditionsRaw: string[];
    connector: string | null;
  } | null;
}

export interface GraphEdge<T = string> {
  from: string;
  to: string;
  kind: EdgeKind;
  label?: T;
  on?: TriggerClass;
  conditions?: string[];
  actions?: string[];
  source?: string;
  /**
   * `triggers` edges only: which write verbs on the source can actually start this flow. A "when an
   * item is CREATED" trigger is not re-fired by an update, so this is what decides whether a write
   * continues the cascade — never the mere existence of a write.
   */
  refiredBy?: EdgeKind[];
}

export interface CascadeWrite<T = string> {
  list: string;
  verb: EdgeKind;
  actions: string[];
  cycle: boolean;
  next: CascadeStep<T>[];
}

export interface CascadeStep<T = string> {
  flow: string;
  on?: T;
  conditions: string[];
  writes: CascadeWrite<T>[];
  truncated?: boolean;
}

export interface SelfTrigger {
  flow: string;
  list: string;
  verbs: EdgeKind[];
  actions: string[];
  guarded: boolean;
}

export interface SharedSource {
  node: string;
  usedBy: UsedBySolution[];
}

export interface GraphEnvironment {
  name?: string;
  environmentId: string;
  dataverseUrl?: string | null;
}

export interface Graph<T = string> {
  /** 2 since the prose in this file is always English and every state is a machine value. */
  schemaVersion: number;
  generatedAt: string;
  /** The language this copy is worded in. `graph.json` says `en`; the viewer's copy may not. */
  locale: Locale;
  tenant: string;
  environment: GraphEnvironment;
  /** The solutions this report was narrowed to, or null for the whole environment. */
  scope?: string[] | null;
  sources: SourceStatus<T>[];
  nodes: GraphNode<T>[];
  edges: GraphEdge<T>[];
  warnings: T[];
  selfTriggers: SelfTrigger[];
  cascades: Record<string, CascadeStep<T>[]>;
  sharedSources: SharedSource[];
}

/**
 * The graph as the builder leaves it: every sentence still a key, no language chosen — which is
 * why it carries no `locale` either. `materialize` picks one and fills that field in.
 */
export type RawGraph = Omit<Graph<Phrase>, 'locale'>;

export interface BuildGraphInput {
  /** Keep only these solutions. Names or unique names; empty means the whole environment. */
  solutions?: string[];
  tenant: string;
  environment: GraphEnvironment;
  flows: FlowRecord[];
  apps: AppRecord[];
  listNames: ListIndex;
  tableIds?: TableIndex;
  knownSites: KnownSite[];
  sources: SourceStatus<Phrase>[];
  warnings: Phrase[];
}
