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
import { settingsSchema } from '@/storage/settings';
import type {
  BackgroundToContentMessage,
  GetThemeRequest,
  RewriteAction,
  SetLanguageRequest,
  StreamMessage,
  StreamRequest,
} from '@/shared/types';

export const rewriteActionSchema = z.enum([
  'improve',
  'translate',
]) satisfies z.ZodType<RewriteAction>;

/** background → content */
export const backgroundToContentMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('TRIGGER_REWRITE'),
    action: rewriteActionSchema,
    language: z.string().min(1),
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
}) satisfies z.ZodType<GetThemeRequest>;

/**
 * content → background: persist a language chosen from the card's gear.
 *
 * A write rather than a read, but the same reasoning — the content script hands
 * over one harmless field instead of touching the settings object.
 */
export const setLanguageRequestSchema = z.object({
  type: z.literal('SET_LANGUAGE'),
  language: z.string().min(1).max(60),
}) satisfies z.ZodType<SetLanguageRequest>;

export const themeResponseSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']),
});

/**
 * options/popup → background: what models does this key actually have?
 *
 * Carries the credentials *being edited* rather than reading stored settings, so
 * the button works before a save. That is safe here in a way it would not be
 * from a content script: both ends are extension surfaces, and the options page
 * already holds the key in its own form. A content script shares a process with
 * the page, which is why it gets `GET_THEME` and nothing more.
 *
 * The fields are picked from `settingsSchema` rather than redeclared, so the
 * base URL keeps the refinement that makes it safe to fetch: this message
 * directs a request that carries the user's API key, and an unvalidated URL
 * would reopen exactly the exfiltration path that refinement exists to close.
 */
export const listModelsRequestSchema = z.object({
  type: z.literal('LIST_MODELS'),
  settings: settingsSchema.pick({
    provider: true,
    apiKey: true,
    model: true,
    baseUrl: true,
  }),
});

export const listModelsResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), models: z.array(z.string()) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

export type ListModelsResponse = z.infer<typeof listModelsResponseSchema>;

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
