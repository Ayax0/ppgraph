/**
 * The locale registry. Adding a language is two lines here plus one catalogue file — and the
 * compiler names every key that file is still missing.
 */
import { de } from './de.js';
import { en } from './en.js';
import { format, isPlural } from './messages.js';
import type { Locale, MessageKey, MessageParams, Messages, Phrase } from './messages.js';

const CATALOGUES: Record<Locale, Messages> = { de, en };

export const LOCALES = Object.keys(CATALOGUES) as Locale[];

/** The report language when nothing selects one. An i18n fact, so it lives with the catalogues. */
export const DEFAULT_LOCALE: Locale = 'de';

/**
 * A language named in its own language — "Deutsch", not "German". Derived rather than tabled, so a
 * new catalogue needs no second list to stay in step. Capitalised for a picker; several languages
 * (français, italiano) write their own name in lower case.
 */
export function localeName(locale: Locale): string {
  const native = new Intl.DisplayNames([locale], { type: 'language' }).of(locale) ?? locale;
  return native.charAt(0).toUpperCase() + native.slice(1);
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as string[]).includes(value);
}

export function messagesFor(locale: Locale): Messages {
  return CATALOGUES[locale];
}

/**
 * A bound translator. Everything that produces report text takes one of these rather than reaching
 * for a global, so a single process could render two locales without them interfering.
 */
export interface Translator {
  readonly locale: Locale;
  readonly messages: Messages;
  (key: MessageKey, params?: MessageParams): string;
}

export function translator(locale: Locale): Translator {
  const messages = messagesFor(locale);
  // An unknown key yields the key. The compiler rules that out inside the package, but a phrase
  // can also arrive from a caller or from an older graph.json, and a visible `trgSomething` in one
  // line of a report is a far better failure than a TypeError that takes the whole run with it.
  const translate = ((key: MessageKey, params?: MessageParams): string =>
    (messages[key] === undefined ? String(key) : format(messages[key], params, locale))) as Translator;
  return Object.assign(translate, { locale, messages });
}

/**
 * Note what a line MEANS, without deciding its language yet.
 *
 * Everything upstream of the renderers — the collectors, the flow parser, the graph builder —
 * records phrases with this instead of translating on the spot. That is what lets one collected
 * environment become an English `graph.json` and a German `graph.html` in the same run.
 */
export function msg(key: MessageKey, params?: MessageParams): Phrase {
  return params ? { key, params } : { key };
}

/** Word a phrase in one language. The inverse of `msg`, applied once per artefact. */
export function say(phrase: Phrase, t: Translator): string {
  return typeof phrase === 'string' ? phrase : t(phrase.key, phrase.params);
}

export { format, isPlural };
export type { Locale, MessageKey, MessageParams, Messages, Phrase };
