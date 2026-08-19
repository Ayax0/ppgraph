/**
 * Works out what one run should do, from three layers in a fixed order:
 *
 *   1. explicit flags  — always win
 *   2. discovery       — the Flow API knows every environment and its Dataverse URL
 *   3. a question      — asked only when the answer is still open and there is a terminal
 *
 * The tool reads NO configuration file of its own. Whoever knows more than the API does — a
 * workspace, a pipeline, an agent holding a tenant.yaml — passes it in as flags, and the generated
 * files carry the full command back so the next run reproduces this one exactly.
 */
import path from 'node:path';
import { CLIENT, configureAuth, ensureLogin, forceInteractive, storedTenants } from '../platform/auth.js';
import { listEnvironments, resolveDiscovered } from '../platform/environments.js';
import { askLocale, askOutDir, askScope, isInteractive, pickConnection, pickEnvironment } from '../ui/prompt.js';
import { DEFAULT_LOCALE } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { CollectorKey, KnownSite, RunConfig } from '../types.js';

/** Kept for one release under its old name; the id itself now lives in `auth.ts` with its twin. */
export const WELL_KNOWN_PNP_CLIENT_ID = CLIENT.sharePoint.id;

export interface ResolveOptions {
  tenant?: string;
  environment?: string;
  dataverseUrl?: string;
  account?: string;
  sharePointClientId?: string;
  noSharePointLogin?: boolean;
  label?: string;
  out?: string;
  locale?: Locale;
  siteNames?: KnownSite[];
  skip?: Set<CollectorKey>;
  askWhatToCollect?: boolean;
  log(message: string): void;
}

export async function resolveRun(options: ResolveOptions): Promise<RunConfig> {
  // The sign-in layer takes its options once, here, rather than through `getToken` — whose four
  // call sites stay untouched by the whole migration off the Azure CLI. `--sharepoint-client-id` feeds it
  // too: a tenant that refuses Microsoft's SharePoint client can hand us its own application, and
  // that is the same answer for PnP and for our own requests.
  configureAuth({
    account: options.account,
    log: options.log,
    ...(options.sharePointClientId ? { sharePointClientId: options.sharePointClientId } : {}),
    ...(options.noSharePointLogin ? { silentSharePoint: true } : {}),
  });

  // Which connection, before anything is read.
  //
  // The Azure CLI has one "active" context and silently uses it; this store holds several side by
  // side, so an omitted --tenant is a question rather than a coin flip. With a terminal the reader
  // picks — including "new connection", which walks past the stored token to the browser. Without
  // one, several stored tenants is an error that names them, never a silent pick.
  let tenantId = options.tenant;
  if (!tenantId) {
    const known = storedTenants();
    if (known.length > 0 && isInteractive()) {
      const picked = await pickConnection(known);
      if (picked === 'new') forceInteractive();
      else tenantId = picked;
    } else if (known.length > 1) {
      throw new Error('Several tenants are signed in here; pass --tenant with one of: '
        + `${known.map((entry) => `${entry.tenantId} (${entry.upn})`).join(', ')}.`);
    }
  }

  const session = await ensureLogin({ tenantId, account: options.account, log: options.log });

  const discovered = await listEnvironments(tenantId);
  if (discovered.length === 0) throw new Error('This account cannot see any Power Platform environment.');

  const chosen = options.environment
    ? resolveDiscovered(discovered, options.environment)
    : discovered.length === 1 || !isInteractive()
      ? discovered[0]
      : await pickEnvironment(discovered);
  if (!chosen) {
    throw new Error(`No environment matches "${options.environment}". Available: `
      + `${discovered.map((entry) => entry.name).join(', ')}.`);
  }

  // Flags win over what the API reported.
  const dataverseUrl = options.dataverseUrl?.replace(/\/+$/, '') ?? chosen.dataverseUrl;
  const label = options.label ?? domainOf(session.user) ?? session.tenantId ?? 'unknown';

  const skip = options.skip
    ?? (options.askWhatToCollect && isInteractive() ? await askScope() : new Set<CollectorKey>());

  // What the report is, before where it goes: the language decides who can read the diagram, the
  // path only decides where it lands. Without a terminal the default stands — and it is recorded in
  // the rebuild command either way, so a report never has to be guessed at later.
  const locale = options.locale
    ?? (isInteractive() ? await askLocale(DEFAULT_LOCALE) : DEFAULT_LOCALE);

  // Last, so the answer the reader confirms to start the run is the one they will go looking in.
  const suggestion = path.join('ppgraph', slug(chosen.name || chosen.environmentId));
  const outDir = options.out
    ? path.resolve(options.out)
    : path.resolve(isInteractive() ? await askOutDir(suggestion) : suggestion);

  // The well-known SharePoint application needs no registration, so a plain run gets it rather
  // than silently dropping to list IDs.
  const sharePointClientId = options.sharePointClientId ?? CLIENT.sharePoint.id;

  return {
    label,
    tenantId: tenantId ?? session.tenantId,
    signedInAs: session.user,
    account: options.account,
    environmentId: chosen.environmentId,
    environmentName: chosen.name,
    dataverseUrl,
    sharePoint: { clientId: sharePointClientId, tenant: tenantId ?? session.tenantId },
    knownSites: options.siteNames ?? [],
    outDir,
    locale,
    skip,
  };
}

function domainOf(upn: string | undefined): string | undefined {
  const at = upn?.indexOf('@') ?? -1;
  return at > 0 ? upn?.slice(at + 1) : undefined;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'environment';
}
