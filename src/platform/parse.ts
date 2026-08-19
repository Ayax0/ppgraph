// The heart of the tool: turn a flow definition into "what triggers this, and what does it touch".
// Works on both shapes we get — Dataverse `clientdata` and the Flow API's `properties` — because
// below `properties` they are the same document.
import type {
  AppReferences, ChildFlowReference, DataTarget, FlowOperation, FlowTrigger, OperationVerb,
  ParameterReference, ParsedFlow, TriggerClass,
} from '../types.js';
import { msg } from '../i18n/index.js';
import type { MessageKey } from '../i18n/index.js';

const SP = 'shared_sharepointonline';
const DV = 'shared_commondataserviceforapps';

// SharePoint triggers. Unknown ids fall back to their own name rather than being dropped.
// The tables hold message KEYS, never text — the wording belongs to the catalogue (src/i18n).
const SP_TRIGGERS: Record<string, { key: MessageKey; on: TriggerClass }> = {
  GetOnNewItems: { key: 'trgItemCreated', on: 'create' },
  GetOnUpdatedItems: { key: 'trgItemCreatedOrModified', on: 'createOrUpdate' },
  GetOnChangedItems: { key: 'trgItemOrFileModified', on: 'update' },
  GetOnDeletedItems: { key: 'trgItemDeleted', on: 'delete' },
  GetOnNewFileItems: { key: 'trgFileCreated', on: 'create' },
  GetOnUpdatedFileItems: { key: 'trgFileCreatedOrModified', on: 'createOrUpdate' },
  GetOnDeletedFileItems: { key: 'trgFileDeleted', on: 'delete' },
  OnNewFile: { key: 'trgFileInFolderCreated', on: 'create' },
  OnUpdatedFile: { key: 'trgFileInFolderModified', on: 'update' },
};

// `Request` triggers say who may start the flow — which is the useful fact, not the protocol.
const REQUEST_KINDS: Record<string, MessageKey> = {
  PowerApp: 'trgFromApp',
  PowerAppV2: 'trgFromApp',
  Button: 'trgManualOrChild',
  VirtualAgent: 'trgFromCopilot',
  Http: 'trgHttp',
  ApiConnection: 'trgHttpConnector',
};

// SharePoint actions → what they do to the list.
const SP_ACTIONS: Record<string, OperationVerb> = {
  PostItem: 'creates',
  PatchItem: 'updates',
  DeleteItem: 'deletes',
  GetItem: 'reads',
  GetItems: 'reads',
  GetItemsFilteredByFolder: 'reads',
  CreateAttachment: 'updates',
  DeleteAttachment: 'updates',
  GetAttachments: 'reads',
  GetAttachmentContent: 'reads',
  GrantAccess: 'updates',
  StopSharingItem: 'updates',
  PostFileAsync: 'creates',
  UpdateFileAsync: 'updates',
  CopyFileAsync: 'creates',
  DeleteFile: 'deletes',
  GetFileItem: 'reads',
  GetFileMetadata: 'reads',
  GetFileContent: 'reads',
  ExtractFolderV2: 'creates',
  HttpRequest: 'other',
};

const DV_ACTIONS: Record<string, OperationVerb> = {
  CreateRecord: 'creates',
  UpdateRecord: 'updates',
  DeleteRecord: 'deletes',
  GetItem: 'reads',
  ListRecords: 'reads',
  PerformBoundAction: 'other',
  PerformUnboundAction: 'other',
};

const DV_MESSAGES: Record<number, MessageKey> = {
  1: 'trgRecordCreated',
  2: 'trgRecordUpdated',
  3: 'trgRecordDeleted',
};

// ---------------------------------------------------------------- the raw document

interface DefinitionHost {
  apiId?: string;
  connectionName?: string;
  connection?: { name?: string };
  operationId?: string;
  workflowReferenceName?: string;
  workflow?: { id?: string };
}

interface DefinitionInputs {
  host?: DefinitionHost;
  parameters?: Record<string, unknown>;
  path?: string;
  method?: string;
}

interface DefinitionStep {
  type?: string;
  kind?: string;
  inputs?: DefinitionInputs;
  conditions?: Array<{ expression?: string }>;
  recurrence?: Record<string, unknown>;
  splitOn?: string;
  actions?: Record<string, DefinitionStep>;
  else?: { actions?: Record<string, DefinitionStep> };
  default?: { actions?: Record<string, DefinitionStep> };
  cases?: Record<string, { actions?: Record<string, DefinitionStep> }>;
}

interface DefinitionParameter {
  defaultValue?: unknown;
  metadata?: { schemaName?: string };
}

interface FlowDefinition {
  parameters?: Record<string, DefinitionParameter>;
  triggers?: Record<string, DefinitionStep>;
  actions?: Record<string, DefinitionStep>;
}

interface ConnectionReferenceEntry {
  connection?: { connectionReferenceLogicalName?: string };
  connectionReferenceLogicalName?: string;
  api?: { name?: string };
  apiName?: string;
}

type ConnectionReferences = Record<string, ConnectionReferenceEntry>;

interface DefinitionEnvelope {
  properties?: { definition?: FlowDefinition; connectionReferences?: ConnectionReferences };
  definition?: FlowDefinition;
  connectionReferences?: ConnectionReferences;
}

/** clientdata / Flow-API body → the definition document plus its connection references. */
export function unwrap(raw: unknown): { definition: FlowDefinition | null; connectionReferences: ConnectionReferences } {
  const document: DefinitionEnvelope | null = typeof raw === 'string' ? safeJson(raw) : (raw as DefinitionEnvelope | null);
  const properties = document?.properties ?? document ?? {};
  return {
    definition: properties.definition ?? document?.definition ?? null,
    connectionReferences: properties.connectionReferences ?? {},
  };
}

function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- parameters

interface ResolvedParameter {
  value: unknown;
  schemaName?: string;
  displayName: string;
}

/**
 * Build the parameter lookup a definition carries with it. Solution flows store every environment
 * variable here, `defaultValue` included — so site URLs and list ids resolve without a single extra
 * API call. Live values (which can differ per environment) override them when supplied.
 */
function parameterMap(definition: FlowDefinition | null, envVarValues?: Map<string, string>): Map<string, ResolvedParameter> {
  const byName = new Map<string, ResolvedParameter>();
  for (const [name, parameter] of Object.entries(definition?.parameters ?? {})) {
    const schemaName = parameter?.metadata?.schemaName;
    const live = schemaName ? envVarValues?.get(schemaName) : undefined;
    byName.set(name, {
      value: live !== undefined && live !== null && live !== '' ? live : parameter?.defaultValue,
      schemaName,
      displayName: name.replace(/\s*\([^)]*\)\s*$/, ''),
    });
  }
  return byName;
}

const PARAM_RE = /@\{?\s*parameters\(\s*'((?:[^']|'')*)'\s*\)\s*\}?/g;

/** Replace `@parameters('X')` / `@{parameters('X')}` with the value the definition declares. */
function resolve(value: unknown, params: Map<string, ResolvedParameter>): { value: unknown; param: ParameterReference | null } {
  if (typeof value !== 'string' || !value.includes('parameters(')) return { value, param: null };

  let usedParam: ParameterReference | null = null;
  const out = value.replace(PARAM_RE, (match, name: string) => {
    const hit = params.get(name);
    if (!hit) return match;
    usedParam = { name, displayName: hit.displayName, schemaName: hit.schemaName };
    return hit.value == null ? match : String(hit.value);
  });
  return { value: out, param: usedParam };
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function normalizeSite(url: unknown): string | null {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  return url.replace(/\/+$/, '');
}

function siteAndTable(parameters: Record<string, unknown> | undefined, params: Map<string, ResolvedParameter>): DataTarget {
  const dataset = resolve(parameters?.['dataset'], params);
  const table = resolve(parameters?.['table'], params);
  const listRef = typeof table.value === 'string' ? table.value.replace(/^\{|\}$/g, '') : null;

  return {
    site: normalizeSite(dataset.value),
    siteParam: dataset.param,
    list: listRef && !listRef.includes('@') ? listRef : null,
    listIsGuid: Boolean(listRef && GUID_RE.test(listRef)),
    listParam: table.param,
  };
}

/** Legacy `ApiConnection` actions address the list in the request path instead of in parameters. */
function legacyTarget(inputs: DefinitionInputs | undefined, params: Map<string, ResolvedParameter>): DataTarget {
  const path = resolve(inputs?.path, params).value;
  if (typeof path !== 'string') return { site: null, list: null, listIsGuid: false };

  const match = /\/datasets\/(.+?)\/(?:tables|files)\/(.+?)(?:\/|$)/.exec(path);
  if (!match) return { site: null, list: null, listIsGuid: false };

  const list = unquote(match[2] ?? '');
  return { site: normalizeSite(unquote(match[1] ?? '')), list, listIsGuid: GUID_RE.test(list) };
}

function unquote(segment: string): string {
  const quoted = /'((?:[^']|'')*)'/.exec(segment);
  const raw = quoted?.[1] ?? segment;
  try {
    return decodeURIComponent(decodeURIComponent(raw));
  } catch {
    return raw;
  }
}

function legacyOp(inputs: DefinitionInputs | undefined): string {
  const method = String(inputs?.method ?? '').toUpperCase();
  return method ? `${method} ${String(inputs?.path ?? '').split('/').slice(-1)[0]}` : '?';
}

function connectorOf(host: DefinitionHost | undefined, connectionReferences: ConnectionReferences): string | null {
  const direct = host?.apiId ? String(host.apiId).split('/').pop() : null;
  if (direct) return direct;

  const alias = host?.connectionName ?? host?.connection?.name;
  if (!alias) return null;

  const reference = connectionReferences[alias];
  if (reference?.api?.name || reference?.apiName) return reference.api?.name ?? reference.apiName ?? null;

  // Legacy flows name the connection through an expression:
  // @parameters('$connections')['shared_sharepointonline']['connectionId']
  const embedded = /\['(shared_[a-z0-9_]+?)(?:_\d+)?'\]/i.exec(String(alias));
  return embedded?.[1] ?? String(alias).replace(/_\d+$/, '');
}

/** Walk every action, including the ones nested in Scope / Condition / Switch / Foreach / Until. */
function walkActions(
  actions: Record<string, DefinitionStep> | undefined,
  visit: (name: string, action: DefinitionStep) => void,
): void {
  for (const [name, action] of Object.entries(actions ?? {})) {
    if (!action || typeof action !== 'object') continue;
    visit(name, action);
    walkActions(action.actions, visit);
    walkActions(action.else?.actions, visit);
    walkActions(action.default?.actions, visit);
    for (const branch of Object.values(action.cases ?? {})) walkActions(branch?.actions, visit);
  }
}

// ---------------------------------------------------------------- the public surface

export function parseFlow(raw: unknown, envVarValues?: Map<string, string>): ParsedFlow {
  const { definition, connectionReferences } = unwrap(raw);
  if (!definition) {
    return { trigger: null, operations: [], childFlows: [], connectors: [], connectionReferences: [], parsed: false };
  }

  const params = parameterMap(definition, envVarValues);
  const connectors = new Set<string>();
  const operations: FlowOperation[] = [];
  const childFlows: ChildFlowReference[] = [];

  const trigger = describeTrigger(definition.triggers, connectionReferences, params, connectors);

  walkActions(definition.actions, (name, action) => {
    if (action.type === 'Workflow') {
      const id = action.inputs?.host?.workflowReferenceName ?? action.inputs?.host?.workflow?.id;
      if (id) childFlows.push({ action: name, workflowId: String(id).split('/').pop() ?? String(id) });
      return;
    }

    const host = action.inputs?.host;
    if (!host) return;
    const connector = connectorOf(host, connectionReferences);
    if (connector) connectors.add(connector);

    const operationId = host.operationId;
    if (connector === SP) {
      const target = operationId ? siteAndTable(action.inputs?.parameters, params) : legacyTarget(action.inputs, params);
      operations.push({
        action: name,
        connector,
        operationId: operationId ?? legacyOp(action.inputs),
        verb: (operationId ? SP_ACTIONS[operationId] : undefined) ?? 'other',
        ...target,
      });
    } else if (connector === DV) {
      const entity = resolve(action.inputs?.parameters?.['entityName'], params).value;
      if (typeof entity === 'string' && entity) {
        operations.push({
          action: name,
          connector,
          operationId,
          verb: (operationId ? DV_ACTIONS[operationId] : undefined) ?? 'other',
          table: entity,
        });
      }
    }
  });

  return {
    trigger,
    operations,
    childFlows,
    connectors: [...connectors],
    connectionReferences: Object.values(connectionReferences)
      .map((reference) => reference?.connection?.connectionReferenceLogicalName ?? reference?.connectionReferenceLogicalName)
      .filter((name): name is string => Boolean(name)),
    parsed: true,
  };
}

function describeTrigger(
  triggers: Record<string, DefinitionStep> | undefined,
  connectionReferences: ConnectionReferences,
  params: Map<string, ResolvedParameter>,
  connectors: Set<string>,
): FlowTrigger | null {
  const entry = Object.entries(triggers ?? {})[0];
  if (!entry) return null;

  const [name, trigger] = entry;
  const host = trigger.inputs?.host;
  const connector = connectorOf(host, connectionReferences);
  if (connector) connectors.add(connector);

  const base = {
    name,
    type: trigger.type,
    connector,
    conditions: (trigger.conditions ?? []).map((c) => c.expression).filter((e): e is string => Boolean(e)),
    recurrence: trigger.recurrence ?? null,
    splitOn: Boolean(trigger.splitOn),
  };

  // `Request` and `Recurrence` are decided by the trigger TYPE, never by the connector its host
  // mentions — a Request trigger that names a SharePoint connection is still a Request trigger.
  if (trigger.type === 'Request') {
    const kind = trigger.kind ?? 'Http';
    return {
      ...base,
      kind: /powerapp/i.test(kind) ? 'app' : 'http',
      label: REQUEST_KINDS[kind] ? msg(REQUEST_KINDS[kind]) : msg('trgHttpOther', { kind }),
      on: 'call',
    };
  }

  if (trigger.type === 'Recurrence') {
    const recurrence = trigger.recurrence ?? {};
    return {
      ...base,
      kind: 'schedule',
      label: msg('trgSchedule', {
        interval: String(recurrence['interval'] ?? '?'),
        frequency: String(recurrence['frequency'] ?? ''),
      }),
      on: 'schedule',
    };
  }

  if (connector === SP) {
    const operationId = host?.operationId;
    const known = operationId ? SP_TRIGGERS[operationId] : undefined;
    const target = operationId ? siteAndTable(trigger.inputs?.parameters, params) : legacyTarget(trigger.inputs, params);
    return {
      ...base,
      kind: 'sharepoint',
      operationId: operationId ?? legacyOp(trigger.inputs),
      label: known ? msg(known.key) : operationId ?? msg('trgSharePoint'),
      on: known?.on ?? 'unknown',
      ...target,
    };
  }

  if (connector === DV) {
    const parameters = trigger.inputs?.parameters ?? {};
    const entity = resolve(parameters['subscriptionRequest/entityname'], params).value;
    const message = Number(parameters['subscriptionRequest/message']);
    return {
      ...base,
      kind: 'dataverse',
      operationId: host?.operationId,
      label: DV_MESSAGES[message] ? msg(DV_MESSAGES[message]) : msg('trgRecordChanged'),
      table: typeof entity === 'string' && entity ? entity : null,
      on: message === 1 ? 'create' : message === 2 ? 'update' : message === 3 ? 'delete' : 'unknown',
    };
  }

  if (connector) {
    return {
      ...base,
      kind: 'connector',
      operationId: host?.operationId,
      label: msg('trgConnector', { connector: connectorLabel(connector), operation: host?.operationId ?? trigger.type ?? '' }),
      on: 'event',
    };
  }

  return { ...base, kind: 'other', label: trigger.type ?? msg('trgUnknown'), on: 'unknown' };
}

/**
 * Turn a workflow-definition expression into something a human reads at a glance:
 * `@equals(triggerBody()?['WFStatus'], 30)` → `WFStatus == 30`.
 * Applied when the graph is built, so every output — JSON, Markdown and the viewer — agrees.
 * Anything too nested to rewrite safely is left exactly as it was.
 */
export function prettyCondition(expression: string): string {
  let text = String(expression || '').trim().replace(/^@/, '');
  text = text.replace(/(?:triggerBody|triggerOutputs|body|outputs)\(\s*(?:'[^']*')?\s*\)\?\['(?:body\/)?([^']+)'\]/g, '$1');
  text = text.replace(/\bnot\(\s*equals\(([^(),]+),\s*([^(),]+)\)\s*\)/g, '$1 != $2');
  text = text.replace(/\bequals\(([^(),]+),\s*([^(),]+)\)/g, '$1 == $2');
  text = text.replace(/\bgreaterOrEquals\(([^(),]+),\s*([^(),]+)\)/g, '$1 >= $2');
  text = text.replace(/\blessOrEquals\(([^(),]+),\s*([^(),]+)\)/g, '$1 <= $2');
  text = text.replace(/\bgreater\(([^(),]+),\s*([^(),]+)\)/g, '$1 > $2');
  text = text.replace(/\bless\(([^(),]+),\s*([^(),]+)\)/g, '$1 < $2');
  return text.replace(/\s+/g, ' ').trim();
}

export function connectorLabel(name: string | null | undefined): string {
  if (!name) return '?';
  return String(name)
    .replace(/^shared_/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------- canvas apps

interface AppConnectionReference {
  apiId?: string;
  id?: string;
  apiTier?: string;
  dataSources?: string[];
  dependencies?: unknown[];
  dataSets?: Record<string, {
    /** The real site. The KEY of this map is not it — see parseAppReferences. */
    datasetOverride?: { name?: string; environmentVariableName?: string };
    dataSources?: Record<string, {
      tableName?: string;
      datasetName?: string;
      /** The list this environment actually binds. `tableName` is the design-time one. */
      tableNameOverride?: { name?: string; environmentVariableName?: string };
    }>;
  }>;
}

interface AppProperties {
  connectionReferences?: Record<string, AppConnectionReference>;
  databaseReferences?: Record<string, { dataSources?: Record<string, unknown> }>;
}

/**
 * Canvas app metadata → the data sources it binds. Handles both shapes the API returns:
 * `dataSets` (site → list names) and the flat `dataSources` array. Takes `unknown` because the
 * document comes straight off an API and its shape is only ever a hope.
 *
 * ⚠ **The key of `dataSets` is not the site URL.** When the app binds its site through an
 * environment variable — which every solution-aware app does — Power Apps builds the key by gluing
 * the variable's name onto the URL:
 *
 *     key                          https://contoso.sharepoint.com/sites/orders_pfx_Orders_SiteCollection
 *     datasetOverride.name         https://contoso.sharepoint.com/sites/orders
 *
 * Reading the key gives a site that does not exist, every list on it then fails to resolve, and the
 * report shows GUIDs where names belong. `datasetOverride.name` is the site; the key is only the
 * fallback for an app that binds a site literally.
 */
export function parseAppReferences(app: unknown): AppReferences {
  const envelope = (app ?? {}) as { properties?: AppProperties } & AppProperties;
  const properties: AppProperties = envelope.properties ?? envelope;
  const lists: AppReferences['lists'] = [];
  const tables: string[] = [];
  const flows: string[] = [];
  const connectors = new Set<string>();

  for (const reference of Object.values(properties.connectionReferences ?? {})) {
    const api = String(reference?.apiId ?? reference?.id ?? '').split('/').pop() || reference?.apiTier;
    if (api) connectors.add(api);

    if (/logicflows/i.test(api ?? '')) {
      for (const name of reference?.dataSources ?? []) flows.push(String(name));
      for (const dependency of reference?.dependencies ?? []) {
        if (typeof dependency === 'string') flows.push(dependency);
      }
      continue;
    }

    let matched = false;
    for (const [key, set] of Object.entries(reference?.dataSets ?? {})) {
      const siteUrl = normalizeSite(set?.datasetOverride?.name ?? key);
      for (const [listName, entry] of Object.entries(set?.dataSources ?? {})) {
        matched = true;
        // Same trap as the site above, one level down: `tableName` is the GUID baked in when the
        // app was authored — the list as it existed in the environment it was built in. What THIS
        // environment binds is `tableNameOverride.name`, the current value of the environment
        // variable. Reading the base value points at a list that does not exist here, so the name
        // never resolves and the report shows a GUID. The override is missing its `name` when the
        // variable has no value yet, which is when the baked-in one is all there is.
        //
        // Note this is the value STORED IN THE APP, not the live variable in Dataverse — and that
        // is deliberate. A canvas app resolves its environment variables when the solution is
        // imported and then holds the result; changing the variable afterwards does nothing until
        // the app is republished. So the stored override is what the app binds TODAY, which is what
        // the graph is about. A flow is the opposite — it resolves `@parameters(…)` on every run,
        // which is why parseFlow takes the live values instead. Measured on one environment: 56 of
        // 56 data sources agreed with the live variable, 0 had drifted.
        const listId = entry?.tableNameOverride?.name ?? entry?.tableName ?? entry?.datasetName ?? null;
        lists.push({
          site: siteUrl,
          name: listName,
          listId,
          envVar: entry?.tableNameOverride?.environmentVariableName ?? null,
        });
      }
    }
    if (!matched && /sharepoint/i.test(api ?? '')) {
      for (const name of reference?.dataSources ?? []) {
        lists.push({ site: null, name: String(name), listId: null, envVar: null });
      }
    }
  }

  for (const database of Object.values(properties.databaseReferences ?? {})) {
    for (const name of Object.keys(database?.dataSources ?? {})) tables.push(name);
  }

  return { lists, tables, flows, connectors: [...connectors] };
}
