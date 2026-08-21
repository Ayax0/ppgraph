// The human-facing half: one self-contained HTML file — no CDN, no build step at read time, just
// open it. The viewer script, its stylesheet and the message catalogue are all inlined, which is
// what lets the page be localised without loading anything at runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatDate } from './markdown.js';
import type { Branding } from './brand.js';
import type { Translator } from '../i18n/index.js';
import type { Graph } from '../types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/**
 * dist/render/html.js → dist/viewer/… ; the assets are copied there by `pnpm build:assets`, and
 * in the published package that first candidate is the only one ever taken.
 *
 * Under `pnpm dev` this module is still the source file, so the first candidate becomes
 * src/viewer/ — which holds the stylesheet (edit it, re-run, see it) but never viewer.js, the
 * compiled browser half. That one is picked up from dist/ as a second try.
 */
const viewerDirs = [path.join(here, '..', 'viewer'), path.join(here, '..', '..', 'dist', 'viewer')];

function readAsset(file: string): string {
  const full = viewerDirs.map((dir) => path.join(dir, file)).find((candidate) => fs.existsSync(candidate));
  if (full === undefined) {
    const primary = path.join(viewerDirs[0], file);
    throw new Error(`Viewer asset ${file} is missing (${primary}). Has "pnpm build" been run?`);
  }
  return fs.readFileSync(full, 'utf8');
}

/** Viewfinder corners — "frame what is there". Inline so it needs no font and no second file. */
/** Drawn, not typed. A glyph like the old theme ◐ carries the text font weight and sits on the
 *  text baseline, so it never lines up with a stroked icon beside it. All three share a 16-grid,
 *  a 1.7 stroke and currentColor, which is what makes them look like one set. */
const SEARCH_ICON = '<span class="field-icon"><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">'
  + '<circle cx="7" cy="7" r="4.4" fill="none" stroke="currentColor" stroke-width="1.7"/>'
  + '<path d="M10.6 10.6 14 14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
  + '</svg></span>';

const THEME_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">'
  + '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.7"/>'
  + '<path d="M8 2.4a5.6 5.6 0 0 1 0 11.2z" fill="currentColor"/></svg>';

const FIT_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">'
  + '<path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" fill="none" stroke="currentColor"'
  + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** JSON that is safe to sit inside a <script> element. */
const embed = (value: unknown): string => JSON.stringify(value).replace(/<\//g, '<\\/');

export function renderHtml(graph: Graph, t: Translator, brand: Branding = {}): string {
  const environment = graph.environment.name ?? graph.environment.environmentId;
  const generic = `${t('uiTitle')} — ${graph.tenant} / ${environment}`;
  // The tab, and what a saved file is called: the customer's name first when there is one.
  const title = brand.title ? `${brand.title} — ${t('uiTitle')}` : generic;

  return `<!doctype html>
<html lang="${t.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
${brand.logo ? `<link rel="icon" href="${escape(brand.logo)}">` : ''}
<style>
${readAsset('viewer.css')}
${brandStyle(brand)}
</style>
</head>
<body data-view="graph">
<header${brand.title || brand.logo ? ' class="branded"' : ''}>
  ${identity(graph, environment, t, brand)}
  <div class="controls">
    <span class="field">${SEARCH_ICON}<input type="search" id="search" placeholder="${escape(t('uiSearch'))}" aria-label="${escape(t('uiSearchLabel'))}"></span>
    <span class="field select-field"><select id="solution" aria-label="${escape(t('uiSolutionFilter'))}"><option value="">${escape(t('uiAllSolutions'))}</option></select></span>
    <details id="filters">
      <summary>${escape(t('uiFilters'))}<span class="count" id="filter-count" hidden></span></summary>
      <div class="filter-menu">
        <span class="group-title">${escape(t('uiNodes'))}</span>
        ${nodeFilter('list', t('uiFilterLists'), 'var(--sharepoint)')}
        ${nodeFilter('site', t('uiFilterSites'), 'var(--sharepoint)', 'outline')}
        ${nodeFilter('table', t('uiFilterTables'), 'var(--dataverse)')}
        ${nodeFilter('flow', t('uiFilterFlows'), 'var(--flow)')}
        ${nodeFilter('app', t('uiFilterApps'), 'var(--app)')}
        <span class="group-title">${escape(t('uiEdges'))}</span>
        ${edgeFilter('triggers', t('uiEdgeTriggers'), 'trigger')}
        ${edgeFilter('writes', t('uiEdgeWrites'), 'write')}
        ${edgeFilter('reads', t('uiEdgeReads'), 'read')}
        ${edgeFilter('app', t('uiEdgeApp'), 'link')}
        ${edgeFilter('contains', t('uiEdgeContains'), 'contains', false)}
        ${edgeFilter('mirrors', t('uiEdgeMirror'), 'mirror')}
      </div>
    </details>
    <button id="unfocus" type="button">${escape(t('uiBackToOverview'))}</button>
    <button id="view-toggle" type="button">${escape(t('uiTable'))}</button>
    <button id="fit" class="icon" type="button" title="${escape(t('uiFit'))}" aria-label="${escape(t('uiFit'))}">${FIT_ICON}</button>
    <button id="theme-toggle" class="icon" type="button" title="${escape(t('uiTheme'))}" aria-label="${escape(t('uiTheme'))}">${THEME_ICON}</button>
  </div>
</header>

<main>
  <div id="canvas">
    <svg id="scene" role="img" aria-label="${escape(title)}">
      <defs>
        ${arrow('arrow-muted', 'var(--ink-muted)')}
        ${arrow('arrow-flow', 'var(--flow)')}
        ${arrow('arrow-app', 'var(--app)')}
      </defs>
      <g id="scene-root"></g>
    </svg>
    <svg id="minimap" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g id="minimap-shapes"></g>
      <rect id="minimap-view" vector-effect="non-scaling-stroke"></rect>
    </svg>
  </div>
  <aside id="side">
    <div id="panel"></div>
    ${legendKey(t)}
  </aside>
  <div id="table-view">
    <table>
      <thead><tr>
        <th>${escape(t('uiColSolution'))}</th><th>${escape(t('uiColFrom'))}</th>
        <th>${escape(t('uiColRelation'))}</th><th>${escape(t('uiColTo'))}</th>
        <th>${escape(t('uiColDetail'))}</th>
      </tr></thead>
      <tbody></tbody>
    </table>
  </div>
</main>

<script id="graph-data" type="application/json">${embed(graph)}</script>
<script id="graph-i18n" type="application/json">${embed({ locale: t.locale, messages: t.messages })}</script>
<script>
${readAsset('viewer.js')}
</script>
</body>
</html>
`;
}

/**
 * The key, as documentation rather than as a control.
 *
 * It lives at the foot of the side panel and never moves: filtering is a thing you do, but "what
 * does blue mean" is a thing you read, and it has to still be answerable when a node is selected and
 * the panel above has swapped to that node's details. Eleven toggles in the toolbar could not carry
 * both jobs — they wrapped into five lines the moment the window was less than very wide.
 */
function legendKey(t: Translator): string {
  const node = (label: string, color: string, shape: 'solid' | 'outline' = 'solid'): string =>
    `<li><span class="swatch" style="background:${shape === 'outline' ? 'transparent' : color};`
    + `border-color:${color}"></span>${escape(label)}</li>`;
  const edge = (label: string, sample: string): string =>
    `<li><span class="line line-${sample}"></span>${escape(label)}</li>`;

  return `<div class="legend-key">
    <h3>${escape(t('uiLegend'))}</h3>
    <ul>
      ${node(t('uiFilterLists'), 'var(--sharepoint)')}
      ${node(t('uiFilterSites'), 'var(--sharepoint)', 'outline')}
      ${node(t('uiFilterTables'), 'var(--dataverse)')}
      ${node(t('uiFilterFlows'), 'var(--flow)')}
      ${node(t('uiFilterApps'), 'var(--app)')}
    </ul>
    <ul>
      ${edge(t('uiEdgeTriggers'), 'trigger')}
      ${edge(t('uiEdgeWrites'), 'write')}
      ${edge(t('uiEdgeReads'), 'read')}
      ${edge(t('uiEdgeApp'), 'link')}
      ${edge(t('uiEdgeMirror'), 'mirror')}
    </ul>
  </div>`;
}

/**
 * The node toggles inside the filter menu. `outline` mirrors the diagram's site node, which is drawn
 * as an unfilled border because it is the container its lists sit in rather than another item
 * beside them.
 */
function nodeFilter(type: string, label: string, color: string, shape: 'solid' | 'outline' = 'solid'): string {
  const fill = shape === 'outline' ? 'transparent' : color;
  return `<label class="toggle" data-filter="${type}"><input type="checkbox" checked>`
    + `<span class="swatch" style="background:${fill};border-color:${color}"></span>${escape(label)}</label>`;
}

/**
 * Edge toggles double as the legend — the line sample is the same stroke the diagram draws.
 * The site-to-list edge starts off: the data lane is already blocked and captioned by site, so
 * those edges only add a bundle of parallel lines that says what the caption already says.
 */
function edgeFilter(group: string, label: string, sample: string, checked = true): string {
  return `<label class="toggle" data-edge="${group}"><input type="checkbox"${checked ? ' checked' : ''}>`
    + `<span class="line line-${sample}"></span>${escape(label)}</label>`;
}

// markerUnits="userSpaceOnUse" keeps the arrowhead one size — the default scales it with the
// stroke width, which made the 2px trigger edges carry oversized heads.
function arrow(id: string, color: string): string {
  return `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="9" markerHeight="9"`
    + ' markerUnits="userSpaceOnUse" orient="auto-start-reverse">'
    + `<path d="M0 0.5 L8 4 L0 7.5 Z" fill="${color}"></path></marker>`;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escape(value: string | undefined): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * The brand band. Rendered only when there is something to put in it, so an unbranded report is
 * byte-for-byte what it was before.
 *
 * The controls stay BELOW it on the normal surface. Putting a search box and eleven toggles on top
 * of a coloured band is where this kind of header usually falls apart — the band carries identity,
 * the row below carries the machinery.
 */
function identity(graph: Graph, environment: string, t: Translator, brand: Branding): string {
  const meta = [graph.tenant, environment]
    .concat(graph.scope?.length ? [t('uiScopeSolution', { solutions: graph.scope.join(', ') })] : [])
    .concat([formatDate(graph.generatedAt, t.locale)]);

  // Unbranded there is nothing to put on a line of its own: title and meta on one line, the controls
  // beside them. A whole row for four words and then a row of buttons with a hand's width of nothing
  // between them is the emptiest a header can be.
  if (!brand.title && !brand.logo) {
    return `<h1>${escape(t('uiTitle'))}<small>${escape(meta.join(' · '))}</small></h1>`;
  }

  // Branded, the header IS the band — so the controls sit on the brand colour rather than on a
  // second row below it, and the whole thing costs the height the logo needs anyway.
  return `<div class="brand">
    ${brand.logo ? `<img class="brand-logo" src="${escape(brand.logo)}" alt="">` : ''}
    <div class="brand-text">
      ${brand.title ? `<strong>${escape(brand.title)}</strong>` : ''}
      <span>${escape([t('uiTitle'), ...meta].join(' · '))}</span>
    </div>
  </div>`;
}

/**
 * Two custom properties, set on top of the stylesheet's own. Nothing else is overridden — the four
 * product colours are the technology key and stay exactly where they are.
 */
function brandStyle(brand: Branding): string {
  if (!brand.color) return '';
  return `:root, :root[data-theme="dark"] {\n`
    + `  --brand: ${brand.color};\n`
    + `  --on-brand: ${brand.onColor ?? '#ffffff'};\n`
    + '}';
}
