// The query layer: find a report, load it, ask it something.
export {
  defaultTemplate, fillTemplate, fixedPrefix, locationsFrom, resolveOutDir, withinAny, PLACEHOLDERS,
} from './paths.js';
export type { ReportLocations, TemplateValues } from './paths.js';
export { findReportDirs, forgetLoaded, listReports, loadReport, posix, resolveReport } from './load.js';
export type { LoadedReport, ReportListing } from './load.js';
export {
  describeNode, findNodes, findings, fit, impact, overview, resolveNode, FINDING_KINDS, MAX_BYTES,
} from './queries.js';
export type {
  FindOptions, FindingKind, FindingsOptions, ImpactOptions, NodeOptions, SolutionCount, Truncation,
} from './queries.js';
