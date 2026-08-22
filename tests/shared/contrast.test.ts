/**
 * WCAG contrast, computed from the real tokens.
 *
 * This exists because two colours shipped below AA and nothing noticed: light
 * theme `--danger` was never redefined at all, so error text — the one message a
 * user most needs to read — rendered at 2.75:1 on a near-white card, and
 * `--text-muted` missed by a hair at 4.39:1. Reading the stylesheet rather than
 * restating the values means a future edit to `tokens.css` is what fails here,
 * not a copy of it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(
  resolve(__dirname, '../../src/styles/tokens.css'),
  'utf8',
);

type Oklch = readonly [number, number, number];

/** The last definition of a token wins, within the block that defines it. */
function token(name: string, theme: 'dark' | 'light'): Oklch {
  const lightAt = CSS.indexOf("[data-theme='light']");
  const scope = theme === 'dark' ? CSS.slice(0, lightAt) : CSS.slice(lightAt);
  // Built without backslash escapes so the pattern survives any quoting layer.
  const number = '([0-9.]+)';
  const gap = '[ ]+';
  const pattern = new RegExp(
    `--${name}:[ ]*oklch[(]${number}%${gap}${number}${gap}${number}`,
    'g',
  );
  const matches = [...scope.matchAll(pattern)];

  // A token the light block never redefines inherits the dark value — which is
  // exactly how `--danger` came to fail.
  if (matches.length === 0 && theme === 'light') return token(name, 'dark');

  const last = matches[matches.length - 1];
  if (!last) throw new Error(`token --${name} not found for ${theme}`);
  return [Number(last[1]) / 100, Number(last[2]), Number(last[3])];
}

function relativeLuminance([L, C, hDeg]: Oklch): number {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const [r, g, bl] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));

  return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
}

function contrast(foreground: Oklch, background: Oklch): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

const AA_TEXT = 4.5;
/** SC 1.4.11: a control's boundary needs 3:1, not 4.5:1. */
const AA_NON_TEXT = 3;

describe.each(['dark', 'light'] as const)('%s theme meets WCAG AA', (theme) => {
  const base = () => token('surface-base', theme);
  const raised = () => token('surface-raised', theme);

  it.each([
    ['body text on the card', 'text-primary', base],
    ['body text on the output area', 'text-primary', raised],
    ['secondary text', 'text-secondary', raised],
    ['muted status text', 'text-muted', raised],
    ['error text', 'danger', raised],
  ])('%s', (_label, name, background) => {
    expect(contrast(token(name, theme), background())).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it('the primary button label on its own fill', () => {
    expect(
      contrast(token('text-on-accent', theme), token('accent', theme)),
    ).toBeGreaterThanOrEqual(AA_TEXT);
  });

  // The secondary buttons have no fill of their own — the border is the whole
  // control boundary, so 1.4.11 applies to it. In light theme it shipped at
  // 2.00:1 and the buttons read as floating labels.
  it.each([
    ['the secondary button outline', 'border-strong', base],
    [
      'the secondary button outline on the output area',
      'border-strong',
      raised,
    ],
  ])('%s', (_label, name, background) => {
    expect(contrast(token(name, theme), background())).toBeGreaterThanOrEqual(
      AA_NON_TEXT,
    );
  });
});
