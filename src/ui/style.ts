// Colour and the handful of glyphs the output uses.
//
// picocolors already switches itself off for a pipe, for NO_COLOR and for dumb terminals; the
// wrapper exists so `--no-color` can override that decision after the arguments have been parsed,
// which is later than import time.
import pc from 'picocolors';

/**
 * picocolors turns colour ON unconditionally on Windows, which means escape codes end up in a
 * redirected log file. Requiring a TTY on top of its decision fixes that, while leaving its
 * NO_COLOR / --no-color handling intact and letting FORCE_COLOR override as usual.
 */
function auto(): boolean {
  if (process.env['FORCE_COLOR']) return pc.isColorSupported;
  return pc.isColorSupported && Boolean(process.stdout.isTTY);
}

let colors = pc.createColors(auto());

export function configureColor(enabled: boolean | undefined): void {
  colors = pc.createColors(enabled ?? auto());
}

export const bold = (text: string): string => colors.bold(text);
export const dim = (text: string): string => colors.dim(text);
export const cyan = (text: string): string => colors.cyan(text);
export const green = (text: string): string => colors.green(text);
export const yellow = (text: string): string => colors.yellow(text);
export const red = (text: string): string => colors.red(text);
export const magenta = (text: string): string => colors.magenta(text);

/** Symbols, not words, for the recurring states — they scan far faster in a wall of output. */
export const SYMBOL = {
  ok: '✓',
  step: '·',
  warn: '!',
  fail: '✗',
  arrow: '→',
} as const;

export const ok = (text: string): string => `${green(SYMBOL.ok)} ${text}`;
export const step = (text: string): string => `${dim(SYMBOL.step)} ${dim(text)}`;
export const warn = (text: string): string => `${yellow(SYMBOL.warn)} ${text}`;
export const fail = (text: string): string => `${red(SYMBOL.fail)} ${text}`;

/** Pad a label so a column of them lines up, ignoring the invisible colour codes. */
export function label(text: string, width = 26): string {
  return text.length >= width ? `${text} ` : text + ' '.repeat(width - text.length);
}
