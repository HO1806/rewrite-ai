---
description: Add a new AI provider end to end. Usage: /add-provider <name>
argument-hint: <provider name or API docs URL>
---

Add support for: **$ARGUMENTS**

Delegate this to the `provider-adder` agent, which carries the full checklist and the reasons behind each step.

Before starting, gather what the provider's API actually requires — endpoint, auth header, request shape, streaming format, and how it reports errors. Use Context7 or the vendor's own documentation rather than assuming it matches OpenAI; the differences are exactly where the bugs live.

Do not copy an existing provider file wholesale. `src/ai/providers/base.ts` exists because the six original providers were near-identical copies that had drifted apart in ways that changed behaviour.

Finish with `pnpm verify`.
