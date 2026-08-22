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
import { build as esbuild } from 'esbuild';
import { createServer, type IncomingMessage, type Server } from 'node:http';
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
  #ce { border: 1px solid #999; padding: 8px; }
</style></head>
<body>
  <header id="header">sticky header</header>
  <div id="overlay"></div>
  <main>
    <p id="para">The way we work is changing faster than ever before.</p>
    <textarea id="ta" rows="3" cols="40">their going to the meating tomorow</textarea>
    <input id="inp" type="text" size="40" value="recieve the pakage" />
    <!-- Stands in for Gmail: an ordinary contenteditable, the editor shape the
         extension is used in most, and one no test covered at all. -->
    <div id="ce" contenteditable="true">their going to the meating tomorow</div>
    <!-- Stands in for Lexical / ProseMirror / Slate, as used by WhatsApp Web,
         Facebook and LinkedIn: the DOM is a rendering of an internal model, the
         model is built from beforeinput, and anything the editor did not author
         itself is reverted on the next input. execCommand insertText dispatches
         no beforeinput, so an edit made that way is invisible to such an
         editor. -->
    <div id="ce-model" contenteditable="true">their going to the meating tomorow</div>
    <!-- An editor that ignores everything we offer it and appends regardless,
         over the nested shape a real editor uses. Nothing can make this one
         substitute; the requirement is that the card says so instead of claiming
         success, and that it does not report "Copied instead" as though the field
         had been left alone. -->
    <div id="ce-hostile" contenteditable="true"><p><span>their going to the meating tomorow</span></p></div>
  </main>
  <script>
    (() => {
      const hostile = document.getElementById('ce-hostile');
      hostile.addEventListener('beforeinput', (event) => {
        if (event.inputType !== 'insertText' || event.data == null) return;
        event.preventDefault();
        const span = hostile.querySelector('span');
        span.textContent = span.textContent + event.data;
      });
    })();

    (() => {
      const el = document.getElementById('ce-model');
      let model = el.textContent;

      el.addEventListener('beforeinput', (event) => {
        if (event.inputType !== 'insertText' || event.data == null) return;
        event.preventDefault();
        // A real editor maps the DOM selection onto its own document; locating
        // the selected string is a faithful enough stand-in. When it cannot
        // find it, the text lands at the end — the reported symptom exactly.
        const selected = getSelection().toString();
        const at = selected ? model.indexOf(selected) : -1;
        model =
          at >= 0
            ? model.slice(0, at) + event.data + model.slice(at + selected.length)
            : model + event.data;
        el.textContent = model;
      });

      el.addEventListener('input', () => {
        if (el.textContent !== model) el.textContent = model;
      });
    })();
  </script>
</body></html>`;

/**
 * A page running the real Lexical editor.
 *
 * WhatsApp Web's composer is Lexical, and the reported bug — the rewrite landing
 * beside the original instead of over it — was reproducible there while every
 * hand-written stand-in in this file passed. Modelling an editor is not the same
 * as testing one, so this mounts the genuine article from npm.
 */
export const LEXICAL_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>lexical</title><style>
  body { margin: 0; font: 16px system-ui; padding: 16px; }
  #editor { border: 1px solid #999; padding: 8px; min-height: 3em; }
</style></head>
<body>
  <div id="editor" contenteditable="true"></div>
  <script src="/lexical-bundle.js"></script>
</body></html>`;

/** The message the Lexical fixture starts with. */
export const LEXICAL_ORIGINAL = 'their going to the meating tomorow';

/**
 * Bundled on demand with esbuild, because the browser cannot resolve the bare
 * specifiers Lexical's ESM entry points use.
 */
const LEXICAL_ENTRY = `
import { createEditor, $getRoot, $createParagraphNode, $createTextNode } from 'lexical';
import { registerPlainText } from '@lexical/plain-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';

const element = document.getElementById('editor');
const editor = createEditor({ namespace: 'fixture', onError: (error) => { throw error; } });
editor.setRootElement(element);
registerPlainText(editor);
// Undo is Lexical's own, not the browser's: an edit the editor claimed via
// beforeinput goes onto this stack, and Ctrl+Z is meaningless without it.
// WhatsApp Web -- the composer this fixture stands in for -- has it.
registerHistory(editor, createEmptyHistoryState(), 300);

editor.update(() => {
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(${JSON.stringify(LEXICAL_ORIGINAL)}));
  $getRoot().clear().append(paragraph);
});

// Let the test read what Lexical itself believes its content to be, rather than
// trusting the DOM the extension may have written to directly.
window.__lexicalText = () => editor.getEditorState().read(() => $getRoot().getTextContent());
`;

export interface ExtensionFixtures {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
  /** Base URL of the fake provider, safe to store as a loopback baseUrl. */
  providerUrl: string;
  /** URL of the host page fixture. */
  pageUrl: string;
  /** URL of a page running the real Lexical editor. */
  lexicalUrl: string;
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

  lexicalUrl: async ({}, use) => {
    const bundle = await bundleLexical();
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/lexical-bundle.js')) {
        res.writeHead(200, {
          'Content-Type': 'text/javascript; charset=utf-8',
        });
        res.end(bundle);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(LEXICAL_HTML);
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

    // The body decides the length: a test that needs to grow the card past a
    // short viewport asks for the long completion by its input text.
    void readBody(req).then((body) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Access-Control-Allow-Origin': '*',
      });
      for (const piece of body.includes(LONG_INPUT) ? LONG_PIECES : PIECES) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`,
        );
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  return listen(server).then(() => server);
}

let lexicalBundle: string | null = null;

/** Bundle the Lexical entry once per run; the result is a plain classic script. */
async function bundleLexical(): Promise<string> {
  if (lexicalBundle !== null) return lexicalBundle;

  const result = await esbuild({
    stdin: {
      contents: LEXICAL_ENTRY,
      resolveDir: resolve(dirname(fileURLToPath(import.meta.url)), '../..'),
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    write: false,
    define: { 'process.env.NODE_ENV': '"development"' },
  });

  lexicalBundle = result.outputFiles[0]?.text ?? '';
  return lexicalBundle;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => done(body));
  });
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

const PIECES = ['They ', 'are ', 'going ', 'to ', 'the ', 'meeting.'];

/** The completion the provider stub streams. */
export const EXPECTED_REWRITE = 'They are going to the meeting.';

/**
 * Input that asks the stub for a completion long enough to fill the output area.
 *
 * A short suggestion leaves the card at roughly its estimated height, which is
 * why the clipped action bar only showed up on long rewrites.
 */
export const LONG_INPUT = 'please-make-this-long';

const LONG_SENTENCE =
  'This suggestion is deliberately long so that it fills the output area and grows the card. ';
const LONG_PIECES = Array.from({ length: 10 }, () => LONG_SENTENCE);

/** A fragment of the long completion, for asserting it arrived. */
export const LONG_REWRITE_FRAGMENT = 'fills the output area';
