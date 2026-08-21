// The Dataverse trigger's `subscriptionRequest/message` numbering.
//
// This is the one mapping where a swap is silently expensive: `graph_impact` answers "what happens
// if I write here", and a flow that fires on every update reported as a delete trigger reads as
// "nothing happens". These cases pin the numbering down so it cannot drift back.
//
// The numbering is NOT create/update/delete. Measured against a live environment (42 cloud flows,
// 2026-08-21): every flow with message 3, 4 or 6 carries `filteringattributes` and no flow with
// message 1 does — the connector only evaluates that list for updates. A message-3 flow ran five
// times in a day, each run reading and updating its triggering row, while the audit log for that
// table recorded zero deletions. So 1 = Create, 3 = Update, and 2 = Delete by elimination.
import test from 'node:test';
import assert from 'node:assert/strict';

const { parseFlow } = await import('../dist/platform/parse.js');
const { buildGraph } = await import('../dist/graph/build.js');

const dataverseFlow = (message, filteringattributes) => ({
  properties: {
    definition: {
      triggers: {
        'When_a_row_is_added,_modified_or_deleted': {
          type: 'OpenApiConnectionWebhook',
          inputs: {
            host: {
              apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps',
              operationId: 'SubscribeWebhookTrigger',
              connectionName: 'shared_commondataserviceforapps',
            },
            parameters: {
              'subscriptionRequest/message': message,
              'subscriptionRequest/entityname': 'ioz_bedurfnisanmeldung',
              'subscriptionRequest/scope': 2,
              ...(filteringattributes ? { 'subscriptionRequest/filteringattributes': filteringattributes } : {}),
            },
          },
        },
      },
      actions: {},
    },
  },
});

const triggerOf = (message, filteringattributes) =>
  parseFlow(dataverseFlow(message, filteringattributes)).trigger;

test('message 1 is Create, not something else', () => {
  const trigger = triggerOf(1);
  assert.equal(trigger.kind, 'dataverse');
  assert.equal(trigger.on, 'create');
  assert.equal(trigger.table, 'ioz_bedurfnisanmeldung');
});

test('message 2 is Delete', () => {
  assert.equal(triggerOf(2).on, 'delete');
});

test('message 3 is Update — the pair that used to be swapped', () => {
  // The regression this file exists for. A flow with a column filter fires on updates; reporting
  // it as a delete trigger makes graph_impact answer "nothing happens" for a live cascade.
  assert.equal(triggerOf(3, 'ioz_workflow1').on, 'update');
});

test('the combinations 4, 5, 6 and 7 are classified, not dropped as unknown', () => {
  assert.equal(triggerOf(4, 'statuscode').on, 'createOrUpdate');
  assert.equal(triggerOf(5).on, 'createOrDelete');
  assert.equal(triggerOf(6, 'statuscode').on, 'updateOrDelete');
  assert.equal(triggerOf(7).on, 'anyChange');
});

test('an unrecognised message value stays unknown', () => {
  assert.equal(triggerOf(99).on, 'unknown');
});

// ---------------------------------------------------------------- what it means for a cascade

const flowNode = (name, trigger) => ({
  key: name,
  name,
  workflowId: `wf-${name}`,
  flowId: null,
  state: 'enabled',
  managed: false,
  solution: { uniqueName: 'Ops', name: 'Ops' },
  source: 'Dataverse',
  trigger,
  operations: [],
  childFlows: [],
  connectors: ['commondataserviceforapps'],
  connectionReferences: [],
  parsed: true,
});

const graphWith = (...flows) =>
  buildGraph({
    tenant: 'contoso',
    environment: { environmentId: 'env', name: 'Dev', dataverseUrl: 'https://contoso.crm.dynamics.com' },
    flows,
    apps: [],
    listNames: new Map(),
    tableIds: new Map(),
    knownSites: [],
    sources: [],
    warnings: [],
  });

const refiredBy = (graph, flowName) => {
  const edge = graph.edges.find((e) => e.kind === 'triggers' && e.to === `flow:wf-${flowName}`);
  return edge ? [...(edge.refiredBy ?? [])].sort() : null;
};

test('an update trigger is re-fired by updates — and a delete trigger is not', () => {
  const graph = graphWith(
    flowNode('onUpdate', triggerOf(3, 'ioz_workflow1')),
    flowNode('onDelete', triggerOf(2)),
  );
  assert.deepEqual(refiredBy(graph, 'onUpdate'), ['updates']);
  assert.deepEqual(refiredBy(graph, 'onDelete'), ['deletes']);
});

test('a combination trigger carries every verb it listens for', () => {
  const graph = graphWith(
    flowNode('onCreateOrUpdate', triggerOf(4, 'statuscode')),
    flowNode('onUpdateOrDelete', triggerOf(6, 'statuscode')),
  );
  assert.deepEqual(refiredBy(graph, 'onCreateOrUpdate'), ['creates', 'updates']);
  assert.deepEqual(refiredBy(graph, 'onUpdateOrDelete'), ['deletes', 'updates']);
});

test('an unrecognised message keeps every verb rather than ending the cascade', () => {
  // Under-reporting a loop is the dangerous error; over-reporting is only noise.
  const graph = graphWith(flowNode('onSomethingNew', triggerOf(99)));
  assert.deepEqual(refiredBy(graph, 'onSomethingNew'), ['creates', 'deletes', 'updates']);
});
