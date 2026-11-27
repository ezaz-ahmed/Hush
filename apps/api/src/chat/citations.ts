import type { AnswerSource } from '../prompts/answer-prompt.js';

export type CitationCheck = { grounded: true; citations: AnswerSource[] } | { grounded: false };

/**
 * Grounded only if the reply has at least one `[S#]` marker and every marker is a known source id.
 * Returns the matched sources, deduplicated, in order of first use. Pure; #29 replaces it with the same signature.
 */
export function checkCitations(reply: string, sources: AnswerSource[]): CitationCheck {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const used = new Map<string, AnswerSource>();
  for (const m of reply.matchAll(/\[(S\d+)\]/g)) {
    const id = m[1] ?? ''; // group 1 always set by the regex
    const s = byId.get(id);
    if (!s) return { grounded: false };
    used.set(id, s);
  }
  return used.size > 0 ? { grounded: true, citations: [...used.values()] } : { grounded: false };
}
