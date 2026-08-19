#!/usr/bin/env node
// ppgraph — builds the dependency graph of one Power Platform environment.
//
// Language: three surfaces, one rule — whoever reads it decides.
//   • the terminal — English, written literally in this file
//   • the machine-readable files (graph.json, the three .md) — ALWAYS English, an agent reads them
//   • graph.html — the maker's language, `--locale`
// Collectors and builder record phrases rather than text, so `materialize` words one graph twice.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEnvironments } from './platform/environments.js';
import { resolveRun } from './config/resolve.js';
import { configureAuth, forgetTokens } from './platform/auth.js';
import { buildReport, displayPath } from './report.js';
import { COLLECTOR_KEYS } from './types.js';
import { DEFAULT_LOCALE, LOCALES, isLocale } from './i18n/index.js';
import { parseColor } from './render/brand.js';
import * as style from './ui/style.js';
import { isCancellation } from './ui/prompt.js';
import { openExternal } from './ui/open.js';
import type { ReportSummary } from './report.js';
import type { Locale } from './i18n/index.js';
import type { CollectorKey, KnownSite } from './types.js';

/** One writer for everything the run says, so quiet mode and colour have a single seam. */
const out = (line = ''): void => { process.stdout.write(`${line}\n`); };

const USAGE = `
ppgraph — map what triggers what in a Power Platform environment.

  ppgraph                                     resolve everything interactively
  ppgraph --environment "Production"          no questions asked
  ppgraph --tenant contoso.onmicrosoft.com --environment <guid> --out ./reports/contoso

ppgraph reads no configuration file. Values are given as options, discovered from the service,
or asked for. Every generated file records the command that produced it.

SCOPE
  --environment <name|guid>   environment to read; asked for when omitted     (alias --env)
  --tenant <domain|guid>      Entra tenant to sign in to
  --solution <a,b>            report only these solutions; repeatable. Keeps what each solution's
                              frame shows — its flows and apps plus everything they reach, shared
                              lists included, the other solutions' flows not
  --skip <a,b,c>              leave collectors out; repeatable. Named after the product each one
                              reads:
                                powerapps      canvas apps and the data sources they bind
                                powerautomate  cloud flows only the Power Automate API knows
                                dataverse      everything read from Dataverse — this also drops
                                               solutions, variables and the flows Dataverse holds
                                solutions      solution membership; the frames in the diagram
                                variables      environment variable values
                                sharepoint     list GUID → list name; the slowest step by far
  --no-sharepoint             shorthand for --skip sharepoint

ACCESS
  --dataverse-url <url>       Dataverse organisation URL; discovered when omitted
  --account <upn>             account to suggest at the sign-in prompt
  --sharepoint-client-id <id> application to sign in with for SharePoint list names
                              (defaults to the SharePoint Online Management Shell)
  --no-sharepoint-login       never open a browser for SharePoint; lists may keep their IDs
  --refresh-names             discard the cached SharePoint list names

OUTPUT
  --out <path>                target directory, relative or absolute; asked for when omitted
                              (suggestion: ./ppgraph/<environment>)
  ${`--locale <${LOCALES.join('|')}>`.padEnd(28)}language of graph.html; the .md/.json files are always English
                              (default: ${DEFAULT_LOCALE})
  --label <text>              name the report gives this tenant
  --site-name <url>=<name>    friendly name for one site; repeatable
  --open                      open the HTML report when finished
  --logout                    forget the stored sign-in; --tenant narrows it to one
  --quiet                     print results and errors only
  --no-color                  disable colour

BRANDING                      all optional; without them the report looks as it always has
  --brand-title <text>        shown large in the report's header band
  --brand-logo <path|url>     image for that band; inlined, so the file stays self-contained
  --brand-color <#rrggbb>     the band's colour, and what focus rings pick up. Deliberately NOT
                              applied to nodes or edges — those four colours are the technology key

OTHER
  --list-environments         list the environments this account can see, then exit
  --help

AS AN MCP SERVER            ppgraph mcp [--reports <template>] [--root <path>] [--allow-any-out]
  Speaks MCP over stdin/stdout so an agent can query a report instead of reading it. --reports is
  where a build lands, with the placeholders {label} {tenant} {environment}; without it, reports go
  under the user's data directory. --root adds further places to look. See the README.
`;

interface Options {
  tenant?: string;
  environment?: string;
  dataverseUrl?: string;
  account?: string;
  sharePointClientId?: string;
  noSharePointLogin?: boolean;
  label?: string;
  out?: string;
  locale?: Locale;
  solutions?: string[];
  brandTitle?: string;
  brandLogo?: string;
  brandColor?: string;
  siteNames?: KnownSite[];
  skip?: Set<CollectorKey>;
  refreshNames?: boolean;
  listEnvironments?: boolean;
  open?: boolean;
  logout?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  help?: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {};
  const value = (index: number): string => {
    const next = argv[index];
    if (next === undefined) throw new Error(`Missing value for ${argv[index - 1]}.`);
    return next;
  };
  const addSkip = (...keys: CollectorKey[]): void => {
    options.skip = new Set([...(options.skip ?? []), ...keys]);
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--tenant': options.tenant = value(++i); break;
      case '--env':
      case '--environment': options.environment = value(++i); break;
      case '--dataverse-url': options.dataverseUrl = value(++i); break;
      case '--account': options.account = value(++i); break;
      // The old names keep working, undocumented: every generated report carries its own rebuild
      // command verbatim, and those must stay runnable.
      case '--sharepoint-client-id':
      case '--pnp-client-id': options.sharePointClientId = value(++i); break;
      case '--no-sharepoint-login':
      case '--no-pnp': options.noSharePointLogin = true; break;
      case '--label': options.label = value(++i); break;
      case '--out': options.out = value(++i); break;
      case '--solution':
        options.solutions = [...(options.solutions ?? []), ...parseList(value(++i))];
        break;
      case '--locale': options.locale = parseLocale(value(++i)); break;
      case '--brand-title': options.brandTitle = value(++i); break;
      case '--brand-logo': options.brandLogo = value(++i); break;
      case '--brand-color': options.brandColor = parseColor(value(++i)); break;
      case '--site-name': options.siteNames = [...(options.siteNames ?? []), parseSiteName(value(++i))]; break;
      case '--skip': addSkip(...parseSkip(value(++i))); break;
      case '--no-sharepoint': addSkip('sharepoint'); break;
      case '--refresh-names': options.refreshNames = true; break;
      case '--list-environments': options.listEnvironments = true; break;
      case '--open': options.open = true; break;
      case '--logout': options.logout = true; break;
      case '--quiet': options.quiet = true; break;
      case '--no-color': options.noColor = true; break;
      case '--help':
      case '-h': options.help = true; break;
      default:
        if (argv[i]?.startsWith('-')) throw new Error(`Unknown option ${argv[i]}. Run --help for the full list.`);
    }
  }
  return options;
}

function parseSkip(raw: string): CollectorKey[] {
  const wanted = raw.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const unknown = wanted.filter((entry) => !COLLECTOR_KEYS.includes(entry as CollectorKey));
  if (unknown.length > 0) {
    throw new Error(`--skip does not know "${unknown.join('", "')}". Valid values: ${COLLECTOR_KEYS.join(', ')}.`);
  }
  return wanted as CollectorKey[];
}

/** Comma-separated or repeated, both accepted — a solution name may itself contain a space. */
function parseList(raw: string): string[] {
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function parseLocale(raw: string): Locale {
  const wanted = raw.trim().toLowerCase();
  if (!isLocale(wanted)) {
    throw new Error(`--locale does not know "${raw}". Valid values: ${LOCALES.join(', ')}.`);
  }
  return wanted;
}

function parseSiteName(raw: string): KnownSite {
  const at = raw.indexOf('=');
  if (at < 1) throw new Error(`--site-name expects <url>=<name>, received "${raw}".`);
  return { url: raw.slice(0, at).trim().replace(/\/+$/, ''), name: raw.slice(at + 1).trim(), lists: [] };
}

export async function runCli(argv: readonly string[]): Promise<void> {
  // Before anything is parsed or printed: as an MCP server, stdout belongs to the protocol alone.
  if (argv[0] === 'mcp') {
    const { runMcp } = await import('./mcp/server.js');
    await runMcp(argv.slice(1));
    return;
  }

  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  style.configureColor(args.noColor ? false : undefined);
  const log = args.quiet ? (): void => {} : (message: string): void => { out(`  ${style.step(message)}`); };

  // Before anything else, and before any sign-in: forgetting is the one thing that must work
  // even when the stored token is the reason the run fails.
  if (args.logout) {
    const removed = forgetTokens(args.tenant ? { tenantId: args.tenant } : undefined);
    out();
    out(removed.length === 0
      ? `  ${style.dim('Nothing to sign out of.')}`
      : removed.map((entry) => `  ${style.ok(style.label('Signed out', 14) + style.dim(entry))}`).join(String.fromCharCode(10)));
    out();
    return;
  }

  if (args.listEnvironments) {
    for (const entry of await listEnvironments(args.tenant)) {
      out();
      out(`  ${style.bold(entry.name)}${entry.isDefault ? style.dim('   default environment') : ''}`);
      out(`  ${style.dim(entry.environmentId)}`);
      out(`  ${style.dim(entry.dataverseUrl ?? 'no Dataverse')}`);
    }
    out();
    return;
  }

  // 1 — resolve: options first, then discovery, then questions
  // How the data was obtained is not progress chatter, so it survives --quiet. Set before
  // resolveRun, which adds the rest; configureAuth merges rather than replaces.
  configureAuth({ notice: (message: string) => { out(`  ${style.warn(message)}`); } });

  const run = await resolveRun({ ...args, askWhatToCollect: !args.skip && !args.environment, log });

  out();
  out(`  ${style.bold(style.cyan(run.label))} ${style.dim('·')} ${style.bold(run.environmentName ?? run.environmentId)}`);
  out(`  ${style.dim(run.environmentId)}`);
  out(`  ${style.dim(run.dataverseUrl ?? 'no Dataverse')}`);
  out();
  if (run.signedInAs) out(`  ${style.ok(style.label('Signed in') + style.dim(run.signedInAs))}`);

  // 2 — collect, build and write; the CLI only supplies the voice
  const { summary } = await buildReport(run, args, {
    step: log,
    result: (ok, label, detail) => {
      const line = style.label(label) + style.dim(detail);
      out(`  ${ok ? style.ok(line) : style.warn(line)}`);
    },
    warn: (message) => { out(`  ${style.warn(message)}`); },
  });

  report(summary);
  if (args.open) openExternal(path.join(summary.outDir, 'graph.html'));
}

const DESCRIPTIONS: Record<string, string> = {
  'graph-index.md': 'start here — what is in this environment, and where the rest is',
  'graph.md': 'digest — trigger map, cascades, self-triggers',
  'graph-flows.md': 'one section per flow',
  'graph.html': 'interactive report',
  'graph.json': 'the complete graph as data',
};

/** The closing screen. Everything it needs was counted once, in `buildReport`. */
function report(summary: ReportSummary): void {
  const plural = (value: number, one: string): string => `${value} ${value === 1 ? one : `${one}s`}`;

  out();
  out(`  ${style.bold([
    plural(summary.counts.list, 'list'),
    summary.counts.table ? plural(summary.counts.table, 'Dataverse table') : '',
    plural(summary.counts.flow, 'flow'),
    plural(summary.counts.app, 'app'),
  ].filter(Boolean).join(' · '))}`);

  out(`  ${style.dim(`${plural(summary.triggerEdges, 'trigger connection')} · ${plural(summary.selfTriggers, 'self-trigger')}`)}`);
  if (summary.unguarded > 0) {
    out(`  ${style.warn(`${summary.unguarded} of them have no trigger condition and will repeat indefinitely`)}`);
  }

  const failed = summary.sources.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    out();
    for (const source of failed) out(`  ${style.fail(style.label(source.name) + style.dim(source.detail ?? ''))}`);
  }

  out();
  out(`  ${style.dim(style.SYMBOL.arrow)} ${style.cyan(displayPath(summary.outDir))}`);
  for (const name of summary.files) out(`    ${style.bold(style.label(name, 16))}${style.dim(DESCRIPTIONS[name] ?? '')}`);
  out();
}

/**
 * One place that turns a thrown error into something a reader can act on; used by both entry points.
 *
 * Everything goes to stderr, including the cancellation line: as an MCP server, one stray line on
 * stdout desyncs the host, and this is the last path that could produce one.
 */
export function reportFatal(error: unknown): number {
  if (isCancellation(error)) {
    process.stderr.write(`\n  ${style.dim('Cancelled.')}\n`);
    return 130;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n  ${style.fail(style.bold('Failed'))}  ${message}\n\n`);
  return 1;
}

// Run when invoked as a binary, stay quiet when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli(process.argv.slice(2)).catch((error: unknown) => process.exit(reportFatal(error)));
}

