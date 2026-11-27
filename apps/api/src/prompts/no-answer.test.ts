import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NO_ANSWER_TEXT, NO_ANSWER_VERSION } from './no-answer.js';

describe('no-answer prompt', () => {
  it('has version no-answer-v1', () => {
    expect(NO_ANSWER_VERSION).toBe('no-answer-v1');
  });

  it('equals the trimmed content of no-answer-v1.md', () => {
    const file = readFileSync(new URL('../../prompts/no-answer-v1.md', import.meta.url), 'utf8');
    expect(NO_ANSWER_TEXT).toBe(file.trim());
    expect(NO_ANSWER_TEXT).not.toBe('');
  });

  it('contains no citation markers', () => {
    expect(NO_ANSWER_TEXT).not.toContain('[S');
  });
});
