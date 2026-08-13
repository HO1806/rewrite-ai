/**
 * Harness for driving the built extension in a real Chromium.
 *
 * Two things are provided: a browser with `dist/` loaded, and a local stand-in
 * for an AI provider so no key and no spend are involved.
 */

import {
  test as base,
  chromium,
  type BrowserContext,
  type Worker,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The package is ESM ("type": "module"), so __dirname does not exist.
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist');

/** A page with a positioned, high-z-index overlay covering where the card mounts. */
export const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>host page</title><style>
  body { margin: 0; font: 16px system-ui; }
  header { position: sticky; top: 0; z-index: 9999; background: crimson;
           color: #fff; padding: 10px; }
  /* Stands in for a Gmail/Slack overlay: positioned, stacked above content, and
     covering the region the card appears in. */
  #overlay { position: fixed; inset: 0 0 auto 0; height: 460px; z-index: 9999;
             background: rgba(0, 128, 0, 0.25); }
  main { padding: 16px; position: relative; z-index: 1; }
</style></head>
<body>
  <header id="header">sticky header</header>
  <div id="overlay"></div>
  <main>
    <p id="para">The way we work is changing faster than ever before.</p>
    <textarea id="ta" rows="3" cols="40">their going to the meating tomorow</textarea>
    <input id="inp" type="text" size="40" value="recieve the pakage" />
  </main>
</body></html>`;

export interface ExtensionFixtures {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  /** Base URL of the fake provider, safe to store as a loopback baseUrl. */
  providerUrl: string;
  /** URL of the host page fixture. */
  pageUrl: string;
  /** Configure the extension's stored settings. */
  seedSettings: (overrides?: Record<string, unknown>) => Promise<void>;
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({}, use) => {
    if (!existsSync(join(DIST, 'manifest.json'))) {
      throw new Error('dist/ is missing or unbuilt. Run `pnpm build` first.');
    }

    const profile = mkdtempSync(join(tmpdir(), 'rewrite-ai-e2e-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });

    await use(context);

    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },

  worker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },

  providerUrl: async ({}, use) => {
    const server = await startProviderStub();
    await use(`http://127.0.0.1:${port(server)}/v1`);
    server.close();
  },

  pageUrl: async ({}, use) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FIXTURE_HTML);
    });
    await listen(server);
    await use(`http://127.0.0.1:${port(server)}/`);
    server.close();
  },

  seedSettings: async ({ worker, providerUrl }, use) => {
    await use(async (overrides = {}) => {
      await worker.evaluate(
        async ([baseUrl, extra]) => {
          const settings = {
            provider: 'custom',
            apiKey: 'test-key',
            model: 'test-model',
            temperature: 0.3,
            maxTokens: 2048,
            stream: true,
            theme: 'dark',
            baseUrl,
            translateLanguage: 'English',
            ...(extra as Record<string, unknown>),
          };
          await chrome.storage.local.set({ 'rewrite-ai-settings': settings });
        },
        [providerUrl, overrides] as const,
      );
    });
  },
});

export { expect } from '@playwright/test';

/** Streams a fixed completion in the OpenAI SSE shape. */
function startProviderStub(): Promise<Server> {
  const server = createServer((req, res) => {
    if (!req.url?.includes('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Access-Control-Allow-Origin': '*',
    });
    for (const piece of [
      'They ',
      'are ',
      'going ',
      'to ',
      'the ',
      'meeting.',
    ]) {
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
      );
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });

  return listen(server).then(() => server);
}

function listen(server: Server): Promise<void> {
  return new Promise((done) => server.listen(0, '127.0.0.1', done));
}

function port(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('server has no port');
  return address.port;
}

/** The completion the provider stub streams. */
export const EXPECTED_REWRITE = 'They are going to the meeting.';
