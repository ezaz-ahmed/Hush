import type { ChatCitation } from '@hush/shared';
import { describe, expect, it } from 'vitest';
import { splitCitations } from './citations';

const cite = (id: string): ChatCitation => ({
  id,
  chunkId: `chunk-${id}`,
  documentId: `doc-${id}`,
  source: `content/clinic/${id}.md`,
  title: `Title ${id}`,
  excerpt: `Excerpt ${id}`,
  url: null,
});
const S1 = cite('S1');
const S3 = cite('S3');

describe('splitCitations', () => {
  it('returns one string when there are no markers', () => {
    expect(splitCitations('Plain answer.', [S1])).toEqual(['Plain answer.']);
  });

  it('returns [] for empty content', () => {
    expect(splitCitations('', [S1])).toEqual([]);
  });

  it('turns [S1] into a numbered part between the text', () => {
    expect(splitCitations('Before [S1] after.', [S1])).toEqual([
      'Before ',
      { n: 1, citation: S1 },
      ' after.',
    ]);
  });

  it('numbers by position in citations (first-use order)', () => {
    expect(splitCitations('A [S3] B [S1].', [S3, S1])).toEqual([
      'A ',
      { n: 1, citation: S3 },
      ' B ',
      { n: 2, citation: S1 },
      '.',
    ]);
  });

  it('yields one part per id for a grouped marker', () => {
    expect(splitCitations('Fact [S1, S3]', [S1, S3])).toEqual([
      'Fact ',
      { n: 1, citation: S1 },
      { n: 2, citation: S3 },
    ]);
  });

  it('gives a repeated marker the same n', () => {
    const parts = splitCitations('[S1] and [S1]', [S1]);
    expect(parts).toEqual([{ n: 1, citation: S1 }, ' and ', { n: 1, citation: S1 }]);
  });

  it('keeps an unknown id as text', () => {
    expect(splitCitations('Fact [S9].', [S1])).toEqual(['Fact [S9].']);
  });

  it('keeps unknown ids in a group as text and still links the known one', () => {
    expect(splitCitations('Fact [S1, S9]', [S1])).toEqual([
      'Fact ',
      { n: 1, citation: S1 },
      '[S9]',
    ]);
  });

  it.each(['[s1]', '[S1,]', '[ S1 ]'])('keeps malformed marker %s as text', (m) => {
    expect(splitCitations(`Fact ${m}.`, [S1])).toEqual([`Fact ${m}.`]);
  });
});
