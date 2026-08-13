---
description: Run the full quality gate — typecheck, lint, format, tests with coverage thresholds, and the production build.
---

Run the gate and report the result:

```bash
pnpm verify
```

That is `typecheck && lint && format:check && test && build`. Coverage thresholds (80% lines, functions, branches, statements) are enforced by the test step, so a drop in coverage fails the gate.

If anything fails:

1. Report the actual output — do not paraphrase or summarise away the error.
2. Fix the cause, not the symptom. In particular: do not lower a coverage threshold, do not add an ESLint disable, and do not weaken a type to make an error go away.
3. Re-run the whole gate, not just the step that failed.

Formatting failures are safe to fix with `pnpm format`.

If it passes, state plainly what ran and the coverage figure. Note anything the gate does **not** cover — it runs no browser, so nothing here proves the extension works when loaded. For that, use `/build-extension`.
