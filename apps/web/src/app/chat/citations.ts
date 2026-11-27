import { CITATION_MARKER, type ChatCitation } from '@hush/shared';

export type CitationPart = string | { n: number; citation: ChatCitation };

// Splits answer text into plain strings and numbered citation parts.
// n = position in `citations` + 1 (the API already sends them in first-use order).
// Ids missing from `citations` stay as literal `[S#]` text.
export function splitCitations(content: string, citations: ChatCitation[]): CitationPart[] {
  const parts: CitationPart[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = parts.at(-1);
    if (typeof last === 'string') parts[parts.length - 1] = last + text;
    else parts.push(text);
  };

  let pos = 0;
  // matchAll clones the global regex, so the shared lastIndex is never touched.
  for (const match of content.matchAll(CITATION_MARKER)) {
    pushText(content.slice(pos, match.index));
    pos = match.index + match[0].length;
    for (const id of match[1]!.split(/,\s*/)) {
      // group 1 always exists when the regex matches
      const i = citations.findIndex((c) => c.id === id);
      const citation = citations[i];
      if (citation) parts.push({ n: i + 1, citation });
      else pushText(`[${id}]`);
    }
  }
  pushText(content.slice(pos));
  return parts;
}
