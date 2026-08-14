/**
 * Config for the opt-in model evals, kept separate from `vite.config.ts` on
 * purpose.
 *
 * The main config's `include` is `tests/**\/*.test.ts(x)`, so nothing under
 * `tests/eval/` can be picked up by `pnpm test`, `pnpm verify` or the coverage
 * gate. These evals call a real API: they cost money, they need a key, and a
 * model's output is not deterministic, so they must never sit in the gate that
 * has to pass on every commit. Run them deliberately, with `pnpm eval`.
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  test: {
    globals: true,
    // Node, not jsdom: this talks to the network and touches no DOM.
    environment: 'node',
    include: ['tests/eval/**/*.eval.ts'],
    // One at a time, to stay inside the provider's rate limits.
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 60_000,
  },
});
