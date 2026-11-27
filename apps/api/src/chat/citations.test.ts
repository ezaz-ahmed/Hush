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
const noCitations = { grounded: false, reason: 'no_citations', unknownIds: [] };

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

  it.each(['[S1, S3]', '[S1,S3]', '[S1,  S3]'])('accepts grouped marker %s', (group) => {
    expect(checkCitations(`Claim ${group}.`, sources)).toEqual({
      grounded: true,
      citations: [src(1), src(3)],
    });
  });

  it('deduplicates across grouped and plain markers', () => {
    expect(checkCitations('A [S2]. B [S1, S2]. C [S3][S1].', sources)).toEqual({
      grounded: true,
      citations: [src(2), src(1), src(3)],
    });
  });

  it('reports no_citations without markers, for an empty reply, and with no sources', () => {
    expect(checkCitations('No markers here.', sources)).toEqual(noCitations);
    expect(checkCitations('', sources)).toEqual(noCitations);
    expect(checkCitations('No markers here.', [])).toEqual(noCitations);
  });

  it('reports unknown_ids for an unknown id', () => {
    expect(checkCitations('Made up [S9].', sources)).toEqual({
      grounded: false,
      reason: 'unknown_ids',
      unknownIds: ['S9'],
    });
  });

  it.each(['[S0]', '[S01]'])('treats %s as an unknown id', (marker) => {
    expect(checkCitations(`x ${marker}`, sources)).toEqual({
      grounded: false,
      reason: 'unknown_ids',
      unknownIds: [marker.slice(1, -1)],
    });
  });

  it('rejects valid and invalid ids mixed in separate markers', () => {
    expect(checkCitations('Real [S1] and fake [S9].', sources)).toEqual({
      grounded: false,
      reason: 'unknown_ids',
      unknownIds: ['S9'],
    });
  });

  it('rejects a fabricated id hidden in a group even though S1 is valid', () => {
    expect(checkCitations('Claim [S1, S9].', sources)).toEqual({
      grounded: false,
      reason: 'unknown_ids',
      unknownIds: ['S9'],
    });
  });

  it('dedupes unknownIds in order of first use', () => {
    const r = checkCitations('[S9] a [S1, S7] b [S9][S12] c [S7]', sources);
    expect(r).toEqual({
      grounded: false,
      reason: 'unknown_ids',
      unknownIds: ['S9', 'S7', 'S12'],
    });
  });

  it('reports unknown_ids when there are no sources at all', () => {
    expect(checkCitations('Claim [S1].', [])).toEqual({
      grounded: false,
      reason: 'unknown_ids',
      unknownIds: ['S1'],
    });
  });

  it.each(['x [s1] y [S1a] z [S] [ S1 ] (S1)', '[S1,] [S1, ] [S1 and S2]'])(
    'ignores malformed markers, so %s alone is no_citations',
    (reply) => {
      expect(checkCitations(reply, sources)).toEqual(noCitations);
    },
  );

  it('ignores malformed markers next to a valid one', () => {
    expect(checkCitations('x [s9] [S1a] [S1,] [S2]', sources)).toEqual({
      grounded: true,
      citations: [src(2)],
    });
  });
});
