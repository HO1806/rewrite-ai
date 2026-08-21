/**
 * Safe navigation for parsed JSON.
 *
 * Provider responses arrive as `unknown`. Rather than casting to `any` and
 * chaining optional access (which silently yields `undefined` on a shape
 * change and reports it as an empty completion), every extraction walks the
 * path through these guards.
 */

export type JsonPathSegment = string | number;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walk a path of object keys and array indices, returning undefined at the first miss. */
export function dig(
  value: unknown,
  ...path: readonly JsonPathSegment[]
): unknown {
  let current: unknown = value;

  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[segment];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

/** Walk a path and return the value only if it is a non-empty string. */
export function digString(
  value: unknown,
  ...path: readonly JsonPathSegment[]
): string | undefined {
  const found = dig(value, ...path);
  return typeof found === 'string' && found.length > 0 ? found : undefined;
}

/** Parse JSON without throwing. Returns undefined for malformed input. */
export function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Pull a list of model ids out of a catalogue response.
 *
 * Every provider returns the same idea in a different envelope — `data[].id`,
 * `models[].name` — so the shape is passed in and the defensive work is shared:
 * a catalogue is an untrusted boundary like any other provider response, and a
 * malformed one must yield an empty list rather than `[undefined]`.
 *
 * Entries are de-duplicated and sorted, because a raw catalogue arrives in the
 * provider's own order, which is rarely useful and never stable.
 */
export function collectModelIds(
  body: unknown,
  listKey: string,
  idKey: string,
  transform: (id: string) => string | null = (id) => id,
): string[] {
  const list = dig(body, listKey);
  if (!Array.isArray(list)) return [];

  const ids = new Set<string>();
  for (const entry of list) {
    const raw = digString(entry, idKey);
    if (!raw) continue;
    const id = transform(raw);
    if (id) ids.add(id);
  }

  return [...ids].sort();
}
