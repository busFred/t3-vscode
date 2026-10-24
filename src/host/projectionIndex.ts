/** Lookup tables cached per immutable projection array, so per-row transcript work stays constant-time on long threads. */
const cache = new WeakMap<ReadonlyArray<unknown>, Map<string, Map<unknown, unknown>>>();
/** `slot` names the key function; `last` keeps the final match instead of the first, mirroring `findLast`. */
export function indexBy<T, K>(rows: ReadonlyArray<T>, slot: string, key: (row: T) => K | null | undefined, last = false): ReadonlyMap<K, T> {
  let slots = cache.get(rows);
  if (!slots) cache.set(rows, slots = new Map());
  let index = slots.get(slot) as Map<K, T> | undefined;
  if (!index) {
    index = new Map();
    for (const row of rows) { const value = key(row); if (value !== null && value !== undefined && (last || !index.has(value))) index.set(value, row); }
    slots.set(slot, index as Map<unknown, unknown>);
  }
  return index;
}
