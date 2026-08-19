// Finding and loading reports. A report is a DIRECTORY holding `graph.json`; everything beside it
// renders the same data. Loading is cached on (path, mtime, size), so a rebuild invalidates it.
import fs from 'node:fs';
import path from 'node:path';
import { withinAny } from './paths.js';
import type { ReportLocations } from './paths.js';
import type { Graph } from '../types.js';

export interface LoadedReport {
  /** The directory, absolute. */
  dir: string;
  graph: Graph;
  /** Whole days since the report was generated — the one number that says "trust this or not". */
  ageDays: number;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  graph: Graph;
}

const cache = new Map<string, CacheEntry>();

/** How deep under a root a report may sit. `src/<tenant>/<environment>/graph` is four. */
const MAX_DEPTH = 5;

/** Every directory under the roots that holds a `graph.json`, sorted so answers are stable. */
export function findReportDirs(roots: readonly string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((entry) => entry.isFile() && entry.name === 'graph.json')) {
      // No return: a root may be a report itself and still have siblings below it.
      if (!seen.has(dir)) { seen.add(dir); found.push(dir); }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };

  for (const root of roots) walk(path.resolve(root), 0);
  return found.sort();
}

export function loadReport(dir: string): LoadedReport {
  const resolved = path.resolve(dir);
  const file = path.join(resolved, 'graph.json');
  const stat = fs.statSync(file);
  const cached = cache.get(resolved);
  const graph = cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size
    ? cached.graph
    : JSON.parse(fs.readFileSync(file, 'utf8')) as Graph;
  cache.set(resolved, { mtimeMs: stat.mtimeMs, size: stat.size, graph });
  return { dir: resolved, graph, ageDays: ageInDays(graph.generatedAt) };
}

function ageInDays(generatedAt: string): number {
  const then = Date.parse(generatedAt);
  if (Number.isNaN(then)) return -1;
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
}

/** What `graph_reports` answers: one line per report, cheap enough to list them all. */
export interface ReportListing {
  dir: string;
  tenant: string;
  environment: string;
  environmentId: string;
  generatedAt: string;
  ageDays: number;
  scope: string[] | null;
  counts: { lists: number; tables: number; flows: number; apps: number };
}

export function listReports(locations: ReportLocations): ReportListing[] {
  const listings: ReportListing[] = [];
  for (const dir of findReportDirs(locations.roots)) {
    try {
      const { graph, ageDays } = loadReport(dir);
      listings.push({
        dir: posix(dir),
        tenant: graph.tenant,
        environment: graph.environment.name ?? graph.environment.environmentId,
        environmentId: graph.environment.environmentId,
        generatedAt: graph.generatedAt,
        ageDays,
        scope: graph.scope ?? null,
        counts: {
          lists: graph.nodes.filter((node) => node.type === 'list').length,
          tables: graph.nodes.filter((node) => node.type === 'table').length,
          flows: graph.nodes.filter((node) => node.type === 'flow').length,
          apps: graph.nodes.filter((node) => node.type === 'app').length,
        },
      });
    } catch { /* an unreadable report is one the list simply does not offer */ }
  }
  return listings;
}

/**
 * Which report a call means. A hint is a path or a piece of one; reading is allowed anywhere the
 * process can reach, since the roots govern where the tool WRITES.
 *
 * With no hint and more than one report this refuses rather than guesses — answering out of the
 * wrong environment is the one failure nobody would catch.
 */
export function resolveReport(locations: ReportLocations, hint?: string): LoadedReport {
  if (hint) {
    const direct = asDirectory(hint);
    if (direct) return loadReport(direct);
  }

  const dirs = findReportDirs(locations.roots);
  const found = hint
    ? dirs.filter((dir) => matchesHint(dir, hint))
    : dirs;

  // `…/graph` occurs inside `…/graph-sales` too, so prefer a candidate whose path ends on the
  // hint at a segment boundary; the substring set only stands when that leaves nothing.
  const exact = hint ? found.filter((dir) => endsOnSegment(dir, hint)) : [];
  const matches = exact.length > 0 ? exact : found;

  if (matches.length === 1) return loadReport(matches[0]!);
  if (matches.length === 0) {
    throw new Error(hint
      ? `No report matches "${hint}". Available: ${describe(dirs)}`
      : `No report found under ${locations.roots.map(posix).join(', ')}. Build one with graph_build.`);
  }
  throw new Error(hint
    ? `"${hint}" matches ${matches.length} reports — pass one of: ${describe(matches)}`
    : `Several reports are available — pass "report" with one of: ${describe(matches)}`);
}

const describe = (dirs: string[]): string => (dirs.length === 0 ? 'none' : dirs.map(posix).join(', '));

/** Forward slashes everywhere they are READ: a Windows path doubles every separator in JSON. */
export const posix = (target: string): string => target.replace(/\\/g, '/');

/** `…/acme/env/graph` ends on `env/graph` and on `graph`, but not on `raph` or on `graph-sales`. */
function endsOnSegment(dir: string, hint: string): boolean {
  const path_ = posix(dir).toLowerCase().replace(/\/+$/, '');
  const needle = posix(hint).toLowerCase().replace(/^\/+|\/+$/g, '');
  return path_ === needle || path_.endsWith(`/${needle}`);
}

function matchesHint(dir: string, hint: string): boolean {
  const needle = hint.toLowerCase().replace(/\\/g, '/');
  if (dir.toLowerCase().replace(/\\/g, '/').includes(needle)) return true;
  try {
    const { graph } = loadReport(dir);
    return [graph.tenant, graph.environment.name ?? '', graph.environment.environmentId]
      .some((value) => value.toLowerCase().includes(needle));
  } catch { return false; }
}

/** A hint that is itself a report directory, or the `graph.json` inside one. */
function asDirectory(hint: string): string | null {
  const candidate = path.resolve(hint);
  try {
    const stat = fs.statSync(candidate);
    if (stat.isFile() && path.basename(candidate) === 'graph.json') return path.dirname(candidate);
    if (stat.isDirectory() && fs.existsSync(path.join(candidate, 'graph.json'))) return candidate;
  } catch { /* not a path at all — treat it as a piece of one */ }
  return null;
}

/** For tests; a rebuild invalidates itself through the mtime check. */
export function forgetLoaded(dir?: string): void {
  if (dir) cache.delete(path.resolve(dir));
  else cache.clear();
}

export { withinAny };
