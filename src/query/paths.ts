// Where reports are written and looked for: CONFIGURATION rather than a per-call decision. A
// template, filled in from what the run knows, serves both a workspace with a fixed layout and an
// installation that has no opinion.
import path from 'node:path';
import { dataHome } from '../platform/home.js';

export interface ReportLocations {
  /** Where a build lands when the call names no target. May contain the placeholders below. */
  template: string;
  /** Where reports are searched for. The template's fixed prefix is always among them. */
  roots: string[];
  /** Let an explicit target point outside the roots. Off by default, deliberately. */
  allowAnyOut: boolean;
}

/** The placeholders a template may use. Anything else is left standing. */
export interface TemplateValues {
  label?: string;
  tenant?: string;
  environment?: string;
}

export const PLACEHOLDERS = ['label', 'tenant', 'environment'] as const;

/** `<data home>/reports/<tenant>/<environment>` — beside the token store, moved by `PPGRAPH_HOME`. */
export const defaultTemplate = (): string => path.join(dataHome(), 'reports', '{tenant}', '{environment}');

export function locationsFrom(options: {
  reports?: string;
  roots?: readonly string[];
  allowAnyOut?: boolean;
} = {}): ReportLocations {
  const template = options.reports ?? process.env['PPGRAPH_REPORTS'] ?? defaultTemplate();
  // The template's fixed head is always a root — a server that cannot read back what it wrote
  // would be a trap.
  const roots = [fixedPrefix(template), ...(options.roots ?? [])]
    .map((root) => path.resolve(root))
    .filter((root, index, all) => all.indexOf(root) === index);
  return { template, roots, allowAnyOut: options.allowAnyOut ?? false };
}

/**
 * The part of a template before its first placeholder — the directory that actually exists and can
 * be scanned. `src/{label}/{environment}/graph` → `src`.
 */
export function fixedPrefix(template: string): string {
  const segments = template.split(/[\\/]/);
  const upTo = segments.findIndex((segment) => segment.includes('{'));
  const head = upTo === -1 ? segments.slice(0, -1) : segments.slice(0, upTo);
  return head.length > 0 ? head.join(path.sep) : '.';
}

/**
 * Fill a template. Values are sanitised rather than trusted — they arrive from a command line or a
 * tool call, and `../..` must not become a path. A missing value becomes `unknown`.
 */
export function fillTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{(label|tenant|environment)\}/g, (_, key: keyof TemplateValues) =>
    safeSegment(values[key]));
}

const safeSegment = (value: string | undefined): string => {
  const cleaned = (value ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned === '' ? 'unknown' : cleaned;
};

/**
 * The directory a build writes to: what the call asked for, else the template.
 *
 * @throws when an explicit target leaves the configured roots and `allowAnyOut` is off.
 */
export function resolveOutDir(
  locations: ReportLocations,
  values: TemplateValues,
  explicit?: string,
): string {
  const target = path.resolve(explicit ?? fillTemplate(locations.template, values));
  if (explicit && !locations.allowAnyOut && !withinAny(target, locations.roots)) {
    throw new Error(`"${explicit}" is outside the configured report locations `
      + `(${locations.roots.join(', ')}). Pass a path inside one of them, or start the server with `
      + '--allow-any-out.');
  }
  return target;
}

export function withinAny(target: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), target);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}
