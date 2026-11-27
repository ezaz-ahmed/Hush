import { describe, expect, it } from 'vitest';
import type { AnswerSource } from '../prompts/answer-prompt.js';
import { checkCitations } from './citations.js';

const src = (n: number): AnswerSource => ({
  id: `S${n}`,
  chunkId: `chunk-${n}`,
  documentId: `doc-${n}`,
  source: `content/clinic/${n}.md`,
});
const sources = [src(1), src(2), src(3)];

describe('checkCitations', () => {
  it('is grounded with one valid id, returning the matched source (with its S id)', () => {
    expect(checkCitations('Minoxidil takes months [S2].', sources)).toEqual({
      grounded: true,
      citations: [src(2)],
    });
  });

  it('deduplicates repeats in order of first use', () => {
    const r = checkCitations('A [S3]. B [S1]. C [S3]. D [S1][S2].', sources);
    expect(r).toEqual({ grounded: true, citations: [src(3), src(1), src(2)] });
  });

  it('handles adjacent brackets', () => {
    expect(checkCitations('Both agree [S1][S2]', sources)).toEqual({
      grounded: true,
      citations: [src(1), src(2)],
    });
  });

  it('is not grounded without markers', () => {
    expect(checkCitations('No markers here.', sources)).toEqual({ grounded: false });
    expect(checkCitations('', sources)).toEqual({ grounded: false });
  });

  it('is not grounded for an unknown id', () => {
    expect(checkCitations('Made up [S9].', sources)).toEqual({ grounded: false });
  });

  it('is not grounded when valid and invalid ids are mixed', () => {
    expect(checkCitations('Real [S1] and fake [S9].', sources)).toEqual({ grounded: false });
  });

  it('is not grounded when there are no sources at all', () => {
    expect(checkCitations('Claim [S1].', [])).toEqual({ grounded: false });
  });

  it('ignores lowercase and malformed markers, so a reply with only those is ungrounded', () => {
    expect(checkCitations('x [s1] y [S1a] z [S] [ S1 ] (S1)', sources)).toEqual({
      grounded: false,
    });
  });

  it('ignores malformed markers next to a valid one', () => {
    expect(checkCitations('x [s9] [S1a] [S2]', sources)).toEqual({
      grounded: true,
      citations: [src(2)],
    });
  });
});
