// Generates the demo report shown in the README, from invented data only.
//
//   node scripts/sample-report.mjs [outDir]
//
// No tenant, no sign-in, no network: it feeds the same builder and renderer the CLI uses with a
// fictional environment, so the picture stays honest about what the tool actually produces.
import fs from 'node:fs';
import path from 'node:path';

const dist = (name) => new URL(`../dist/${name}`, import.meta.url).href;
const { buildGraph } = await import(dist('graph/build.js'));
const { materialize } = await import(dist('graph/materialize.js'));
const { renderHtml } = await import(dist('render/html.js'));
const { renderMarkdown } = await import(dist('render/markdown.js'));
const { translator } = await import(dist('i18n/index.js'));

const HOST = 'https://contoso.sharepoint.com';
const site = (name) => `${HOST}/sites/${name}`;

// ---------------------------------------------------------------- the invented environment

const flows = [];
const apps = [];

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

const trigger = (kind, on, place, conditions = []) => ({
  name: 'When an item is created or modified',
  kind,
  connector: kind === 'sharepoint' ? 'sharepointonline' : 'commondataservice',
  label: on === 'create' ? 'item created' : on === 'delete' ? 'item deleted' : 'item created or modified',
  on,
  conditions,
  recurrence: null,
  splitOn: false,
  ...place,
});

const manual = () => ({
  name: 'Manually trigger a flow',
  kind: 'http',
  connector: null,
  label: 'manual or child flow',
  on: 'call',
  conditions: [],
  recurrence: null,
  splitOn: false,
});

const schedule = () => ({
  name: 'Recurrence',
  kind: 'schedule',
  connector: null,
  label: 'every day at 06:00',
  on: 'schedule',
  conditions: [],
  recurrence: { frequency: 'Day', interval: 1 },
  splitOn: false,
});

const op = (verb, place, action) => ({
  action,
  connector: place.table ? 'commondataservice' : 'sharepointonline',
  verb,
  ...place,
});

const list = (siteName, listName) => ({ site: site(siteName), list: listName });
const table = (name) => ({ table: name });

const flow = (name, solution, trg, operations, extra = {}) => {
  flows.push({
    key: name,
    name,
    workflowId: id(),
    flowId: null,
    state: 'enabled',
    managed: false,
    solution: { uniqueName: solution.replace(/\s/g, ''), name: solution },
    source: 'Dataverse',
    trigger: trg,
    operations,
    childFlows: [],
    connectors: [...new Set(operations.map((o) => o.connector))],
    connectionReferences: [],
    parsed: true,
    ...extra,
  });
};

const app = (name, solution, lists, tables = [], calls = []) => {
  apps.push({
    id: id(),
    name,
    solution: { uniqueName: solution.replace(/\s/g, ''), name: solution },
    source: 'Dataverse',
    studioUrl: null,
    lists: lists.map(([s, l]) => ({ site: site(s), name: l, listId: null })),
    tables,
    flows: calls,
    connectors: ['sharepointonline'],
  });
};

// ── Field Service ───────────────────────────────────────────────────────────
flow('Field Service | Dispatch work order', 'Field Service',
  trigger('sharepoint', 'createOrUpdate', list('fieldservice', 'WorkOrders'), ["Status == 'Ready'"]),
  [op('updates', list('fieldservice', 'WorkOrders'), 'Update item - assign technician'),
   op('creates', list('fieldservice', 'Assignments'), 'Create item - Assignment'),
   op('reads', list('fieldservice', 'Technicians'), 'Get items - available technicians')]);

flow('Field Service | Notify technician', 'Field Service',
  trigger('sharepoint', 'create', list('fieldservice', 'Assignments')),
  [op('reads', list('fieldservice', 'Technicians'), 'Get item - technician'),
   op('updates', list('fieldservice', 'Assignments'), 'Update item - notified')]);

flow('Field Service | Close work order', 'Field Service',
  trigger('sharepoint', 'createOrUpdate', list('fieldservice', 'Assignments'), ["Outcome != ''"]),
  [op('updates', list('fieldservice', 'WorkOrders'), 'Update item - close'),
   op('creates', list('fieldservice', 'TimeEntries'), 'Create item - Time entry')]);

flow('Field Service | Weekly utilisation report', 'Field Service', schedule(),
  [op('reads', list('fieldservice', 'TimeEntries'), 'Get items - last week'),
   op('creates', list('fieldservice', 'Reports'), 'Create item - Report')]);

flow('Field Service | Escalate overdue orders', 'Field Service', schedule(),
  [op('reads', list('fieldservice', 'WorkOrders'), 'Get items - overdue'),
   op('updates', list('fieldservice', 'WorkOrders'), 'Update item - escalate'),
   op('creates', list('portal', 'Notifications'), 'Create item - Notification')]);

flow('Field Service | Sync customer data', 'Field Service', schedule(),
  [op('reads', table('account'), 'List rows - accounts'),
   op('updates', list('fieldservice', 'Customers'), 'Update item - customer')]);

app('Field Technician App', 'Field Service',
  [['fieldservice', 'WorkOrders'], ['fieldservice', 'Assignments'], ['fieldservice', 'TimeEntries']],
  ['account'], ['Field Service | Close work order']);
app('Dispatch Board', 'Field Service',
  [['fieldservice', 'WorkOrders'], ['fieldservice', 'Technicians']], [], []);

// ── Purchase Requests — the deep approval chain ─────────────────────────────
const STAGES = [
  [10, 'Requester revision'], [20, 'Team lead check'], [30, 'Department approval'],
  [40, 'Finance review'], [50, 'Controlling review'], [60, 'CFO approval'],
  [70, 'CEO approval'], [90, 'Rejected'],
];
for (const [step, label] of STAGES) {
  flow(`Purchase Requests | ${step} ${label}`, 'Purchase Requests',
    trigger('sharepoint', 'createOrUpdate', list('purchasing', 'PurchaseRequests'),
      ["Action == 'Create approval task'", `StatusNumber == ${step}`]),
    [op('updates', list('purchasing', 'PurchaseRequests'), 'Update item - advance status'),
     op('creates', list('purchasing', 'ApprovalTasks'), 'Create item - Approval task'),
     op('updates', list('purchasing', 'ApprovalTasks'), 'Update item - assign approver')]);
}
flow('Purchase Requests | Process task outcome', 'Purchase Requests',
  trigger('sharepoint', 'createOrUpdate', list('purchasing', 'ApprovalTasks'), ["Outcome != ''"]),
  [op('updates', list('purchasing', 'PurchaseRequests'), 'Update item - next stage'),
   op('creates', list('purchasing', 'AuditTrail'), 'Create item - Audit entry')]);
flow('Purchase Requests | Notify approver', 'Purchase Requests',
  trigger('sharepoint', 'create', list('purchasing', 'ApprovalTasks')),
  [op('creates', list('portal', 'Notifications'), 'Create item - Notification')]);
flow('Purchase Requests | Generate PDF', 'Purchase Requests',
  trigger('sharepoint', 'createOrUpdate', list('purchasing', 'PurchaseRequests'), ["Action == 'Generate PDF'"]),
  [op('updates', list('purchasing', 'PurchaseRequests'), 'Update item - attach PDF')]);
flow('Purchase Requests | Send initial email', 'Purchase Requests',
  trigger('sharepoint', 'createOrUpdate', list('purchasing', 'PurchaseRequests'),
    ["Action == 'Send email'", 'StatusNumber == 0', "Draft == 'no'"]),
  [op('updates', list('purchasing', 'PurchaseRequests'), 'Update item - mark sent')]);
flow('Purchase Requests | Request deleted', 'Purchase Requests',
  trigger('sharepoint', 'delete', list('purchasing', 'PurchaseRequests')),
  [op('deletes', list('purchasing', 'ApprovalTasks'), 'Delete item - Approval task'),
   op('deletes', list('purchasing', 'AuditTrail'), 'Delete item - Audit entry')]);
flow('Purchase Requests | Archive closed requests', 'Purchase Requests', schedule(),
  [op('reads', list('purchasing', 'PurchaseRequests'), 'Get items - closed'),
   op('creates', list('archive', 'ArchivedRequests'), 'Create item - Archived request')]);

app('Purchase Request App', 'Purchase Requests',
  [['purchasing', 'PurchaseRequests'], ['purchasing', 'ApprovalTasks'], ['purchasing', 'CostCentres']],
  [], ['Purchase Requests | Generate PDF']);
app('Approval Inbox', 'Purchase Requests', [['purchasing', 'ApprovalTasks']], [], []);

// ── HR Onboarding ───────────────────────────────────────────────────────────
flow('HR Onboarding | Create starter record', 'HR Onboarding',
  trigger('sharepoint', 'create', list('hr', 'NewStarters')),
  [op('creates', list('hr', 'OnboardingTasks'), 'Create item - Onboarding task'),
   op('creates', list('it', 'EquipmentRequests'), 'Create item - Equipment request'),
   op('creates', table('contact'), 'Add a new row - contact')]);
flow('HR Onboarding | Order equipment', 'HR Onboarding',
  trigger('sharepoint', 'create', list('it', 'EquipmentRequests')),
  [op('updates', list('it', 'EquipmentRequests'), 'Update item - ordered'),
   op('creates', list('purchasing', 'PurchaseRequests'), 'Create item - Purchase request')]);
flow('HR Onboarding | Track task completion', 'HR Onboarding',
  trigger('sharepoint', 'createOrUpdate', list('hr', 'OnboardingTasks'), ["Status == 'Done'"]),
  [op('updates', list('hr', 'NewStarters'), 'Update item - progress')]);
flow('HR Onboarding | Welcome email', 'HR Onboarding',
  trigger('sharepoint', 'createOrUpdate', list('hr', 'NewStarters'), ["StartDate == utcNow('yyyy-MM-dd')"]),
  [op('creates', list('portal', 'Notifications'), 'Create item - Notification')]);
flow('HR Onboarding | Close onboarding', 'HR Onboarding',
  trigger('sharepoint', 'createOrUpdate', list('hr', 'NewStarters'), ['Progress == 100']),
  [op('updates', list('hr', 'NewStarters'), 'Update item - complete'),
   op('creates', list('archive', 'ArchivedStarters'), 'Create item - Archived starter')]);
flow('HR Onboarding | Reminder for open tasks', 'HR Onboarding', schedule(),
  [op('reads', list('hr', 'OnboardingTasks'), 'Get items - open'),
   op('creates', list('portal', 'Notifications'), 'Create item - Notification')]);

app('Onboarding Portal', 'HR Onboarding',
  [['hr', 'NewStarters'], ['hr', 'OnboardingTasks']], ['contact'], ['HR Onboarding | Welcome email']);

// ── Quality Audits — holds the unguarded self-trigger ───────────────────────
flow('Quality Audits | Recalculate scores', 'Quality Audits',
  trigger('sharepoint', 'createOrUpdate', list('quality', 'Findings')),
  [op('updates', list('quality', 'Findings'), 'Update item - score'),
   op('updates', list('quality', 'Audits'), 'Update item - roll-up')]);
flow('Quality Audits | Create action items', 'Quality Audits',
  trigger('sharepoint', 'create', list('quality', 'Findings')),
  [op('creates', list('quality', 'Actions'), 'Create item - Action')]);
flow('Quality Audits | Close audit', 'Quality Audits',
  trigger('sharepoint', 'createOrUpdate', list('quality', 'Actions'), ["Status == 'Closed'"]),
  [op('updates', list('quality', 'Audits'), 'Update item - close'),
   op('reads', list('quality', 'Findings'), 'Get items - open findings')]);
flow('Quality Audits | Publish audit report', 'Quality Audits', manual(),
  [op('reads', list('quality', 'Audits'), 'Get item - audit'),
   op('creates', list('portal', 'Documents'), 'Create item - Document')]);
flow('Quality Audits | Yearly audit plan', 'Quality Audits', schedule(),
  [op('creates', list('quality', 'Audits'), 'Create item - Audit')]);
flow('Quality Audits | Legacy score export', 'Quality Audits', schedule(),
  [op('reads', list('quality', 'Findings'), 'Get items')], { state: 'disabled' });

app('Audit App', 'Quality Audits',
  [['quality', 'Audits'], ['quality', 'Findings'], ['quality', 'Actions']], [], []);

// ── Contract Management ─────────────────────────────────────────────────────
flow('Contracts | Renewal reminder', 'Contract Management', schedule(),
  [op('reads', list('contracts', 'Contracts'), 'Get items - expiring'),
   op('creates', list('contracts', 'RenewalTasks'), 'Create item - Renewal task'),
   op('creates', list('portal', 'Notifications'), 'Create item - Notification')]);
flow('Contracts | Approve renewal', 'Contract Management',
  trigger('sharepoint', 'createOrUpdate', list('contracts', 'RenewalTasks'), ["Decision == 'Approved'"]),
  [op('updates', list('contracts', 'Contracts'), 'Update item - extend'),
   op('creates', list('contracts', 'ContractHistory'), 'Create item - History')]);
flow('Contracts | Archive expired', 'Contract Management', schedule(),
  [op('reads', list('contracts', 'Contracts'), 'Get items - expired'),
   op('creates', list('archive', 'ArchivedContracts'), 'Create item - Archived contract'),
   op('deletes', list('contracts', 'Contracts'), 'Delete item - expired contract')]);
flow('Contracts | Link to account', 'Contract Management',
  trigger('sharepoint', 'create', list('contracts', 'Contracts')),
  [op('reads', table('account'), 'Get a row by ID - account'),
   op('updates', list('contracts', 'Contracts'), 'Update item - account link')]);
flow('Contracts | Sync signed documents', 'Contract Management',
  trigger('sharepoint', 'create', list('portal', 'Documents')),
  [op('updates', list('contracts', 'Contracts'), 'Update item - document link')]);

app('Contract Desk', 'Contract Management',
  [['contracts', 'Contracts'], ['contracts', 'RenewalTasks']], ['account'], []);

// ── Customer Portal — shared lists, and the two findings ────────────────────
flow('Portal | Publish notification', 'Customer Portal',
  trigger('sharepoint', 'create', list('portal', 'Notifications')),
  [op('updates', list('portal', 'Notifications'), 'Update item - published')]);
flow('Portal | Clean up read notifications', 'Customer Portal', schedule(),
  [op('deletes', list('portal', 'Notifications'), 'Delete item - read')]);
flow('Portal | Index documents', 'Customer Portal',
  trigger('sharepoint', 'createOrUpdate', list('portal', 'Documents')),
  [op('updates', list('portal', 'DocumentIndex'), 'Update item - index entry')]);
// Started from an app that no longer claims it — surfaced as "no caller".
flow('Portal | Rebuild search index', 'Customer Portal',
  { name: 'PowerApps (V2)', kind: 'app', connector: null, label: 'from a canvas app', on: 'call',
    conditions: [], recurrence: null, splitOn: false },
  [op('updates', list('portal', 'DocumentIndex'), 'Update item - rebuild')]);
// The reference no environment variable resolves — surfaced as an unresolved list.
flow('Portal | Feedback follow-up', 'Customer Portal',
  trigger('sharepoint', 'createOrUpdate',
    { site: site('portal'), list: '7e2b0f4a-1c33-4d1e-9a77-2f5c8b6d0a91', listIsGuid: true }),
  [op('creates', list('portal', 'Notifications'), 'Create item - Notification')]);

app('Customer Portal', 'Customer Portal',
  [['portal', 'Notifications'], ['portal', 'Documents']], [], ['Portal | Publish notification']);

// ---------------------------------------------------------------- render

const KNOWN_SITES = [
  ['fieldservice', 'Field Service'], ['purchasing', 'Purchasing'], ['hr', 'Human Resources'],
  ['it', 'IT Services'], ['quality', 'Quality Management'], ['contracts', 'Contracts'],
  ['portal', 'Customer Portal'], ['archive', 'Archive'],
].map(([slug, name]) => ({ name, url: site(slug), lists: [] }));

const raw = buildGraph({
  tenant: 'Contoso AG',
  environment: { name: 'Production', environmentId: '00000000-0000-4000-8000-0000000000ff' },
  flows,
  apps,
  listNames: new Map(),
  tableIds: new Map([
    ['account', { logicalName: 'account', metadataId: '00000000-0000-4000-8000-00000000aaaa' }],
    ['contact', { logicalName: 'contact', metadataId: '00000000-0000-4000-8000-00000000bbbb' }],
  ]),
  knownSites: KNOWN_SITES,
  sources: [
    { name: 'Dataverse', ok: true },
    { name: 'Power Automate', ok: true },
    { name: 'Power Apps', ok: true },
    { name: 'SharePoint list names', ok: true, detail: '8/8 sites read' },
  ],
  warnings: [],
});

const t = translator('en');
const graph = materialize(raw, t);

/** A neutral sample mark — no real organisation. */
const LOGO = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">`
  + `<rect width="48" height="48" rx="10" fill="#ffffff"/>`
  + `<circle cx="17" cy="17" r="6" fill="#0a5c9e"/><circle cx="33" cy="24" r="5" fill="#0a5c9e"/>`
  + `<circle cx="18" cy="33" r="5" fill="#0a5c9e"/>`
  + `<path d="M17 17 33 24 18 33Z" fill="none" stroke="#0a5c9e" stroke-width="2.5" stroke-linejoin="round"/>`
  + `</svg>`).toString('base64')}`;

const brand = { title: 'Contoso AG', color: '#0a5c9e', onColor: '#ffffff', logo: LOGO };

const outDir = path.resolve(process.argv[2] ?? 'examples/sample-report');
fs.mkdirSync(outDir, { recursive: true });

const json = `${JSON.stringify(graph, null, 2)}\n`;
const rendered = renderMarkdown(graph, {
  command: 'node scripts/sample-report.mjs', t, jsonBytes: json.length,
});
const files = {
  'graph.json': json,
  'graph-index.md': `${rendered.index}\n`,
  'graph.md': `${rendered.digest}\n`,
  'graph-flows.md': `${rendered.flows}\n`,
  'graph.html': renderHtml(graph, t, brand),
};
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(outDir, name), content, 'utf8');
}

const counts = {};
for (const node of graph.nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
console.log(`${outDir}`);
console.log(`  ${counts.site} sites · ${counts.list} lists · ${counts.table} tables `
  + `· ${counts.flow} flows · ${counts.app} apps`);
console.log(`  ${graph.edges.length} edges · ${graph.selfTriggers.length} self-triggers `
  + `(${graph.selfTriggers.filter((s) => !s.guarded).length} unguarded) `
  + `· ${graph.sharedSources.length} shared sources`);
