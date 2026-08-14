/**
 * Tidying a completion before it reaches the page.
 *
 * Scope is deliberately tiny. Every transformation here either operates on a
 * string this codebase generated (the delimiter) or is guarded by a check against
 * the source, because this runs on text that is about to replace what the user
 * wrote — a wrong "fix" here silently corrupts their message.
 *
 * **Explicitly not done: stripping conversational preamble.** A rule like
 * `^(Sure|Certainly|Here is)\b.*:` would mangle a legitimate rewrite beginning
 * "Here is the agenda:", which is an entirely ordinary thing to write in the tool
 * this is. Nor is there any "this looks like an answer rather than a rewrite"
 * heuristic: it cannot be made reliable, and a false positive would discard a
 * correct result. The prompt frame in `assemble.ts` is what stops the model
 * answering; this is hygiene for when it very nearly complied.
 */

import type { PromptBundle } from './assemble';

/** Opening quote characters, mapped to the closing character that pairs with them. */
const QUOTE_PAIRS: Record<string, string> = {
  '"': '"',
  "'": "'",
  '“': '”',
  '‘': '’',
};

type SanitizeContext = Pick<
  PromptBundle,
  'tag' | 'body' | 'leading' | 'trailing'
>;

/** Bounded, because the loop below is a fixed point rather than a fixed count. */
const MAX_PASSES = 3;

export function sanitizeResult(raw: string, context: SanitizeContext): string {
  let stripped = raw.trim();

  /**
   * Run to a fixed point rather than once through.
   *
   * A model can nest the two wrappers either way round — `"<tag>…</tag>"` or
   * `<tag>"…"</tag>` — so a single pass in a fixed order leaves one of them
   * behind, and leaving one behind means `sanitize(sanitize(x)) !== sanitize(x)`.
   * Each pass strictly shortens the string, so this terminates.
   */
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = stripWrappingQuotes(
      stripDelimiter(stripped, context.tag),
      context.body,
    );
    if (next === stripped) break;
    stripped = next;
  }

  // Give back the whitespace the frame trimmed off the selection, so replacing a
  // selection that ended in a space does not swallow the space.
  return `${context.leading}${stripped}${context.trailing}`;
}

/**
 * Remove the delimiter when the model echoed it around its answer.
 *
 * Only at the very edges, and only the exact tag that was used — which
 * `resolveTag` guarantees does not appear in the selection, so this cannot delete
 * the user's own text. A tag in the middle is left alone: that is visible
 * garbage, which is preferable to guessing at surgery.
 */
function stripDelimiter(text: string, tag: string): string {
  let result = text;

  const open = `<${tag}>`;
  if (result.toLowerCase().startsWith(open)) {
    result = result.slice(open.length).trimStart();
  }

  const close = `</${tag}>`;
  if (result.toLowerCase().endsWith(close)) {
    result = result.slice(0, -close.length).trimEnd();
  }

  return result;
}

/**
 * Remove a matched pair of quotes the model wrapped the whole result in.
 *
 * Four conditions, and each one is load-bearing:
 * the ends must be a matching pair; the source must not have started with that
 * same character, or a legitimately quoted selection would come back unquoted;
 * and the interior must not contain the closing character, which is what stops
 * `"Yes," he said, "we will."` being turned into `Yes," he said, "we will.`
 */
function stripWrappingQuotes(text: string, source: string): string {
  if (text.length < 2) return text;

  const first = text[0] ?? '';
  const closing = QUOTE_PAIRS[first];
  if (!closing) return text;
  if (!text.endsWith(closing)) return text;
  if (source.startsWith(first)) return text;

  const interior = text.slice(1, -1);
  if (interior.includes(closing)) return text;

  return interior.trim();
}
