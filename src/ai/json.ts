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
