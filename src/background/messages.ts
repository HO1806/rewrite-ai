/**
 * Runtime validation for every message crossing a process boundary.
 *
 * These schemas existed before but were imported by nothing: the port handler
 * cast its payload with `msg as StreamRequest` and the content script compared
 * `message.type` as a raw string, so nothing was actually checked at runtime.
 * Each schema is `satisfies z.ZodType<...>` against the shared type, so the
 * two cannot drift apart.
 */

import { z } from 'zod';
import { MAX_INPUT_LENGTH } from '@/shared/constants';
import type {
  AdjustParams,
  BackgroundToContentMessage,
  StreamMessage,
  StreamRequest,
} from '@/shared/types';

export const rewriteActionSchema = z.enum([
  'improve',
  'grammar',
  'professional',
  'friendly',
  'concise',
  'expand',
  'translate',
]);

export const adjustParamsSchema = z.object({
  tone: z
    .enum(['professional', 'casual', 'enthusiastic', 'informational', 'funny'])
    .optional(),
  format: z.enum(['paragraph', 'email', 'ideas', 'blog']).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
}) satisfies z.ZodType<AdjustParams>;

/** background → content */
export const backgroundToContentMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('REWRITE_REQUEST'),
    action: rewriteActionSchema,
    text: z.string(),
  }),
  z.object({
    type: z.literal('TRIGGER_REWRITE'),
    action: rewriteActionSchema,
  }),
  /**
   * Readiness probe. The worker polls this after injecting the content script,
   * because injection completing does not mean the script is listening — see
   * the note in background/tabs.ts.
   */
  z.object({
    type: z.literal('PING'),
  }),
]) satisfies z.ZodType<BackgroundToContentMessage>;

/**
 * content → background, over the streaming port.
 *
 * The length cap is the point of this schema: the text was previously forwarded
 * straight into the provider payload with no bound, so a large selection meant
 * an oversized request and an oversized bill.
 */
export const streamRequestSchema = z.object({
  type: z.literal('START_REWRITE'),
  action: rewriteActionSchema,
  text: z.string().min(1).max(MAX_INPUT_LENGTH),
  adjustParams: adjustParamsSchema.optional(),
}) satisfies z.ZodType<StreamRequest>;

/**
 * content → background, one-shot.
 *
 * The content script needs the theme, and nothing else. It must not read the
 * settings object to get it: that object holds the API key, and pulling the key
 * into a process shared with the page is exactly what this codebase went out of
 * its way to stop doing. So it asks for the one harmless field.
 */
export const themeRequestSchema = z.object({
  type: z.literal('GET_THEME'),
});

export const themeResponseSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
});

/** background → content, over the streaming port */
export const streamMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CHUNK'), text: z.string() }),
  z.object({ type: z.literal('DONE'), fullText: z.string() }),
  z.object({ type: z.literal('ERROR'), message: z.string() }),
]) satisfies z.ZodType<StreamMessage>;

/** Human-readable reason a payload was rejected, for surfacing to the user. */
export function describeValidationError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'Invalid request.';
  const path = first.path.join('.');
  return path
    ? `Invalid request (${path}): ${first.message}`
    : `Invalid request: ${first.message}`;
}
