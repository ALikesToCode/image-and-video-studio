# Provider capability expansion

## Summary

Make NanoGPT and Navy media support follow each provider's live catalog instead of a small, stale set of hard-coded assumptions. The studio should expose controls only when the selected model documents them, validate reference and output limits before sending data, preserve asynchronous jobs, and explain plan, pricing, metadata, and provider errors in the UI.

This design covers the app's image and video surfaces. It does not add unrelated text, speech, transcription, or subscription-management products. It also does not invent undocumented Navy webhook or upscale behavior.

## Current problems

- NanoGPT exposes a large, changing image and video catalog, while the app has five static image entries, no video route, and a refresh action that does nothing.
- The NanoGPT image route uses the legacy OpenAI-compatible endpoint and cannot enforce the live model's resolution, output-count, reference-count, or parameter contract.
- Navy model grouping guesses from IDs, so a video-output model can appear under images. Successful discovery is merged with stale fallback entries, and every media model is given the same five-reference capability.
- Global controls send values that some models reject or that override useful provider defaults. Examples include GPT Image aspect ratio and quality, and omitted Navy Veo resolution.
- Model cost, plan requirement, metadata confidence, health, generation billing, and useful structured provider errors are largely hidden.

## Considered approaches

### Expand static constants

Adding every current model to `constants.ts` would be simple, but both catalogs change independently of the app. It would immediately create another stale snapshot and cannot express NanoGPT's dynamic parameter schemas. This approach is rejected.

### Build a bespoke form and route for every model

Per-model adapters can be precise, but hundreds of models would create duplicated UI and brittle branching. It is appropriate only for advanced workflows whose input semantics cannot be represented generically. This approach is reserved for later endpoint-specific workflows.

### Normalize provider metadata and render supported controls

The selected approach introduces one internal media-capability model. Provider catalog adapters translate live metadata into that model; request adapters permit only normalized, advertised parameters. Static entries remain fallback data only. This makes newly listed models selectable without shipping a new hard-coded catalog while retaining provider-specific corrections where live metadata is ambiguous.

## Architecture

### Catalog layer

Server routes proxy public discovery endpoints and return normalized data with a short cache policy:

- NanoGPT image models from `/api/v1/images/models`
- NanoGPT video models from `/api/v1/video-models`
- Navy models from `/v1/models`
- Navy health from `/v1/models/status`

The normalized `ModelOption` carries supported resolutions, output limits, reference constraints, dynamic parameters/defaults, pricing, plan, token multiplier, metadata status/source, and health. On successful refresh, the returned provider/mode list replaces static fallbacks. If discovery fails, the last known list or static fallback remains available with a visible stale/error state.

### Generation layer

NanoGPT image requests use the normalized `/api/v1/images` route with `input_references`; the compatibility route remains available for JanitorAI/legacy consumers. NanoGPT videos submit to `/api/generate-video`, persist the returned `runId`, and poll `/api/video/status` until a normalized terminal state. Both adapters preserve request IDs and billing fields.

Navy continues using `/v1/images/generations`, but payload construction becomes capability-aware. Output modalities determine image/video grouping; per-model constraints cap references; GPT Image ratios map to `size`; omitted settings use provider defaults; video resolution and seed are forwarded; polling honors provider backoff.

### UI layer

The selected model drives a reusable capability section:

- hide unsupported controls and disable invalid actions before submission;
- render catalog-provided select, switch, numeric, and text parameters with defaults and conditional visibility;
- show reference/output limits, supported inputs, estimated price where units are explicit, actual billed cost, required plan, token multiplier, metadata confidence, health, and catalog freshness;
- show actionable authentication, balance, plan, validation, content-policy, retry, and expired-job errors;
- keep job IDs so interrupted video polling can resume.

Generic controls accept scalar values only. Inputs such as source video, audio, masks, avatars, or provider-specific extension indices become dedicated workflows because their upload and endpoint contracts differ materially.

## Data safety and validation

- API keys remain server-side request headers and are redacted from error text.
- Model IDs and remote job IDs are validated before they enter upstream URLs.
- Reference uploads use the smallest documented route/provider byte limit and advertised MIME/dimension constraints.
- Only transient 408, 429, 500, and 503 failures are retried; `Retry-After` is honored.
- Unknown or contradictory metadata is shown as such; the app does not invent pricing currency or unsupported controls.

## Verification

Each logical change starts with a focused failing test, then runs the smallest relevant Node test files, TypeScript checking, focused ESLint, staged-diff inspection, and `git diff --check`. Final verification runs the full test, typecheck, and lint suites. Build and dev commands are intentionally excluded per repository instructions.
