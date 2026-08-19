// The parts of sign-in that can be tested without signing in.
//
// The rest — the browser round trip, the token endpoint — is proven against a real tenant, not
// here. What IS here is everything that decides whether a real sign-in is even attempted correctly:
// which client is asked, what scope is sent, and whether a refresh token survives a bad day.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ppgraph-auth-'));
process.env['PPGRAPH_HOME'] = home;

const { CLIENT, clientFor, scopeFor, claimsOf, forgetTokens, configureAuth } = await import('../dist/platform/auth.js');

const store = () => path.join(home, 'tokens.json');
const write = (content) => fs.writeFileSync(store(), content);

test('SharePoint hosts go to the SharePoint client, everything else to the primary one', () => {
  for (const host of [
    'https://contoso.sharepoint.com',
    'https://contoso-admin.sharepoint.com',
    'https://contoso-my.sharepoint.com',
    'https://contoso.sharepoint.de',
    'https://contoso.sharepoint.cn',
  ]) {
    assert.equal(clientFor(host).id, CLIENT.sharePoint.id, host);
  }
  for (const resource of [
    'https://service.flow.microsoft.com/',
    'https://service.powerapps.com/',
    'https://orgc0ffee01.crm4.dynamics.com',
    'https://graph.microsoft.com/',
  ]) {
    assert.equal(clientFor(resource).id, CLIENT.primary.id, resource);
  }
});

test('a resource that is not a URL does not silently become a SharePoint one', () => {
  assert.equal(clientFor('not a url').id, CLIENT.primary.id);
  assert.equal(clientFor('').id, CLIENT.primary.id);
  // The obvious near-miss: a host that merely CONTAINS the word must not match.
  assert.equal(clientFor('https://sharepoint.example.com').id, CLIENT.primary.id);
});

test('the scope never carries a double slash', () => {
  // Both RESOURCE constants end in a slash, which is exactly how AADSTS70011 gets produced.
  assert.equal(scopeFor('https://service.flow.microsoft.com/'), 'https://service.flow.microsoft.com/.default');
  assert.equal(scopeFor('https://service.flow.microsoft.com'), 'https://service.flow.microsoft.com/.default');
  assert.equal(scopeFor('https://org.crm17.dynamics.com///'), 'https://org.crm17.dynamics.com/.default');
});

test('claims are read out of an id_token without verifying it', () => {
  const payload = Buffer.from(JSON.stringify({
    tid: '11111111-2222-3333-4444-555555555555', oid: 'o1', preferred_username: 'maker@contoso.example',
  })).toString('base64url');
  const claims = claimsOf(`header.${payload}.signature`);
  assert.equal(claims.tid, '11111111-2222-3333-4444-555555555555');
  assert.equal(claims.preferred_username, 'maker@contoso.example');

  assert.equal(claimsOf(undefined), null);
  assert.equal(claimsOf('nonsense'), null);
  assert.equal(claimsOf('a.@@@.c'), null, 'a payload that is not base64 JSON returns null, never throws');
});

test('a damaged store is treated as an empty one, never as a crash', () => {
  write('{ this is not json');
  assert.deepEqual(forgetTokens(), [], 'reading it yields nothing');

  write(JSON.stringify({ version: 99, accounts: [{ upn: 'x' }] }));
  assert.deepEqual(forgetTokens(), [], 'a version we do not know is not trusted either');
});

test('--logout removes everything, or only one tenant', () => {
  const accounts = [
    { tenantId: 'T1', aliases: ['contoso.onmicrosoft.com'], clientId: CLIENT.primary.id, oid: 'o1', upn: 'a@contoso', refreshToken: 'r1', obtainedAt: 'x' },
    { tenantId: 'T2', aliases: [], clientId: CLIENT.primary.id, oid: 'o2', upn: 'b@fabrikam', refreshToken: 'r2', obtainedAt: 'x' },
  ];
  write(JSON.stringify({ version: 1, accounts }));
  assert.deepEqual(forgetTokens({ tenantId: 'T2' }), ['b@fabrikam (T2)']);
  assert.equal(JSON.parse(fs.readFileSync(store(), 'utf8')).accounts.length, 1, 'the other tenant stays');

  write(JSON.stringify({ version: 1, accounts }));
  // A tenant given as a domain must find the entry keyed by its GUID.
  assert.deepEqual(forgetTokens({ tenantId: 'contoso.onmicrosoft.com' }), ['a@contoso (T1)']);

  write(JSON.stringify({ version: 1, accounts }));
  assert.equal(forgetTokens().length, 2, 'no filter clears the lot');
  assert.equal(JSON.parse(fs.readFileSync(store(), 'utf8')).accounts.length, 0);
});

test('the store is written with owner-only permissions where the platform has them', { skip: process.platform === 'win32' }, () => {
  write(JSON.stringify({ version: 1, accounts: [] }));
  forgetTokens();
  assert.equal(fs.statSync(store()).mode & 0o777, 0o600);
});

test('an unknown client id can be substituted, and routing follows it', () => {
  configureAuth({ sharePointClientId: '11111111-2222-3333-4444-555555555555' });
  assert.equal(clientFor('https://contoso.sharepoint.com').id, '11111111-2222-3333-4444-555555555555');
  configureAuth({ sharePointClientId: CLIENT.sharePoint.id });
});

test('the store hands the picker a friendlier name than a GUID', async () => {
  const { storedTenants } = await import('../dist/platform/auth.js');
  write(JSON.stringify({
    version: 1,
    accounts: [
      { tenantId: 'T1', aliases: ['contoso.onmicrosoft.com'], clientId: CLIENT.primary.id, oid: 'o1', upn: 'a@contoso', refreshToken: 'r', obtainedAt: 'x' },
      // A SharePoint sign-in is not a connection to choose from — it follows whichever tenant wins.
      { tenantId: 'T1', aliases: [], clientId: CLIENT.sharePoint.id, oid: 'o1', upn: 'a@contoso', refreshToken: 'r', obtainedAt: 'x' },
    ],
  }));
  const known = storedTenants();
  assert.equal(known.length, 1, 'only the primary client is a connection');
  assert.deepEqual(known[0], { tenantId: 'T1', upn: 'a@contoso', alias: 'contoso.onmicrosoft.com' });
});

test('"new connection" is offered next to the known ones', async () => {
  const { pickConnection } = await import('../dist/ui/prompt.js');
  assert.equal(typeof pickConnection, 'function');
});

// The redirect page is the only thing this package renders outside the terminal, and it renders at
// the worst possible moment: the listener is about to close and the machine may reach nothing but
// the tenant. So the two things that would break it silently are checked here.
test('the redirect page carries everything it needs and nothing it cannot reach', async () => {
  const { redirectPage } = await import('../dist/platform/auth.js');
  const page = redirectPage('ok', 'Signed in', 'You can close this tab.');
  assert.equal(page.match(/(src|href)=/g), null, 'no asset is fetched from anywhere');
  assert.equal(page.match(/https?:/g), null, 'and no absolute URL survives in the markup');
  assert.match(page, /prefers-color-scheme: dark/, 'a dark browser gets its own palette');
  assert.match(page, /--accent: var\(--ok\)/, 'the state picks the accent');
});

test('the redirect page escapes what the identity provider sent', async () => {
  const { redirectPage } = await import('../dist/platform/auth.js');
  // error_description arrives from outside and lands in the page verbatim otherwise.
  const page = redirectPage('bad', 'Sign-in failed', '<script>alert(1)</script> & "quoted"');
  assert.ok(!page.includes('<script>'), 'no markup from the query string reaches the document');
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /&amp; &quot;quoted&quot;/);
});
