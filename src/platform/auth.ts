// Sign-in and tokens: no Azure CLI, no PowerShell, no app registration.
//
// Four token audiences (Dataverse, Power Automate, Power Apps, one SharePoint host per site) from
// TWO Microsoft first-party public clients, because the Azure CLI client cannot read SharePoint:
// its token is refused by `_api/web/lists` with `401 invalid_request` and its Graph token carries
// no `Sites.*` scope. Not an audience problem — both clients receive a token for the same bare
// resource id — but a difference in the scopes a tenant has pre-consented per client.
//
// A refresh token is bound to (user, client) rather than to a resource, so one interactive sign-in
// per CLIENT covers all of that client's audiences.
import fs from 'node:fs';
import path from 'node:path';
import { dataHome } from './home.js';
import { dropStoreKey, plaintextAllowed, PLAINTEXT_ENV, seal, storeKey, unseal, type Sealed } from './secret.js';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { openExternal } from '../ui/open.js';

export interface PublicClient {
  id: string;
  label: string;
}

/**
 * Microsoft's own ids, registered in every tenant already — which is what lets this run without
 * admin rights. A tenant CAN refuse a first-party client; `--client-id` and
 * `--sharepoint-client-id` are the way out.
 */
export const CLIENT: { primary: PublicClient; sharePoint: PublicClient } = {
  primary: { id: '04b07795-8ddb-461a-bbee-02f9e1bf7b46', label: 'Microsoft Azure CLI' },
  sharePoint: { id: '9bc3ab49-b65d-410a-85ad-de819febfddc', label: 'SharePoint Online Management Shell' },
};

/**
 * Which client can reach this resource. A function rather than a table because two of the four
 * audiences are per-tenant URLs; the host test must cover `-admin`, `-my` and the sovereign
 * endings, or a run against one of those asks the wrong client and reports a routing bug as a
 * refusal.
 */
export function clientFor(resource: string): PublicClient {
  const host = hostOf(resource);
  return /(^|\.)[a-z0-9-]+\.sharepoint(\.com|\.de|\.cn|\.us|-mil\.us|-df\.com)$/i.test(host)
    ? settings.clients.sharePoint
    : settings.clients.primary;
}

/** `https://service.flow.microsoft.com/` + `/.default` would be `…com//.default` → AADSTS70011. */
export const scopeFor = (resource: string): string => `${resource.replace(/\/+$/, '')}/.default`;
const BASE_SCOPES = 'openid profile offline_access';

function hostOf(resource: string): string {
  try { return new URL(resource).hostname; } catch { return ''; }
}

// ---------------------------------------------------------------- what the CLI tells us

interface Settings {
  clients: { primary: PublicClient; sharePoint: PublicClient };
  account?: string;
  /** `--no-sharepoint-login`: use a cached SharePoint sign-in, never open a browser for one. */
  silentSharePoint: boolean;
  log(message: string): void;
  /** What the reader must act on — above all "a browser window is about to open". Survives `--quiet`. */
  notice(message: string): void;
}

const settings: Settings = {
  clients: { primary: CLIENT.primary, sharePoint: CLIENT.sharePoint },
  silentSharePoint: false,
  log: () => {},
  notice: () => {},
};

/** Options arrive once, from `resolveRun`, so that `getToken`'s call sites stay parameterless. */
export function configureAuth(options: {
  clientId?: string;
  sharePointClientId?: string;
  account?: string;
  silentSharePoint?: boolean;
  log?: (message: string) => void;
  notice?: (message: string) => void;
}): void {
  if (options.clientId) settings.clients.primary = { id: options.clientId, label: 'the given client' };
  if (options.sharePointClientId) {
    settings.clients.sharePoint = { id: options.sharePointClientId, label: 'the given SharePoint client' };
  }
  if (options.account) settings.account = options.account;
  if (options.silentSharePoint !== undefined) settings.silentSharePoint = options.silentSharePoint;
  if (options.log) settings.log = options.log;
  if (options.notice) settings.notice = options.notice;
}

// ---------------------------------------------------------------- the on-disk store

interface StoredAccount {
  tenantId: string;
  /** Every `--tenant` spelling that resolved here — a domain and a GUID must find one entry. */
  aliases: string[];
  clientId: string;
  oid: string;
  upn: string;
  refreshToken: string;
  obtainedAt: string;
}

interface TokenFile {
  version: 1;
  accounts: StoredAccount[];
}

/** What is actually on disk. v1 was the accounts in the clear; v2 seals them with the store key. */
type StoredFile = TokenFile | ({ version: 2 } & Sealed);

const storeDir = dataHome;
const storeFile = (): string => path.join(storeDir(), 'tokens.json');

const isAccounts = (value: unknown): value is TokenFile =>
  (value as TokenFile)?.version === 1 && Array.isArray((value as TokenFile).accounts);

/**
 * A damaged file is treated exactly as a missing one: sign in again and overwrite. Never crash.
 *
 * A v1 file still reads, so upgrading does not sign anyone out — the next write seals it. A v2
 * file whose key has gone (keystore cleared, or the file copied to another machine) is unreadable
 * by design, and that reads as "missing" too: one sign-in, not an error to explain.
 */
function readStore(): TokenFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(storeFile(), 'utf8')) as StoredFile;
    if (isAccounts(parsed)) return parsed;
    if (parsed?.version === 2) {
      const key = storeKey(storeFile());
      const opened = key ? unseal(parsed, key) : null;
      const inner = opened ? (JSON.parse(opened) as TokenFile) : null;
      if (isAccounts(inner)) return inner;
    }
  } catch { /* missing, unreadable, or sealed with a key we no longer hold */ }
  return { version: 1, accounts: [] };
}

/**
 * Read-modify-write immediately before saving, so two runs at once merge instead of clobbering,
 * and tmp+rename so a killed process never leaves half a file behind.
 *
 * **Encrypted, or not written at all.** Where no keystore answers — a Linux host with no desktop
 * session, CI, an unsupported platform — persisting would leave a refresh token in the clear, and
 * a refresh token is portable in a way an access token is not. So the default is to keep nothing
 * and sign in again next run; `PPGRAPH_ALLOW_PLAINTEXT_TOKENS=1` is the informed way back.
 *
 * `mode: 0o600` still applies either way: honoured on POSIX, a no-op on Windows, where the
 * protection is that `%LOCALAPPDATA%` is ACL'd to the user.
 */
function writeStore(change: (file: TokenFile) => void): void {
  try {
    const file = readStore();
    change(file);

    const key = storeKey(storeFile());
    if (!key && !plaintextAllowed()) {
      // Keep nothing rather than something misleading: a stale sealed file would keep failing to open.
      fs.rmSync(storeFile(), { force: true });
      warnUnprotected();
      return;
    }
    const body: StoredFile = key ? { version: 2, ...seal(JSON.stringify(file), key) } : file;

    fs.mkdirSync(storeDir(), { recursive: true });
    const target = storeFile();
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch { /* a token that cannot be saved only costs the next run a sign-in */ }
}

let warnedUnprotected = false;
function warnUnprotected(): void {
  if (warnedUnprotected) return;
  warnedUnprotected = true;
  settings.notice(
    'No OS keystore on this host, so the sign-in was not saved — expect to sign in again next run. '
    + `Set ${PLAINTEXT_ENV}=1 to store it unencrypted instead.`,
  );
}

/** `--logout`. Returns what it removed so the CLI can say something true. */
export function forgetTokens(filter?: { tenantId?: string }): string[] {
  const removed: string[] = [];
  writeStore((file) => {
    file.accounts = file.accounts.filter((account) => {
      const match = !filter?.tenantId
        || account.tenantId === filter.tenantId
        || account.aliases.includes(filter.tenantId.toLowerCase());
      if (match) removed.push(`${account.upn} (${account.tenantId})`);
      return !match;
    });
  });
  // Signing out of everything leaves the key protecting nothing — take it with us, rather than
  // leaving a credential behind in the OS keystore for a file that no longer exists.
  if (readStore().accounts.length === 0) {
    fs.rmSync(storeFile(), { force: true });
    dropStoreKey(storeFile());
  }
  return [...new Set(removed)];
}

/**
 * The tenants this machine already has a sign-in for, on the primary client. Exposed so the CLI
 * can ask when `--tenant` is missing and the store holds more than one — guessing which
 * environment to read is the one guess worth refusing.
 */
export function storedTenants(): Array<{ tenantId: string; upn: string; alias?: string }> {
  return readStore().accounts
    .filter((account) => account.clientId === settings.clients.primary.id)
    .map(({ tenantId, upn, aliases }) => ({ tenantId, upn, ...(aliases[0] ? { alias: aliases[0] } : {}) }));
}

/**
 * "New connection": get past a perfectly good stored refresh token to the browser's account
 * picker. One-shot rather than a mode, so a second sign-in in the same run does not re-prompt.
 */
let ignoreStoreOnce = false;
export const forceInteractive = (): void => { ignoreStoreOnce = true; };

function findAccount(clientId: string, tenantId?: string): StoredAccount | undefined {
  const wanted = tenantId?.toLowerCase();
  const mine = readStore().accounts.filter((a) => a.clientId === clientId
    && (!wanted || a.tenantId.toLowerCase() === wanted || a.aliases.includes(wanted))
    && (!settings.account || a.upn.toLowerCase() === settings.account.toLowerCase()));
  return mine[0];
}

// ---------------------------------------------------------------- in-process caches

interface Token {
  accessToken: string;
  expiresAt: number;
  refreshToken?: string;
  idToken?: string;
}

const access = new Map<string, Token>();
const inflight = new Map<string, Promise<string | null>>();
/**
 * One lock per client, not per resource. Four SharePoint sites are read through `pooled(…, 4, …)`,
 * so without this a cold run opens four browser windows at once for the same sign-in.
 */
const clientLock = new Map<string, Promise<unknown>>();
const tokenErrors = new Map<string, string>();
const clientBlocked = new Map<string, string>();

const EARLY = 5 * 60_000; // refresh this far ahead of expiry — covers clock skew

export function tokenError(resource: string): string {
  return tokenErrors.get(resource) ?? 'no token';
}

/** For tests and for `--logout`'s message; never printed with a token. */
export function signedInAs(): { user?: string; tenantId?: string } {
  return session;
}



let session: { user?: string; tenantId?: string } = {};

// ---------------------------------------------------------------- the chain

/** An access token for one resource. Returns null instead of throwing — collectors degrade. */
export async function getToken(resource: string, tenantId?: string): Promise<string | null> {
  const client = clientFor(resource);
  const key = `${tenantId ?? '*'}|${client.id}|${resource}`;
  const live = access.get(key);
  if (live && live.expiresAt - Date.now() > EARLY) return live.accessToken;

  const running = inflight.get(key);
  if (running) return running;
  const started = acquire(resource, client, tenantId, key).finally(() => inflight.delete(key));
  inflight.set(key, started);
  return started;
}

async function acquire(resource: string, client: PublicClient, tenantId: string | undefined, key: string): Promise<string | null> {
  const blocked = clientBlocked.get(client.id);
  if (blocked) { tokenErrors.set(resource, blocked); return null; }

  return underLock(client.id, async (): Promise<string | null> => {
    const authority = `https://login.microsoftonline.com/${tenantId ?? 'organizations'}`;
    const scope = `${scopeFor(resource)} ${BASE_SCOPES}`;

    // 1 — silent, from a refresh token this client already has
    const skipStore = ignoreStoreOnce && client === settings.clients.primary;
    ignoreStoreOnce = false;
    const account = skipStore ? undefined : findAccount(client.id, tenantId);
    if (account) {
      const refreshed = await redeem(authority, client, {
        grant_type: 'refresh_token', refresh_token: account.refreshToken, scope,
      });
      if (refreshed.ok) {
        keep(key, refreshed.token);
        remember(client, refreshed.token, tenantId, account);
        return refreshed.token.accessToken;
      }
      // ONLY an expired or revoked grant may cost us the refresh token. A network blip, a 429 or a
      // 5xx must leave it alone — throwing away a working refresh token because the WLAN dropped
      // is the worst thing this file could do.
      if (refreshed.invalidGrant) forget(account);
      else { tokenErrors.set(resource, refreshed.error); return null; }
    }

    if (client === settings.clients.sharePoint && settings.silentSharePoint) {
      tokenErrors.set(resource, 'no cached SharePoint sign-in (--no-sharepoint-login)');
      return null;
    }

    // 2 — interactive
    try {
      const token = await signIn(client, authority, scope);
      keep(key, token);
      remember(client, token, tenantId);
      return token.accessToken;
    } catch (error) {
      const message = explain(error, client);
      if (error instanceof AadError && error.clientLevel) clientBlocked.set(client.id, message);
      tokenErrors.set(resource, message);
      return null;
    }
  });
}

function keep(key: string, token: Token): void {
  access.set(key, token);
}

function remember(client: PublicClient, token: Token, tenantId?: string, previous?: StoredAccount): void {
  if (!token.refreshToken) return;
  const claims = claimsOf(token.idToken) ?? {};
  const tid = claims.tid ?? previous?.tenantId ?? tenantId;
  if (!tid) return;
  const upn = upnOf(claims) ?? previous?.upn ?? '';
  const oid = claims.oid ?? previous?.oid ?? '';
  if (client === settings.clients.primary) session = { user: upn || session.user, tenantId: tid };

  writeStore((file) => {
    const alias = tenantId?.toLowerCase();
    const existing = file.accounts.find((a) => a.clientId === client.id && a.tenantId === tid && a.oid === oid);
    const aliases = new Set([...(existing?.aliases ?? []), ...(alias ? [alias] : [])]);
    const entry: StoredAccount = {
      tenantId: tid, aliases: [...aliases], clientId: client.id, oid, upn,
      refreshToken: token.refreshToken as string, obtainedAt: new Date().toISOString(),
    };
    file.accounts = [entry, ...file.accounts.filter((a) => a !== existing)];
  });
}

function forget(account: StoredAccount): void {
  writeStore((file) => {
    file.accounts = file.accounts.filter((a) => !(a.clientId === account.clientId && a.oid === account.oid
      && a.tenantId === account.tenantId));
  });
}

async function underLock<T>(clientId: string, work: () => Promise<T>): Promise<T> {
  const previous = clientLock.get(clientId) ?? Promise.resolve();
  const mine = previous.then(work, work);
  clientLock.set(clientId, mine.catch(() => undefined));
  return mine;
}

// ---------------------------------------------------------------- sign-in

/**
 * The browser first, a device code as insurance: both borrowed clients accept a loopback
 * redirect today, and we do not own those registrations to see when that changes.
 */
async function signIn(client: PublicClient, authority: string, scope: string): Promise<Token> {
  try {
    return await loopback(client, authority, scope);
  } catch (error) {
    if (error instanceof UserDeclined) throw error;
    if (error instanceof AadError && !error.deviceCodeMayHelp) throw error;
    settings.log(`Browser sign-in did not complete (${describe(error)}); falling back to a device code.`);
    return deviceCode(client, authority, scope);
  }
}

async function loopback(client: PublicClient, authority: string, scope: string): Promise<Token> {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('base64url');
  const listener = await listenOnLoopback();
  const redirectUri = `http://localhost:${listener.port}/`;

  const authorize = `${authority}/oauth2/v2.0/authorize?${new URLSearchParams({
    client_id: client.id,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(settings.account ? { login_hint: settings.account } : { prompt: 'select_account' }),
  })}`;

  settings.notice(`Signing in to ${client.label} — a browser window will open.`);
  settings.notice(`If it does not, open this: ${authorize}`);
  openExternal(authorize);

  try {
    const hit = await listener.waitFor(state, 150_000);
    const token = await redeem(authority, client, {
      grant_type: 'authorization_code',
      code: hit,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope,
    });
    if (!token.ok) throw new AadError(token.error, token.code);
    return token.token;
  } finally {
    listener.close();
  }
}

interface Listener {
  port: number;
  waitFor(state: string, ms: number): Promise<string>;
  close(): void;
}

const escapeHtml = (raw: string): string =>
  raw.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));

/**
 * The page the browser lands on after the redirect.
 *
 * Self-contained by necessity: the listener closes seconds after serving it, so a font, stylesheet
 * or image fetched from anywhere would fail exactly when the page is read.
 */
export function redirectPage(state: 'ok' | 'warn' | 'bad', headline: string, detail: string): string {
  const icon = state === 'ok'
    ? '<path d="M20 6 9 17l-5-5"/>'
    : '<path d="M12 7v6.5"/><path d="M12 17h.01"/>';
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ppgraph — ${escapeHtml(headline)}</title>
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb; --plane: #f4f4f1; --ink: #0b0b0b; --ink-2: #52514e; --ink-muted: #898781;
  --hairline: #e1e0d9; --shadow: 0 1px 2px rgba(11,11,11,.06), 0 10px 30px rgba(11,11,11,.08);
  --ok: #0d7c12; --ok-soft: rgba(13,124,18,.12);
  --warn: #a97400; --warn-soft: rgba(250,178,25,.20);
  --bad: #d03b3b; --bad-soft: rgba(208,59,59,.12);
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --surface: #1a1a19; --plane: #0d0d0d; --ink: #ffffff; --ink-2: #c3c2b7; --ink-muted: #898781;
    --hairline: #2c2c2a; --shadow: 0 1px 2px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.45);
    --ok: #1e851f; --ok-soft: rgba(30,133,31,.22);
    --warn: #fab219; --warn-soft: rgba(250,178,25,.16);
    --bad: #f16a6a; --bad-soft: rgba(241,106,106,.16);
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
  background: var(--plane); color: var(--ink); -webkit-font-smoothing: antialiased;
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
}
main {
  width: min(430px, 100%); padding: 36px 32px 22px; text-align: center;
  background: var(--surface); border: 1px solid var(--hairline); border-radius: 14px;
  box-shadow: var(--shadow); animation: rise .3s cubic-bezier(.2, .7, .3, 1) both;
}
.badge {
  width: 48px; height: 48px; margin: 0 auto 20px; display: grid; place-items: center;
  border-radius: 50%; background: var(--tint); color: var(--accent);
}
h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; letter-spacing: -.012em; }
p { margin: 0; color: var(--ink-2); overflow-wrap: anywhere; }
footer {
  margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--hairline);
  font-size: 11.5px; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-muted);
}
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.985); } }
@media (prefers-reduced-motion: reduce) { main { animation: none; } }
</style>
<main style="--accent: var(--${state}); --tint: var(--${state}-soft)">
  <div class="badge">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
  </div>
  <h1>${escapeHtml(headline)}</h1>
  <p>${escapeHtml(detail)}</p>
  <footer>ppgraph</footer>
</main>
`;
}

/**
 * Listen on 127.0.0.1 AND ::1, on the same port: the redirect says `localhost`, which a browser
 * on Windows often resolves to `::1`. A v4-only listener refuses that connection, and the sign-in
 * then fails for no visible reason.
 */
async function listenOnLoopback(): Promise<Listener> {
  let settle: { resolve(code: string): void; reject(error: unknown): void } | null = null;
  let expected = '';
  const arrived = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
  const sockets = new Set<import('node:net').Socket>();

  const handle: http.RequestListener = (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/') { response.writeHead(404).end(); return; }

    // The page follows the OUTCOME: a declined consent and a mismatched state land here too, and
    // a green "Signed in" over either would contradict what the caller is about to report.
    const error = url.searchParams.get('error');
    const description = url.searchParams.get('error_description');
    let fail: unknown = null;
    let page: string;
    if (error === 'access_denied') {
      fail = new UserDeclined();
      page = redirectPage('warn', 'Sign-in cancelled',
        'Nothing was changed. You can close this window.');
    } else if (error) {
      fail = new AadError(description ?? error, codeOf(description));
      page = redirectPage('bad', 'Sign-in failed', description ?? error);
    } else if (url.searchParams.get('state') !== expected) {
      fail = new Error('the redirect carried the wrong state');
      page = redirectPage('bad', 'Sign-in failed',
        'The redirect carried the wrong state, so it was not accepted. You can close this window.');
    } else {
      page = redirectPage('ok', 'Signed in',
        'ppgraph has what it needs. You can close this window.');
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(page);
    if (fail) settle?.reject(fail);
    else settle?.resolve(url.searchParams.get('code') ?? '');
  };

  const bind = (host: string, port: number): Promise<http.Server> => new Promise((resolve, reject) => {
    const server = http.createServer(handle);
    server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });

  const v4 = await bind('127.0.0.1', 0);
  const port = (v4.address() as import('node:net').AddressInfo).port;
  const v6 = await bind('::1', port).catch(() => null);

  return {
    port,
    async waitFor(state, ms) {
      expected = state;
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimedOut()), ms);
      });
      try { return await Promise.race([arrived, deadline]); } finally { clearTimeout(timer); }
    },
    close() {
      // Keep-alive sockets otherwise hold the server open and the process never exits.
      for (const socket of sockets) socket.destroy();
      v4.close();
      v6?.close();
    },
  };
}

async function deviceCode(client: PublicClient, authority: string, scope: string): Promise<Token> {
  const start = await form(`${authority}/oauth2/v2.0/devicecode`, { client_id: client.id, scope });
  if (start.status !== 200) {
    const why = typeof start.json['error_description'] === 'string' ? start.json['error_description'] : 'device code refused';
    throw new AadError(why, codeOf(why));
  }

  settings.notice(`Open ${String(start.json['verification_uri'])} and enter the code ${String(start.json['user_code'])}`);
  openExternal(String(start.json['verification_uri']));

  const interval = Number(start.json['interval'] ?? 5);
  // Capped well below the code's own lifetime: where conditional access forbids the device-code
  // flow, the browser shows the refusal while the token endpoint keeps answering
  // `authorization_pending` (AADSTS70016). A refusal is indistinguishable from an untyped code
  // here, so waiting out the full lifetime buys nothing.
  const until = Date.now() + Math.min(Number(start.json['expires_in'] ?? 900), 300) * 1000;
  let wait = interval * 1000;
  while (Date.now() < until) {
    await sleep(wait);
    const poll = await redeem(authority, client, {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: String(start.json['device_code']),
    });
    if (poll.ok) return poll.token;
    if (poll.raw === 'authorization_pending') continue;
    if (poll.raw === 'slow_down') { wait += 5000; continue; }
    if (poll.raw === 'authorization_declined') throw new UserDeclined();
    throw new AadError(poll.error, poll.code);
  }
  throw new Error('the device code was not confirmed — either it was not entered, or this tenant'
    + ' forbids the device-code flow, which looks the same from here');
}

// ---------------------------------------------------------------- the token endpoint

type Redeemed =
  | { ok: true; token: Token }
  | { ok: false; error: string; code?: string; raw?: string; invalidGrant: boolean };

async function redeem(authority: string, client: PublicClient, body: Record<string, string>): Promise<Redeemed> {
  let response: { status: number; json: Record<string, unknown> };
  try {
    response = await form(`${authority}/oauth2/v2.0/token`, { client_id: client.id, ...body });
  } catch (error) {
    return { ok: false, error: describe(error), invalidGrant: false };
  }
  if (response.status === 200 && typeof response.json['access_token'] === 'string') {
    return {
      ok: true,
      token: {
        accessToken: response.json['access_token'],
        expiresAt: Date.now() + Number(response.json['expires_in'] ?? 3600) * 1000,
        refreshToken: typeof response.json['refresh_token'] === 'string' ? response.json['refresh_token'] : undefined,
        idToken: typeof response.json['id_token'] === 'string' ? response.json['id_token'] : undefined,
      },
    };
  }
  const raw = String(response.json['error'] ?? response.status);
  const description = String(response.json['error_description'] ?? raw);
  return { ok: false, error: description, code: codeOf(description), raw, invalidGrant: raw === 'invalid_grant' };
}

/**
 * The body is parsed on every status, not only on success: `error_description` carries the AADSTS
 * code, which is the only part a tenant admin can act on.
 */
async function form(url: string, fields: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = { error_description: text.slice(0, 300) }; }
  return { status: response.status, json };
}

// ---------------------------------------------------------------- identity

interface Claims {
  tid?: string;
  oid?: string;
  preferred_username?: string;
  upn?: string;
  email?: string;
}

/**
 * The id_token arrived from the token endpoint over TLS and is not being used as an assertion — we
 * are the client, not a relying party — so the payload is read without verifying the signature.
 */
export function claimsOf(idToken?: string): Claims | null {
  const payload = idToken?.split('.')[1];
  if (!payload) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims; } catch { return null; }
}

const upnOf = (claims: Claims): string | undefined => claims.preferred_username ?? claims.upn ?? claims.email;

/**
 * Establish who we are before anything is read — tenant id and account, out of the first
 * sign-in's id_token. Silent when a refresh token exists, so the "a browser window will open"
 * notice only prints when one actually will.
 */
export async function ensureLogin(options: { tenantId?: string; account?: string; log(message: string): void }):
Promise<{ user?: string; tenantId?: string }> {
  configureAuth({ account: options.account, log: options.log });
  const token = await getToken(RESOURCE_FLOW, options.tenantId);
  if (!token) throw new Error(`Sign-in failed: ${tokenError(RESOURCE_FLOW)}`);
  return { user: session.user, tenantId: session.tenantId ?? options.tenantId };
}

/** Kept here rather than imported, so this module does not depend on the HTTP one. */
const RESOURCE_FLOW = 'https://service.flow.microsoft.com/';

// ---------------------------------------------------------------- errors

class AadError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'AadError';
    this.code = code;
  }

  /** A device code cannot help when the objection is to the client itself. */
  get clientLevel(): boolean {
    return ['AADSTS7000218', 'AADSTS700016', 'AADSTS7000112', 'AADSTS65001', 'AADSTS650052'].includes(this.code ?? '');
  }

  get deviceCodeMayHelp(): boolean {
    return !this.clientLevel;
  }
}

class UserDeclined extends Error {
  constructor() { super('Sign-in was declined.'); this.name = 'UserDeclined'; }
}

class TimedOut extends Error {
  constructor() { super('no response from the browser'); this.name = 'TimedOut'; }
}

const codeOf = (text?: string | null): string | undefined => text?.match(/AADSTS\d+/)?.[0];

function explain(error: unknown, client: PublicClient): string {
  if (error instanceof AadError && error.clientLevel) {
    const flag = client === settings.clients.sharePoint ? '--sharepoint-client-id' : '--client-id';
    return `this tenant does not permit sign-in for ${client.label} (${client.id}, ${error.code})`
      + ` — pass ${flag} <guid> with an application registered in it`;
  }
  return describe(error);
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });
