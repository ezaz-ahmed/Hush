export const RRF_K = 60; // Cormack et al. 2009

/**
 * Reciprocal rank fusion. Each list is ids best-first (1-based rank). Returns every id once,
 * best first, ties by id ascending. An id missing from a list contributes 0 for it.
 */
export function fuseRrf(lists: string[][], k: number = RRF_K): { id: string; score: number }[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}
