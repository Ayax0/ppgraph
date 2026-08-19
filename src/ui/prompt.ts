// The interactive layer, in English like the rest of the CLI. Everything here is optional by
// design: with no terminal, or with every answer already supplied as an option, none of it runs.
import { checkbox, input, search, select } from '@inquirer/prompts';
import { dim } from './style.js';
import { LOCALES, localeName } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { CollectorKey, DiscoveredEnvironment } from '../types.js';

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Inquirer's own streams argument. Left open so a prompt can be rendered somewhere other than the
 * process's terminal — which is the only way to exercise one without a real one.
 */
export type PromptContext = Parameters<typeof select>[1];

/** Ctrl-C inside a prompt is a deliberate stop, not a crash — it must not print a stack trace. */
export function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === 'ExitPromptError' || error.name === 'AbortPromptError');
}

export interface Choice<T> {
  name: string;
  value: T;
  description?: string;
}

/**
 * Pick one of a list — with a search box once the list is long enough to scroll past.
 *
 * Below the threshold a search field is friction — a few entries are read at a glance. Above it,
 * scrolling is. The cut is where a page of choices stops fitting on screen; both prompts take the
 * same choices, so nothing about the list is written twice.
 */
export const SEARCHABLE_FROM = 8;

/** The search itself, split out so it can be tested without driving a terminal. */
export function filterChoices<T>(choices: Array<Choice<T>>, term: string): Array<Choice<T>> {
  if (!term) return choices;
  const needle = term.toLowerCase();
  return choices.filter((choice) => `${choice.name} ${choice.description ?? ''}`.toLowerCase().includes(needle));
}

async function pickOne<T>(message: string, choices: Array<Choice<T>>, always: Array<Choice<T>> = []): Promise<T> {
  if (choices.length + always.length < SEARCHABLE_FROM) {
    return select({ message, pageSize: 12, choices: [...choices, ...always] });
  }

  return search({
    message,
    pageSize: 12,
    // `always` survives every filter: a term that matches nothing must still leave a way forward.
    source: (term) => [...filterChoices(choices, term ?? ''), ...always],
  });
}

export async function pickEnvironment(environments: DiscoveredEnvironment[]): Promise<DiscoveredEnvironment> {
  return pickOne('Which environment?', environments.map((entry) => ({
    name: entry.name,
    value: entry,
    description: dim([
      entry.environmentId,
      entry.sku,
      entry.isDefault ? 'default environment' : null,
      entry.dataverseUrl ? 'with Dataverse' : 'no Dataverse',
    ].filter(Boolean).join('  ·  ')),
  })));
}

/** Which of the tenants this machine is already signed in to. Only asked when several exist. */
/**
 * Which sign-in to use — one of the ones this machine already holds, or a new one.
 *
 * Asked whenever there is anything to choose between, not only when there are several: with one
 * stored connection the question is still worth its keystroke, because "sign in as somebody else"
 * has no other door. Picking NEW skips the stored refresh token and opens the browser on the
 * account picker.
 */
export async function pickConnection(
  tenants: Array<{ tenantId: string; upn: string; alias?: string }>,
): Promise<string | 'new'> {
  return pickOne<string | 'new'>(
    'Which connection?',
    tenants.map((entry) => ({
      name: entry.upn || entry.alias || entry.tenantId,
      value: entry.tenantId,
      description: dim([entry.alias, entry.tenantId].filter(Boolean).join('  ·  ')),
    })),
    // Last and unfilterable: "sign in as somebody new" is the answer precisely when the search
    // found nothing, so it must not be what the search removes.
    [{ name: 'New connection …', value: 'new' as const, description: dim('sign in in the browser') }],
  );
}

/**
 * Where the report is written. The suggestion is pre-filled and Enter accepts it, so the common
 * case costs one keystroke — but a report usually belongs next to the project it describes rather
 * than wherever the shell happens to stand, which is worth one question.
 */
export async function askOutDir(suggestion: string): Promise<string> {
  const answer = await input({
    message: 'Write the report to',
    default: suggestion,
    validate: (value) => (value.trim() === '' ? 'A directory is required.' : true),
  });
  return answer.trim();
}

/**
 * The language of the VIEWER — `graph.html`, the file a person opens. The CLI and the machine-readable
 * files stay English whatever is picked here. Each language is offered in its own
 * language, which is the one label a reader recognises without already speaking the other; the
 * option value is shown alongside because it is exactly what the recorded rebuild command carries.
 */
export async function askLocale(current: Locale, context?: PromptContext): Promise<Locale> {
  return select({
    message: 'Language of the report',
    default: current,
    choices: LOCALES.map((locale) => ({
      name: localeName(locale),
      value: locale,
      description: dim(`--locale ${locale}`),
    })),
  }, context);
}

interface ScopeChoice {
  key: CollectorKey;
  name: string;
  description: string;
}

/**
 * What to collect, as a checkbox rather than a set of presets: the answer maps one to one onto
 * `--skip`, so whatever is cleared here is exactly what the recorded rebuild command will carry.
 * Flows are not offered — without them there is no graph.
 */
const SCOPE: ScopeChoice[] = [
  { key: 'powerapps', name: 'Power Apps', description: 'canvas apps and the data sources they bind' },
  { key: 'powerautomate', name: 'Power Automate', description: 'cloud flows the Power Automate API knows and Dataverse does not' },
  { key: 'solutions', name: 'Solutions', description: 'solution membership — the frames in the diagram' },
  { key: 'variables', name: 'Environment variables', description: 'resolves @parameters(…) to real site and list values' },
  { key: 'sharepoint', name: 'SharePoint', description: 'list GUID → list name; the slowest step by far' },
];

export async function askScope(): Promise<Set<CollectorKey>> {
  const chosen = await checkbox({
    message: 'What should be collected?',
    choices: SCOPE.map((entry) => ({
      name: entry.name,
      value: entry.key,
      checked: true,
      description: dim(entry.description),
    })),
  });
  return new Set(SCOPE.map((entry) => entry.key).filter((key) => !chosen.includes(key)));
}
