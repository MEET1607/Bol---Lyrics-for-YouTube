/** Bigram Dice coefficient — tolerant of transliteration variance ("tenu" vs "tainu"). */

function bigrams(input: string): string[] {
  const s = `#${input.toLowerCase().replace(/\s+/g, ' ').trim()}#`;
  const grams: string[] = [];
  for (let i = 0; i < s.length - 1; i++) grams.push(s.slice(i, i + 2));
  return grams;
}

export function diceSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a.toLowerCase() === b.toLowerCase()) return 1;

  const gramsA = bigrams(a);
  const gramsB = bigrams(b);
  const pool = new Map<string, number>();
  for (const g of gramsB) pool.set(g, (pool.get(g) ?? 0) + 1);

  let matches = 0;
  for (const g of gramsA) {
    const count = pool.get(g);
    if (count) {
      matches++;
      pool.set(g, count - 1);
    }
  }

  return (2 * matches) / (gramsA.length + gramsB.length);
}
