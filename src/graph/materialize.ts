import { say } from '../i18n/index.js';
import type { MessageKey, Phrase, Translator } from '../i18n/index.js';
import type {
  CascadeStep, CascadeWrite, FlowState, Graph, GraphEdge, GraphNode, RawGraph, SourceStatus,
} from '../types.js';

/**
 * Word one graph in one language.
 *
 * This is the only place a language enters the output, and it is applied twice per run: once with
 * English for the files an agent reads, once with the maker's language for the viewer. Everything
 * upstream — collectors, flow parser, graph builder — stays language-free, so the two artefacts
 * come from a single collection and cannot drift apart in content, only in wording.
 *
 * What is NOT worded here is as deliberate as what is: object names, ids, `on`, `kind`, `verb`,
 * `refiredBy`, `state` and the solution names stay machine values in both copies, because they are
 * what a query filters on. Only prose is translated.
 */
export function materialize(raw: RawGraph, t: Translator): Graph {
  const text = (phrase: Phrase): string => say(phrase, t);

  return {
    ...raw,
    locale: t.locale,
    sources: raw.sources.map((source): SourceStatus => ({
      name: text(source.name),
      ok: source.ok,
      ...(source.detail === undefined ? {} : { detail: text(source.detail) }),
    })),
    nodes: raw.nodes.map((node): GraphNode => (node.trigger
      ? { ...node, trigger: { ...node.trigger, label: text(node.trigger.label) } }
      : (node as GraphNode))),
    edges: raw.edges.map((edge): GraphEdge => (edge.label === undefined
      ? (edge as GraphEdge)
      : { ...edge, label: text(edge.label) })),
    warnings: raw.warnings.map(text),
    cascades: Object.fromEntries(Object.entries(raw.cascades)
      .map(([id, steps]) => [id, steps.map((step) => materializeStep(step, text))])),
  };
}

function materializeStep(step: CascadeStep<Phrase>, text: (phrase: Phrase) => string): CascadeStep {
  const { on, writes, ...rest } = step;
  return {
    ...rest,
    ...(on === undefined ? {} : { on: text(on) }),
    writes: writes.map((write): CascadeWrite => ({
      ...write,
      next: write.next.map((next) => materializeStep(next, text)),
    })),
  };
}

/**
 * The wording for a flow's state.
 *
 * The state itself stays `enabled` / `disabled` in every artefact — a query has to survive the
 * report language — so both renderers come here for the words. An unrecognised state keeps whatever
 * the platform called it rather than being flattened into "unknown", which would hide it.
 */
export function stateLabel(state: FlowState | null | undefined, t: Translator): string | null {
  if (!state) return null;
  const key: MessageKey | null = state === 'enabled' ? 'stateEnabled'
    : state === 'disabled' ? 'stateDisabled' : null;
  return key ? t(key) : state;
}
