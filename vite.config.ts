/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'node:path';
import manifest from './manifest.json';

export default defineConfig({
  base: '',
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV === 'development',
    minify: 'esbuild',
    modulePreload: false,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    restoreMocks: true,
    unstubGlobals: true,
    // Process CSS so the shadow root's `?inline` stylesheet import resolves to
    // real content in tests rather than an empty string.
    css: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/vite-env.d.ts',
        // Type-only modules emit no runtime code to cover.
        'src/shared/types.ts',
        'src/ai/types.ts',
        // Entry points: registration only, exercised by the build and by hand.
        'src/popup/index.tsx',
        'src/options/index.tsx',
        'src/background/index.ts',
      ],
      // Enforced, not merely reported — the 80% standard was previously
      // configured nowhere and so met nowhere.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
