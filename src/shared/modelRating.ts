/**
 * A rough strength score for a model, read off its name.
 *
 * **This is a heuristic, not a benchmark.** There is no API that reports how good
 * a model is, so this reads the signals vendors put in their ids — parameter
 * counts, tier words, version numbers — and turns them into an ordering. It will
 * be wrong about some models, and it says so in the UI rather than presenting a
 * number as measured fact.
 *
 * Scores are **relative to the list they appear in**, which is what makes them
 * useful: the point is "which of my options is strongest", not an absolute claim
 * about a model against every model that exists.
 */

/** Tier words vendors use, strongest first within each family. */
const TIER_WEIGHTS: ReadonlyArray<readonly [RegExp, number]> = [
  // Anthropic
  [/\bopus\b/, 40],
  [/\bsonnet\b/, 26],
  [/\bhaiku\b/, 14],
  // OpenAI's named tiers
  [/\bsol\b/, 38],
  [/\bterra\b/, 26],
  [/\bluna\b/, 15],
  // Google
  [/\bultra\b/, 38],
  [/\bpro\b/, 30],
  [/\bflash\b/, 18],
  // Generic
  [/\blarge\b/, 30],
  [/\bmedium\b/, 20],
  [/\bsmall\b/, 12],
];

/** Words that mark a deliberately cheaper, weaker variant. */
const PENALTIES: ReadonlyArray<readonly [RegExp, number]> = [
  [/\blite\b|-lite/, 10],
  [/\bmini\b/, 8],
  [/\bnano\b/, 14],
  [/\binstant\b/, 8],
  [/\bfast\b/, 4],
  [/\bpreview\b|\bexp\b|\bbeta\b/, 6],
];

/**
 * Parameter count in billions, when the id advertises one.
 *
 * Matches `120b`, `8x7b`, `27b`. Deliberately anchored so the `3` in `llama3`
 * or a date like `20251001` cannot be read as a size.
 */
function parameterBillions(id: string): number | null {
  const match = /(?:^|[^a-z0-9])(\d{1,4})(?:x(\d{1,3}))?b(?![a-z0-9])/.exec(id);
  if (!match) return null;

  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : null;
  // A mixture-of-experts name like 8x7b advertises 8 experts of 7B.
  return second === null ? first : first * second;
}

/**
 * The highest version number in the id, as a weak recency signal.
 *
 * A version follows letters — `gpt-5.6`, `qwen3.6`, `gemini-3.7`. Requiring that
 * is what stops a parameter count being read as one: an earlier version of this
 * scored `gpt-oss-20b` above `gpt-oss-120b`, because "20b" looked like version 20
 * while "120b" matched nothing at all. Sizes are stripped before the search for
 * the same reason.
 */
function versionSignal(id: string): number {
  const withoutSizes = id.replace(
    /(?:^|[^a-z0-9])\d{1,4}(?:x\d{1,3})?b(?![a-z0-9])/g,
    ' ',
  );

  const versions = [
    ...withoutSizes.matchAll(/[a-z][-_]?(\d{1,2})(?:\.(\d{1,2}))?(?![\d])/g),
  ]
    .map((match) => Number(match[1]) + (match[2] ? Number(match[2]) / 100 : 0))
    // A date like 20251001 is not a version, and neither is anything absurd.
    .filter((value) => value > 0 && value < 30);

  return versions.length > 0 ? Math.max(...versions) : 0;
}

/**
 * A raw, unbounded score. Only meaningful when compared with another.
 *
 * Returns null when the name carries no signal at all, so the UI can say it does
 * not know rather than inventing a number.
 */
export function rawModelScore(id: string): number | null {
  const name = id.toLowerCase();
  let score = 0;
  let hasSignal = false;

  for (const [pattern, weight] of TIER_WEIGHTS) {
    if (pattern.test(name)) {
      score += weight;
      hasSignal = true;
      break;
    }
  }

  const billions = parameterBillions(name);
  if (billions !== null) {
    // Diminishing returns: 120B is not six times 20B in any useful sense.
    score += Math.log2(billions + 1) * 9;
    hasSignal = true;
  }

  const version = versionSignal(name);
  if (version > 0) {
    score += version * 1.5;
    hasSignal = true;
  }

  for (const [pattern, penalty] of PENALTIES) {
    if (pattern.test(name)) {
      score -= penalty;
      hasSignal = true;
    }
  }

  return hasSignal ? score : null;
}

export interface RatedModel {
  readonly id: string;
  /** 1–10 within this list, or null when the name carries no signal. */
  readonly rating: number | null;
}

/**
 * Rate a list against itself, strongest first.
 *
 * Normalising across the list is the point: a rating answers "how does this
 * compare with my other options", which is the question someone picking from a
 * dropdown is actually asking. A single model therefore always rates 10 — it is
 * the strongest thing on offer, because it is the only thing on offer.
 */
export function rateModels(ids: readonly string[]): RatedModel[] {
  const scored = ids.map((id) => ({ id, raw: rawModelScore(id) }));
  const known = scored
    .map((entry) => entry.raw)
    .filter((raw): raw is number => raw !== null);

  const lowest = Math.min(...known);
  const highest = Math.max(...known);
  const span = highest - lowest;

  return (
    scored
      .map(({ id, raw }) => ({
        id,
        raw,
        rating:
          raw === null
            ? null
            : span === 0
              ? 10
              : Math.max(1, Math.round(1 + ((raw - lowest) / span) * 9)),
      }))
      /**
       * Ordered by the raw score, not the rounded rating. Two models can round to
       * the same number and still have an order worth preserving — `gemini-3.7` and
       * `gemini-3.6` both show 10, and the newer one still belongs first.
       */
      .sort(
        (a, b) =>
          (b.raw ?? -Infinity) - (a.raw ?? -Infinity) ||
          a.id.localeCompare(b.id),
      )
      .map(({ id, rating }) => ({ id, rating }))
  );
}
