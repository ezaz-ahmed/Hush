import { readFileSync } from 'node:fs';
import type { Citation } from '../database/schema.js';
import type { LlmMessage } from '../llm/llm-provider.js';
import type { RetrievedChunk } from '../retrieval/retrieve.js';

export const ANSWER_PROMPT_VERSION = 'answer-v1';

// Read once at load: a missing file fails at startup. Path resolves from src/ and dist/.
export const ANSWER_SYSTEM_PROMPT = readFileSync(
  new URL(`../../prompts/${ANSWER_PROMPT_VERSION}.md`, import.meta.url),
  'utf8',
);

export type AnswerSource = Citation & { id: string }; // id is 'S1', 'S2', ...

export interface AnswerPrompt {
  promptVersion: string; // store on the assistant message (#28)
  system: string;
  messages: LlmMessage[]; // exactly one 'user' message
  sources: AnswerSource[]; // same order as the chunks passed in
}

// `&` first, so `&lt;` in data becomes `&amp;lt;` and cannot be read back as `<`.
const escapeText = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * Pure. `question` must already have been through PII redaction (rule 1, #40).
 * Throws RangeError (no input text in the message) if `chunks` is empty or the question is blank.
 * Never logs.
 */
export function buildAnswerPrompt(
  question: string,
  chunks: readonly RetrievedChunk[],
): AnswerPrompt {
  if (chunks.length === 0) throw new RangeError('chunks must not be empty');
  const q = question.trim();
  if (q === '') throw new RangeError('question must not be blank');

  const sources = chunks.map((c, i) => ({
    id: `S${i + 1}`,
    chunkId: c.chunkId,
    documentId: c.documentId,
    source: c.source,
  }));
  const body = chunks.map(
    (c, i) =>
      `<source id="S${i + 1}" title="${escapeText(c.title)}">\n${escapeText(c.text)}\n</source>`,
  );
  const content = `<sources>\n${body.join('\n')}\n</sources>\n\n<question>\n${escapeText(q)}\n</question>`;

  return {
    promptVersion: ANSWER_PROMPT_VERSION,
    system: ANSWER_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    sources,
  };
}
