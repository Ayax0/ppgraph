/**
 * Library entry point. The CLI is one consumer of this; anything else that wants the graph as data
 * (a report, a check in CI, another tool) can import from here instead of shelling out.
 */
export { buildGraph, nodeMap } from './graph/build.js';
export { materialize, stateLabel } from './graph/materialize.js';
export { collectEnvironment, resolveSharePointLists } from './platform/collect.js';
export { listEnvironments, resolveDiscovered } from './platform/environments.js';
export { resolveRun, WELL_KNOWN_PNP_CLIENT_ID } from './config/resolve.js';
export { parseFlow, parseAppReferences, prettyCondition, connectorLabel, normalizeSite } from './platform/parse.js';
export { apiGet, apiGetAll, ApiError, RESOURCE } from './platform/http.js';
export { ensureLogin, getToken, tokenError, forgetTokens, configureAuth, CLIENT } from './platform/auth.js';
export { buildReport, displayPath } from './report.js';
export type { BuiltReport, ReportHooks, ReportOptions, ReportSummary } from './report.js';
// The query layer: the same answers the MCP server gives, without a protocol in between.
export {
  describeNode, findNodes, findings, findReportDirs, fillTemplate, fit, fixedPrefix, forgetLoaded,
  impact, listReports, loadReport, locationsFrom, overview, posix, resolveNode, resolveOutDir,
  resolveReport, withinAny, FINDING_KINDS, MAX_BYTES, PLACEHOLDERS,
} from './query/index.js';
export type {
  FindOptions, FindingKind, FindingsOptions, ImpactOptions, LoadedReport, NodeOptions,
  ReportListing, ReportLocations, SolutionCount, TemplateValues, Truncation,
} from './query/index.js';
export { runMcp, parseMcpArgs } from './mcp/server.js';
export { TOOLS, INSTRUCTIONS } from './mcp/tools.js';
export type { Tool, ToolContext } from './mcp/tools.js';
export { renderMarkdown, formatDate, stamp } from './render/markdown.js';
export { renderHtml } from './render/html.js';
export { runCli, reportFatal } from './cli.js';
// The report language. Collecting and building are language-free — they note phrases with `msg`,
// and `materialize` words the graph once per artefact — so an embedder can render one collection
// in two locales without collecting twice.
export {
  translator, messagesFor, isLocale, localeName, format, isPlural, msg, say, LOCALES, DEFAULT_LOCALE,
} from './i18n/index.js';

export type * from './types.js';
export type { MarkdownOutput } from './render/markdown.js';
export type { Locale, MessageKey, MessageParams, Messages, Phrase, Translator } from './i18n/index.js';
