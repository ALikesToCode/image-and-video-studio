# Testing

Use `pnpm`.

```bash
pnpm install
pnpm run typecheck
pnpm lint
pnpm test
```

`pnpm test` runs Node's test runner with `tsx` over `lib/**/*.test.ts`, including nested tests under `lib/client`, `lib/server`, `lib/providers`, and `lib/jobs`.

`pnpm verify` runs:

```bash
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
```

Codex sessions should not run `pnpm build`, `pnpm dev`, or `pnpm verify` unless the user explicitly asks, because this repo's instructions reserve build/dev execution for the user.

## Current Coverage

- API key storage modes and legacy key detection.
- Safe external media URL validation and bounded fetch behavior.
- Gemini and Navy video download route allowlist behavior.
- Provider capability filtering and dynamic merge behavior.
- Polling cancellation/backoff helpers.
- Existing chat tooling, image payload builders, model normalization, validation, and queue selection helpers.
