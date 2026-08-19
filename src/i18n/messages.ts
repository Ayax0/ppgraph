import { de } from './de.js';

/**
 * The message contract. Derived from the German catalogue, so adding a language means writing one
 * file and letting the compiler name every key that is still missing.
 */
export type MessageKey = keyof typeof de;
export type Messages = Record<MessageKey, string>;

export type Locale = 'de' | 'en';

export type MessageParams = Record<string, string | number> & { count?: number };

/**
 * A sentence the report will say, kept as key + parameters instead of as finished text.
 *
 * The collectors and the graph builder run BEFORE it is known which language an artefact will be
 * written in — one graph is worded twice, English into the machine-readable files and the maker's
 * language into the viewer — so they record what they MEAN and leave the wording to the renderer.
 * A plain string is a phrase too: text that came from outside (a service error, an operation id,
 * a flow name) has no key and passes through untouched.
 */
export type Phrase = string | { key: MessageKey; params?: MessageParams };

/**
 * A value is a plural pair when it carries BOTH a `|` and `{count}`. The second condition is not
 * decoration: several report strings are Markdown table headers, which are full of pipes and would
 * otherwise be cut in half. Requiring the placeholder that actually drives the choice makes the
 * intent explicit and is checked by i18n.test.mjs.
 */
export function isPlural(template: string): boolean {
  return template.includes('|') && template.includes('{count}');
}

/**
 * Fill `{name}` placeholders, and pick between the two forms of a `singular|plural` value.
 *
 * The plural split uses `Intl.PluralRules`, so it is correct for the two-category languages this
 * catalogue targets. A language with more categories (Polish, Russian, Arabic) needs a richer value
 * shape here — that is the one place it would have to change.
 *
 * ⚠ The browser half carries its own copy of this function (viewer.ts): the viewer is inlined into
 * the report as a classic script and therefore cannot import anything at runtime. `i18n.test.mjs`
 * checks the two implementations against the same cases.
 */
export function format(template: string, params: MessageParams = {}, locale = 'de'): string {
  let text = template;

  if (isPlural(text)) {
    const [one = '', other = ''] = text.split('|');
    const count = params.count;
    text = typeof count === 'number' && new Intl.PluralRules(locale).select(count) === 'one' ? one : other;
  }

  // Trimmed: a template whose last placeholder can be empty ("every 1 {frequency}") would
  // otherwise end in a space, and no report line ever wants one.
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  }).trim();
}
