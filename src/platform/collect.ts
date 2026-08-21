// Data collection. Every collector degrades gracefully: a source that is blocked in a tenant
// produces a warning, never an aborted run — a partial graph still answers most questions.
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, RESOURCE, apiGet, apiGetAll, pooled } from './http.js';
import { getToken, tokenError } from './auth.js';
import { normalizeSite, parseAppReferences, parseFlow } from './parse.js';
import { msg } from '../i18n/index.js';
import type { Phrase } from '../i18n/index.js';
import type {
  AppRecord, CollectContext, CollectedEnvironment, FlowRecord, FlowState, ListIndex, ListInfo,
  SolutionRef, SourceStatus, TableIndex,
} from '../types.js';

const DV_HEADERS = { 'OData-MaxVersion': '4.0', 'OData-Version': '4.0', Prefer: 'odata.maxpagesize=200' };
const FLOW_API = 'https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple';
const POWERAPPS_API = 'https://api.powerapps.com/providers/Microsoft.PowerApps';

/** Component types we care about in `solutioncomponent`. */
const COMPONENT_WORKFLOW = 29;
const COMPONENT_CANVASAPP = 300;

type Recorder = (name: Phrase, ok: boolean, detail?: Phrase) => void;

export async function collectEnvironment(ctx: CollectContext): Promise<CollectedEnvironment> {
  const sources: SourceStatus<Phrase>[] = [];
  const record: Recorder = (name, ok, detail) => { sources.push({ name, ok, detail }); };
  // A skipped collector is REPORTED, not silently absent — a graph missing half its apps must not
  // look like an environment that has none.
  const wanted = (key: Parameters<CollectContext['skip']['has']>[0], name: Phrase): boolean => {
    if (!ctx.skip.has(key)) return true;
    record(name, true, msg('srcSkipped'));
    return false;
  };

  const dataverse = ctx.dataverseUrl && wanted('dataverse', msg('srcDataverse'))
    ? ctx.dataverseUrl.replace(/\/+$/, '')
    : null;
  let dvToken: string | null = null;
  if (dataverse) {
    dvToken = await getToken(dataverse, ctx.tenantId);
    if (!dvToken) {
      record(msg('srcDataverse'), false, msg('srcNoToken', { error: tokenError(dataverse) }));
      ctx.warn(msg('warnDataverseUnreachable', { url: dataverse }));
    }
  }
  const dv = dataverse && dvToken ? { url: dataverse, token: dvToken } : null;

  const envVars = dv && wanted('variables', msg('srcEnvVars'))
    ? await collectEnvVars(dv.url, dv.token, record)
    : new Map<string, string>();
  const solutionsByObject = dv && wanted('solutions', msg('srcSolutions'))
    ? await collectSolutions(dv.url, dv.token, record)
    : new Map<string, SolutionRef>();

  const flows = new Map<string, FlowRecord>();
  if (dv) await collectDataverseFlows(ctx, dv.url, dv.token, envVars, solutionsByObject, flows, record);
  if (wanted('powerautomate', msg('srcFlowsFlowApi'))) await collectFlowApiFlows(ctx, envVars, flows, record);

  const apps = new Map<string, AppRecord>();
  if (wanted('powerapps', msg('srcApps'))) {
    await collectPowerApps(ctx, apps, record);
    if (dv) await collectDataverseApps(dv.url, dv.token, solutionsByObject, apps, record);
  }

  // Last, because it can only ask about the tables the flows and apps turned out to reference.
  const tableIds = dv
    ? await collectTableIds(dv.url, dv.token, [...flows.values()], [...apps.values()], record)
    : new Map();

  return { flows: [...flows.values()], apps: [...apps.values()], envVars, tableIds, sources };
}

interface EntityDefinitionRow {
  LogicalName: string;
  EntitySetName: string;
  MetadataId: string;
}

/**
 * Dataverse counts a `$filter` by how deep the parsed expression nests and refuses at 100. An
 * `or` chain is one condition per level, and every name here contributes two of them, so the ask
 * goes out in batches: 25 names — 50 conditions — leaves room, one request per 25 tables is cheap,
 * and an environment with 74 referenced tables no longer loses every portal link to one HTTP 400.
 */
const TABLE_BATCH = 25;

/**
 * The id the maker portal addresses a table by.
 *
 * A table's logical name is what every other part of this tool works with, but
 * The portal link wants the MetadataId, so without this lookup a Dataverse table is the only node
 * type with no way to open it. Asked only for the tables this environment references — a catalogue
 * holds hundreds, a graph touches a handful.
 */
async function collectTableIds(
  dataverse: string,
  token: string,
  flows: FlowRecord[],
  apps: AppRecord[],
  record: Recorder,
): Promise<TableIndex> {
  const wanted = new Set<string>();
  for (const flow of flows) {
    if (flow.trigger?.table) wanted.add(flow.trigger.table.toLowerCase());
    for (const operation of flow.operations) if (operation.table) wanted.add(operation.table.toLowerCase());
  }
  for (const app of apps) for (const table of app.tables) wanted.add(table.toLowerCase());
  if (wanted.size === 0) return new Map();

  const ids: TableIndex = new Map();
  try {
    // Asked BOTH ways round, and indexed both ways too. A flow definition names a table by its
    // entity SET name — `knowledgearticles` — while Dataverse filters on the logical name
    // `knowledgearticle`; matching only the latter found one table in six here.
    const names = [...wanted].map((name) => name.replace(/'/g, "''"));
    const batches: string[][] = [];
    for (let at = 0; at < names.length; at += TABLE_BATCH) batches.push(names.slice(at, at + TABLE_BATCH));

    const rows = (await pooled(batches, 4, (batch) => {
      const filter = batch.map((name) => `LogicalName eq '${name}' or EntitySetName eq '${name}'`).join(' or ');
      return dvQuery<EntityDefinitionRow>(dataverse, token,
        `EntityDefinitions?$select=LogicalName,EntitySetName,MetadataId&$filter=${encodeURIComponent(filter)}`);
    })).flat();

    for (const row of rows) {
      const table = { logicalName: row.LogicalName, metadataId: row.MetadataId };
      ids.set(row.LogicalName.toLowerCase(), table);
      if (row.EntitySetName) ids.set(row.EntitySetName.toLowerCase(), table);
    }
    record(msg('srcTables'), true, msg('srcTablesFound', { found: [...wanted].filter((name) => ids.has(name)).length, total: wanted.size }));
  } catch (error) {
    // A missing link is cosmetic — the table still appears with everything that touches it.
    record(msg('srcTables'), false, describe(error));
  }
  return ids;
}

// ---------------------------------------------------------------- Dataverse

function dvQuery<T>(dataverse: string, token: string, query: string): Promise<T[]> {
  return apiGetAll<T>(`${dataverse}/api/data/v9.2/${query}`, token, { headers: DV_HEADERS });
}

interface EnvVarDefinition {
  environmentvariabledefinitionid: string;
  schemaname: string;
  defaultvalue?: string;
}

interface EnvVarValue {
  value?: string;
  _environmentvariabledefinitionid_value: string;
}

async function collectEnvVars(dataverse: string, token: string, record: Recorder): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  try {
    const [definitions, currentValues] = await Promise.all([
      dvQuery<EnvVarDefinition>(dataverse, token,
        'environmentvariabledefinitions?$select=environmentvariabledefinitionid,schemaname,displayname,defaultvalue'),
      dvQuery<EnvVarValue>(dataverse, token,
        'environmentvariablevalues?$select=value,_environmentvariabledefinitionid_value'),
    ]);
    const byId = new Map(currentValues.map((value) => [value._environmentvariabledefinitionid_value, value.value]));
    for (const definition of definitions) {
      const live = byId.get(definition.environmentvariabledefinitionid);
      const resolved = live ?? definition.defaultvalue;
      if (resolved !== undefined && resolved !== null) values.set(definition.schemaname, resolved);
    }
    record(msg('srcEnvVars'), true, msg('srcFound', { count: values.size }));
  } catch (error) {
    record(msg('srcEnvVars'), false, describe(error));
  }
  return values;
}

interface SolutionRow {
  solutionid: string;
  uniquename: string;
  friendlyname?: string;
  ismanaged?: boolean;
}

interface SolutionComponentRow {
  objectid: string;
  componenttype: number;
  _solutionid_value: string;
}

async function collectSolutions(dataverse: string, token: string, record: Recorder): Promise<Map<string, SolutionRef>> {
  const byObject = new Map<string, SolutionRef>();
  try {
    const [solutions, components] = await Promise.all([
      dvQuery<SolutionRow>(dataverse, token,
        'solutions?$select=solutionid,uniquename,friendlyname,ismanaged,isvisible&$filter=isvisible eq true'),
      dvQuery<SolutionComponentRow>(dataverse, token,
        `solutioncomponents?$select=objectid,componenttype,_solutionid_value`
        + `&$filter=componenttype eq ${COMPONENT_WORKFLOW} or componenttype eq ${COMPONENT_CANVASAPP}`),
    ]);

    const solutionById = new Map(solutions.map((solution) => [solution.solutionid, solution]));
    for (const component of components) {
      const solution = solutionById.get(component._solutionid_value);
      if (!solution || /^(Active|Default|Basic)$/i.test(solution.uniquename)) continue;

      const key = String(component.objectid).toLowerCase();
      const existing = byObject.get(key);
      // An unmanaged solution is the one we actually work in — let it win over a managed carrier.
      if (!existing || (existing.managed && !solution.ismanaged)) {
        byObject.set(key, {
          uniqueName: solution.uniquename,
          name: solution.friendlyname,
          managed: solution.ismanaged,
          id: solution.solutionid,
        });
      }
    }
    record(msg('srcSolutions'), true, msg('srcSolutionsFound', { solutions: solutions.length, objects: byObject.size }));
  } catch (error) {
    record(msg('srcSolutions'), false, describe(error));
  }
  return byObject;
}

interface WorkflowRow {
  workflowid: string;
  name: string;
  statecode?: number;
  clientdata?: string;
  ismanaged?: boolean;
  modifiedon?: string;
}

async function collectDataverseFlows(
  ctx: CollectContext,
  dataverse: string,
  token: string,
  envVars: Map<string, string>,
  solutionsByObject: Map<string, SolutionRef>,
  flows: Map<string, FlowRecord>,
  record: Recorder,
): Promise<void> {
  try {
    const rows = await dvQuery<WorkflowRow>(dataverse, token,
      'workflows?$select=workflowid,name,category,statecode,statuscode,clientdata,ismanaged,modifiedon'
      + '&$filter=category eq 5 and type eq 1');

    for (const row of rows) {
      const key = normalizeName(row.name);
      flows.set(key, {
        key,
        name: row.name,
        workflowId: row.workflowid,
        flowId: null,
        state: row.statecode === 1 ? 'enabled' : 'disabled',
        managed: Boolean(row.ismanaged),
        modified: row.modifiedon,
        solution: solutionsByObject.get(String(row.workflowid).toLowerCase()) ?? null,
        source: 'Dataverse',
        ...parseFlow(row.clientdata, envVars),
      });
    }
    record(msg('srcFlowsDataverse'), true, msg('srcFound', { count: rows.length }));
  } catch (error) {
    record(msg('srcFlowsDataverse'), false, describe(error));
    ctx.warn(msg('warnFlowsUnreadable', { error: describe(error) }));
  }
}

interface FlowApiFlow {
  name: string;
  properties?: {
    displayName?: string;
    state?: string;
    lastModifiedTime?: string;
    definition?: unknown;
  };
}

async function collectFlowApiFlows(
  ctx: CollectContext,
  envVars: Map<string, string>,
  flows: Map<string, FlowRecord>,
  record: Recorder,
): Promise<void> {
  const token = await getToken(RESOURCE.flow, ctx.tenantId);
  if (!token) {
    record(msg('srcFlowsFlowApi'), false, msg('srcNoToken', { error: tokenError(RESOURCE.flow) }));
    return;
  }

  let listed: FlowApiFlow[];
  try {
    listed = await apiGetAll<FlowApiFlow>(
      `${FLOW_API}/environments/${ctx.environmentId}/flows?api-version=2016-11-01`, token);
  } catch (error) {
    record(msg('srcFlowsFlowApi'), false, describe(error));
    return;
  }

  // Fill in the ones Dataverse does not know (flow-service-only objects) and add the portal ids.
  const needsDefinition: Array<{ key: string; flow: FlowApiFlow; displayName: string }> = [];
  for (const flow of listed) {
    const displayName = flow.properties?.displayName ?? flow.name;
    const key = normalizeName(displayName);
    const known = flows.get(key);
    if (known) {
      known.flowId = flow.name;
      known.state = flowState(flow.properties?.state) ?? known.state;
      continue;
    }
    needsDefinition.push({ key, flow, displayName });
  }

  await pooled(needsDefinition, 8, async ({ key, flow, displayName }) => {
    let full = flow;
    if (!flow.properties?.definition) {
      try {
        full = await apiGet<FlowApiFlow>(
          `${FLOW_API}/environments/${ctx.environmentId}/flows/${flow.name}?api-version=2016-11-01`, token);
      } catch {
        // keep the summary — the flow is still worth a node
      }
    }
    // The name is the JOIN key against Dataverse — two systems, one display name, different ids —
    // and that is why it cannot also be the identity. Two flows that share a name and exist in
    // NEITHER solution overwrote each other here, so one of them silently vanished from the report
    // and which one was down to the order the Flow API happened to page in. Measured 18.08.2026:
    // "SGA Support 2" exists twice in one environment and two runs disagreed about which one it is.
    const unique = flows.has(key) ? `${key}#${flow.name}` : key;
    flows.set(unique, {
      key: unique,
      name: displayName,
      workflowId: null,
      flowId: flow.name,
      state: flowState(full.properties?.state),
      managed: false,
      modified: full.properties?.lastModifiedTime,
      solution: null,
      source: 'Flow-API',
      ...parseFlow(full.properties, envVars),
    });
  });

  record(msg('srcFlowsFlowApi'), true, msg('srcFlowApiFound', { visible: listed.length, only: needsDefinition.length }));
}

interface CanvasAppRow {
  canvasappid: string;
  name?: string;
  displayname?: string;
  connectionreferences?: string;
  databasereferences?: string;
  appopenuri?: string;
}

async function collectDataverseApps(
  dataverse: string,
  token: string,
  solutionsByObject: Map<string, SolutionRef>,
  apps: Map<string, AppRecord>,
  record: Recorder,
): Promise<void> {
  const select = '$select=canvasappid,name,displayname,connectionreferences,databasereferences,appopenuri,ismanaged';
  let rows: CanvasAppRow[];
  try {
    rows = await dvQuery<CanvasAppRow>(dataverse, token, `canvasapps?${select}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 400) {
      try {
        rows = await dvQuery<CanvasAppRow>(dataverse, token, 'canvasapps?$select=canvasappid,name,displayname');
      } catch (inner) {
        record(msg('srcAppsDataverse'), false, describe(inner));
        return;
      }
    } else {
      record(msg('srcAppsDataverse'), false, describe(error));
      return;
    }
  }

  let added = 0;
  let enriched = 0;
  for (const row of rows) {
    const id = String(row.canvasappid).toLowerCase();
    const solution = solutionsByObject.get(id) ?? null;
    const parsed = parseAppReferences({
      properties: {
        connectionReferences: safeJson(row.connectionreferences),
        databaseReferences: safeJson(row.databasereferences),
      },
    });
    const existing = apps.get(id);
    if (existing) {
      existing.solution = existing.solution ?? solution;
      existing.name = existing.name || (row.displayname ?? '');
      /*
       * The two APIs do NOT return the same thing for the same app, and the difference is the site.
       *
       * The PowerApps API returns a summary: its SharePoint connection reference carries a flat
       * `dataSources` array of list NAMES and no `dataSets` at all. The Dataverse row carries the
       * full `dataSets` — site URL, list GUID, even the environment variable behind each. Measured
       * on one app: PowerApps API 0 datasets / 11 bare names, Dataverse 2 sites / 6 lists.
       *
       * Taking whichever arrived first meant every app that exists in both was read from the poorer
       * one, which is why lists showed up with no site. Richer wins instead: more site-qualified
       * lists is strictly more knowledge, never less.
       */
      const qualified = (list: typeof parsed.lists): number => list.filter((entry) => entry.site).length;
      if (qualified(parsed.lists) > qualified(existing.lists)) {
        existing.lists = parsed.lists;
        existing.connectors = [...new Set([...existing.connectors, ...parsed.connectors])];
        enriched++;
      }
      existing.tables = [...new Set([...existing.tables, ...parsed.tables])];
      existing.flows = [...new Set([...existing.flows, ...parsed.flows])];
      continue;
    }
    added++;
    apps.set(id, {
      id,
      name: row.displayname ?? row.name ?? id,
      solution,
      source: 'Dataverse',
      studioUrl: row.appopenuri ?? null,
      ...parsed,
    });
  }
  record(msg('srcAppsDataverse'), true,
    msg('srcAppsFound', { count: rows.length, added, enriched }));
}

interface PowerAppsApp {
  name: string;
  properties?: { displayName?: string };
}

async function collectPowerApps(ctx: CollectContext, apps: Map<string, AppRecord>, record: Recorder): Promise<void> {
  const token = await getToken(RESOURCE.powerapps, ctx.tenantId);
  if (!token) {
    record(msg('srcAppsPowerApps'), false, msg('srcNoToken', { error: tokenError(RESOURCE.powerapps) }));
    return;
  }
  try {
    const filter = encodeURIComponent(`environment eq '${ctx.environmentId}'`);
    const listed = await apiGetAll<PowerAppsApp>(
      `${POWERAPPS_API}/apps?api-version=2016-11-01&$filter=${filter}`, token);

    for (const app of listed) {
      const id = String(app.name).toLowerCase();
      apps.set(id, {
        id,
        name: app.properties?.displayName ?? app.name,
        solution: null,
        source: 'PowerApps-API',
        studioUrl: `https://make.powerapps.com/e/${ctx.environmentId}/canvas/?action=edit&app-id=${app.name}`,
        ...parseAppReferences(app),
      });
    }
    record(msg('srcAppsPowerApps'), true, msg('srcFound', { count: listed.length }));
  } catch (error) {
    record(msg('srcAppsPowerApps'), false, describe(error));
  }
}

// ---------------------------------------------------------------- SharePoint

interface SiteLists {
  ok: boolean;
  error?: string;
  via?: string;
  lists: Array<{ Id: string; Title: string; ItemCount?: number; Hidden?: boolean; Url?: string }>;
}

type ListNameCache = Record<string, SiteLists>;

/**
 * Turn the list GUIDs the definitions carry into names the maker recognises.
 *
 * One request, `_api/web/lists`, with a token from the SharePoint Online Management Shell client —
 * the same first-party application PnP PowerShell signs in with, which is why it works in tenants
 * where the Azure CLI's token is refused. That client is the whole SharePoint story now: no
 * PowerShell, no module, no second tool to install.
 *
 * The result is cached next to the graph, so a second run costs nothing.
 */
export async function resolveSharePointLists(
  ctx: CollectContext,
  siteUrls: Array<string | null | undefined>,
  record: Recorder,
): Promise<{ index: ListIndex; reached: number; total: number; via: string }> {
  /*
   * SharePoint site URLs are case-insensitive, and the same site turns up in several spellings:
   * a flow definition writes `/sites/FieldService`, an environment variable `/sites/fieldservice`. Deduplicating
   * case-sensitively read one of them twice, and the second read failed — leaving a site reported as
   * unreachable that had in fact just been read successfully under its other spelling.
   *
   * Everything downstream already looks up lowercased, so the lowercase form is the key here too.
   */
  const seen = new Map<string, string>();
  for (const raw of siteUrls) {
    const site = normalizeSite(raw);
    if (site) seen.set(site.toLowerCase(), site.toLowerCase());
  }
  const sites = [...seen.values()].sort();
  if (sites.length === 0) return { index: new Map(), reached: 0, total: 0, via: '—' };

  // A site that could not be read is cached too — otherwise every run pays for the same failure.
  const cache: ListNameCache = ctx.refreshNames ? {} : readCache(ctx.cacheFile);
  const missing = sites.filter((site) => !cache[site]);

  if (missing.length > 0) {
    // The token first, on its own: it may open a browser, and that belongs in a predictable place
    // rather than interleaved with four workers reporting sites.
    const first = missing[0];
    if (first) await getToken(new URL(first).origin, ctx.tenantId);

    // Why a site could not be read is kept, not thrown away. Without this the fallback's own
    // failure — or, once there is no fallback, nothing at all — overwrites the real reason with the
    // word "unreachable", and a permission problem becomes indistinguishable from a typo.
    const refused = new Map<string, SiteLists>();
    for (const [site, result] of await readLists(ctx, missing)) {
      if (result.ok) cache[site] = { ...result, via: 'spo' };
      else refused.set(site, { ...result, via: 'spo' });
    }
    for (const site of missing) {
      if (!cache[site]) cache[site] = refused.get(site) ?? { ok: false, error: 'unreachable', lists: [] };
    }
    writeCache(ctx.cacheFile, cache);
  }

  const reached = sites.filter((site) => cache[site]?.ok);
  const via = [...new Set(reached.map((site) => cache[site]?.via))].filter(Boolean).join('+') || '—';
  record(msg('srcSharePointNames'), reached.length > 0,
    msg('srcSitesRead', { reached: reached.length, total: sites.length, via }));
  if (reached.length < sites.length) {
    ctx.warn(msg('warnSiteNamesMissing', { failed: sites.length - reached.length, total: sites.length }));
  }

  const byList: ListIndex = new Map();
  for (const site of reached) {
    for (const list of cache[site]?.lists ?? []) {
      const entry: ListInfo = {
        title: list.Title,
        id: String(list.Id).toLowerCase(),
        itemCount: list.ItemCount ?? null,
        hidden: Boolean(list.Hidden),
        url: list.Url ? new URL(list.Url, site).href : null,
      };
      byList.set(`${site.toLowerCase()}::${entry.id}`, entry);
      byList.set(`${site.toLowerCase()}::${String(list.Title).toLowerCase()}`, entry);
    }
  }
  return { index: byList, reached: reached.length, total: sites.length, via };
}

interface SpoList {
  Id: string;
  Title: string;
  ItemCount?: number;
  Hidden?: boolean;
  DefaultViewUrl?: string;
}

async function readLists(ctx: CollectContext, sites: string[]): Promise<Array<[string, SiteLists]>> {
  let refused = false;

  return pooled(sites, 4, async (site): Promise<[string, SiteLists]> => {
    if (refused) return [site, { ok: false, error: 'skipped', lists: [] }];

    const host = new URL(site).origin;
    const token = await getToken(host, ctx.tenantId);
    if (!token) {
      refused = true;
      return [site, { ok: false, error: `no SharePoint token (${tokenError(host)})`, lists: [] }];
    }
    try {
      const body = await apiGet<{ value?: SpoList[] }>(
        `${site}/_api/web/lists?$select=Id,Title,Hidden,BaseTemplate,ItemCount,DefaultViewUrl`,
        token,
        { accept: 'application/json;odata=nometadata' },
      );
      const lists = (body.value ?? []).filter((list) => !list.Hidden).map((list) => ({
        Id: list.Id, Title: list.Title, ItemCount: list.ItemCount, Hidden: list.Hidden, Url: list.DefaultViewUrl,
      }));
      return [site, { ok: true, lists }];
    } catch (error) {
      // A 401 is the tenant refusing this client outright — every other site will go the same way.
      // A 403 is NOT: that is one site the signed-in user may not read, and it must not poison the
      // others. The delegated token is still bounded by per-site permissions.
      if (error instanceof ApiError && error.status === 401) refused = true;
      return [site, { ok: false, error: describe(error), lists: [] }];
    }
  });
}

function readCache(file: string): ListNameCache {
  try {
    return file && fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as ListNameCache) : {};
  } catch {
    return {};
  }
}

function writeCache(file: string, cache: ListNameCache): void {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(cache, null, 1)}\n`, 'utf8');
  } catch {
    // a missing cache only costs time on the next run
  }
}

// ---------------------------------------------------------------- helpers

function flowState(state: string | undefined): FlowState | null {
  if (!state) return null;
  if (/^started$/i.test(state)) return 'enabled';
  if (/^(stopped|suspended)$/i.test(state)) return 'disabled';
  return 'unknown';
}

export function normalizeName(name: string | undefined | null): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * A name reduced to letters and digits.
 *
 * Power Apps stores the flows an app calls as FORMULA IDENTIFIERS — every space and separator
 * stripped — so "csr | IT | change Request Approvers" is filed as "csr|IT|changeRequestApprovers".
 * Comparing plain names therefore misses nearly every flow whose name contains a space.
 */
export function squashName(name: string | undefined | null): string {
  return String(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Dataverse hands these columns over as JSON text; a broken one must not take the run down. */
function safeJson(text: string | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] ?? error.message : String(error);
}
