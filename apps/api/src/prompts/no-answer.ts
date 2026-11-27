import { readFileSync } from 'node:fs';

export const NO_ANSWER_VERSION = 'no-answer-v1';

// Read once at load, trimmed so the file's trailing newline is not part of the stored text.
export const NO_ANSWER_TEXT = readFileSync(
  new URL(`../../prompts/${NO_ANSWER_VERSION}.md`, import.meta.url),
  'utf8',
).trim();
