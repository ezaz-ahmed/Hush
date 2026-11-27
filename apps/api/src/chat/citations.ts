import { CITATION_MARKER } from '@hush/shared';
import type { AnswerSource } from '../prompts/answer-prompt.js';

export type CitationCheck =
  | { grounded: true; citations: AnswerSource[] }
  | { grounded: false; reason: 'no_citations' | 'unknown_ids'; unknownIds: string[] };

/**
 * Grounded only if the reply has at least one citation and every cited id (including each id in a group) is a known source id.
 * Returns the matched sources, deduplicated, in order of first use. On failure, `reason` is `unknown_ids` if any
 * id is unknown (even when valid ones exist), else `no_citations`; `unknownIds` is deduplicated, in first-seen order.
 * Pure.
 */
export function checkCitations(reply: string, sources: AnswerSource[]): CitationCheck {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const used = new Map<string, AnswerSource>();
  const unknown = new Set<string>();
  for (const m of reply.matchAll(CITATION_MARKER)) {
    for (const id of (m[1] ?? '').split(/,\s*/)) {
      // group 1 always set by the regex
      const s = byId.get(id);
      if (s) used.set(id, s);
      else unknown.add(id);
    }
  }
  if (unknown.size > 0) return { grounded: false, reason: 'unknown_ids', unknownIds: [...unknown] };
  if (used.size === 0) return { grounded: false, reason: 'no_citations', unknownIds: [] };
  return { grounded: true, citations: [...used.values()] };
}
