/**
 * Branding for the HTML report: a logo, a title, and one accent colour.
 *
 * ⚠ **The accent never touches a mark.** The four product colours are the technology key — blue is
 * Power Automate, purple Power Apps, teal SharePoint, green Dataverse — and a customer's brand
 * colour landing on a node or an edge would make the legend a lie. So it is confined to chrome that
 * carries no meaning: the header band and the focus ring. That is also why an unbranded report looks
 * exactly as before rather than "the same with a different palette".
 */

export interface Branding {
  /** Shown large in the band; the generic title drops to the subtitle beneath it. */
  title?: string;
  /** Already a `data:` URI — the page has to stay openable with no network. */
  logo?: string;
  /** `#rrggbb`. */
  color?: string;
  /** Black or white, whichever is legible on `color`. Computed, never guessed. */
  onColor?: string;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#abc` / `abc123` / `#ABC123` → `#abc123`. Throws on anything else, so a typo is not silent. */
export function parseColor(raw: string): string {
  const match = HEX.exec(raw.trim());
  if (!match) throw new Error(`--brand-color expects a hex colour like #0a5c9e, received "${raw}".`);
  const digits = match[1]!.toLowerCase();
  return `#${digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits}`;
}

const channel = (value: number): number =>
  (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(hex.slice(at, at + 2), 16) / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

const contrast = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Perceived lightness. Unlike WCAG luminance this tracks how light a colour LOOKS. */
function perceivedLightness(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => channel(parseInt(hex.slice(at, at + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r! + 0.5363325363 * g! + 0.0514459929 * b!);
  const m = Math.cbrt(0.2119034982 * r! + 0.6806995451 * g! + 0.1073969566 * b!);
  const s = Math.cbrt(0.0883024619 * r! + 0.2817188376 * g! + 0.6299787005 * b!);
  return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
}

/** The two inks the band can wear. Near-black rather than pure black, which reads harsh on colour. */
const LIGHT_INK = '#ffffff';
const DARK_INK = '#111111';

/** Above this the colour READS light and wants dark text. Measured, see readableOn. */
const LIGHT_ENOUGH = 0.72;
/** WCAG's floor for large text, which the band title is. */
const LARGE_TEXT = 3;

/**
 * The text colour for the band: perceived lightness decides, contrast has the veto.
 *
 * Maximising the contrast ratio alone gets saturated mid-tones wrong. A saturated orange #ea6212 carries
 * dark text at 5.6:1 and white at 3.4:1, so "highest ratio" says dark — but the colour reads as a
 * dark surface and every brand in the world puts white on it. Measured across ten brand colours,
 * ratio-maximising disagreed with the obvious answer exactly on the saturated mid-tones
 * (#ea6212, #00a0a8); perceived lightness got all ten right.
 *
 * Lightness alone is not enough either: a neutral #999999 has almost the same lightness as that
 * orange but carries white at only 2.85:1, which is genuinely unreadable. So the lightness rule
 * only stands when the ink it picks clears the large-text floor; otherwise the other one wins.
 */
export function readableOn(color: string): string {
  const wanted = perceivedLightness(color) < LIGHT_ENOUGH ? LIGHT_INK : DARK_INK;
  const other = wanted === LIGHT_INK ? DARK_INK : LIGHT_INK;
  const ratio = contrast(luminance(color), luminance(wanted));
  return ratio >= LARGE_TEXT || ratio >= contrast(luminance(color), luminance(other))
    ? wanted
    : other;
}

/** How legible the band ended up, so the caller can say so rather than ship something unreadable. */
export function bandContrast(color: string): number {
  return contrast(luminance(color), luminance(readableOn(color)));
}

const MIME: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

export function mimeFor(nameOrType: string): string | null {
  if (nameOrType.startsWith('image/')) return nameOrType.split(';')[0]!;
  const extension = nameOrType.split('.').pop()?.toLowerCase() ?? '';
  return MIME[extension] ?? null;
}

/** Big logos are the reason a report stops being emailable, so there is a ceiling. */
export const LOGO_LIMIT = 1024 * 1024;

export function dataUri(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}
