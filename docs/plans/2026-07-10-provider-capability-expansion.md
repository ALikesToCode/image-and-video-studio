# Provider Capability Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make NanoGPT and Navy image/video generation catalog-driven, capability-safe, recoverable, and clear in the UI.

**Architecture:** Normalize each provider's live catalog into enriched `ModelOption` records. Keep provider-specific network and payload adapters behind server routes, use the live list as authoritative after successful discovery, and render settings from normalized capabilities. Preserve static entries only as offline fallbacks.

**Tech Stack:** Next.js 16 Edge routes, React 19 context/components, TypeScript, Node test runner, ESLint.

---

### Task 1: Normalize NanoGPT catalog metadata

**Files:**
- Create: `lib/nanogpt-media.ts`
- Create: `lib/nanogpt-media.test.ts`
- Modify: `lib/constants.ts`

**Steps:**
1. Write failing tests for image/video catalog envelopes, slash-containing IDs, architecture modalities, pricing, resolution/count/reference constraints, dynamic parameter descriptors/defaults, and malformed records.
2. Add serializable capability types to `ModelOption` and implement defensive catalog normalization.
3. Correct the static fallback limits for Qwen Image and Step Image Edit 2 and add a minimal NanoGPT video fallback.
4. Run `pnpm exec tsx --test lib/nanogpt-media.test.ts`, `pnpm run typecheck`, focused ESLint, and diff checks.
5. Commit only the normalizer, types, tests, and fallback corrections.

### Task 2: Add NanoGPT discovery and refresh

**Files:**
- Create: `app/api/nanogpt/models/route.ts`
- Create: `lib/server/nanogpt-models-route.test.ts`
- Modify: `app/contexts/StudioContext.tsx`
- Modify: `lib/constants.ts`

**Steps:**
1. Write route tests for image/video discovery, upstream errors, malformed JSON, and cache headers.
2. Proxy the two official public catalog endpoints and normalize their responses.
3. Add image/video NanoGPT model state, local-storage caching, loading/error/freshness state, and a real refresh action.
4. Replace fallback lists after a successful fetch; retain cached/static data on failure.
5. Verify focused tests, typecheck, ESLint, and staged diff, then commit this slice.

### Task 3: Use normalized NanoGPT image generation

**Files:**
- Modify: `app/api/nanogpt/image/route.ts`
- Modify: `lib/server/nanogpt-image-route.test.ts`
- Modify: `lib/nanogpt-media.ts`
- Modify: `lib/nanogpt-media.test.ts`
- Modify: `app/contexts/StudioContext.tsx`

**Steps:**
1. Write failing tests for `/api/v1/images`, `input_references`, model endpoint discovery, advertised parameter allowlisting, reference/output caps, response normalization, billing metadata, request IDs, and structured failures.
2. Build a normalized NanoGPT image request from the selected model's capability snapshot.
3. Retain the legacy OpenAI-compatible request shape only for legacy callers that explicitly request compatibility.
4. Preserve actual cost, payment source, remaining balance, and provider request ID in generated image metadata.
5. Verify and commit only the image transport/capability slice.

### Task 4: Add resumable NanoGPT video generation

**Files:**
- Create: `app/api/nanogpt/video/route.ts`
- Create: `lib/server/nanogpt-video-route.test.ts`
- Modify: `lib/nanogpt-media.ts`
- Modify: `lib/nanogpt-media.test.ts`
- Modify: `app/contexts/StudioContext.tsx`
- Modify: `lib/types.ts`

**Steps:**
1. Write failing tests for submit `202` responses, both documented status response shapes, terminal states, transient errors, `Retry-After`, and URL normalization.
2. Submit catalog-supported scalar parameters and media references to `/api/generate-video`.
3. Poll `/api/video/status`, normalize completed/failed/canceled states, and preserve billing/request metadata.
4. Persist `runId` in the existing job record and resume polling after reload.
5. Verify and commit the video lifecycle slice.

### Task 5: Correct Navy catalog capabilities and payloads

**Files:**
- Modify: `lib/studio-generation.ts`
- Modify: `lib/studio-generation.test.ts`
- Modify: `app/api/navy/models/route.ts`
- Modify: `app/api/navy/video/route.ts`
- Modify: `lib/server/media-download-routes.test.ts`
- Modify: `app/contexts/StudioContext.tsx`

**Steps:**
1. Add failing tests proving output-modalities-first grouping, Gemini Omni video placement, per-model reference caps, absence of stale fallback entries, GPT Image ratio-to-size behavior, omitted unsupported/default fields, and Veo resolution/seed forwarding.
2. Derive known Navy media capabilities conservatively from catalog modalities/descriptions and explicit corrections.
3. Replace lists after successful discovery and keep fallbacks only on discovery failure.
4. Reuse `resolveNavyJobPollDelayMs` for video polling.
5. Verify and commit the Navy correctness slice.

### Task 6: Surface Navy health and plan eligibility

**Files:**
- Create: `app/api/navy/model-status/route.ts`
- Create: `lib/server/navy-model-status-route.test.ts`
- Modify: `app/contexts/StudioContext.tsx`
- Modify: `lib/types.ts`
- Modify: `app/components/img-gen-settings.tsx`

**Steps:**
1. Write route/parser tests for the public status endpoint without retaining its large history arrays.
2. Join current health summaries to selected models.
3. Compare `requiredPlan` with the authenticated usage plan, disable known-ineligible models, and display the upgrade reason.
4. Show current status, uptime summary, multiplier, metadata source/status, and an expandable description.
5. Verify accessibility-focused component lint/type safety and commit this slice.

### Task 7: Render capability-driven settings

**Files:**
- Create: `app/components/model-capability-settings.tsx`
- Create: `lib/model-capability-settings.ts`
- Create: `lib/model-capability-settings.test.ts`
- Modify: `app/components/img-gen-settings.tsx`
- Modify: `app/contexts/StudioContext.tsx`

**Steps:**
1. Test dynamic defaults, select/switch/number/text coercion, conditional `showWhen`, and safe omission of unknown values.
2. Render supported resolution, output count, reference count, quality, duration, seed, and dynamic NanoGPT scalar controls.
3. Reset stale control values when the selected model changes and explain why unavailable controls are hidden.
4. Show explicit-currency price estimates and actual generation billing without guessing undocumented units.
5. Verify keyboard labels, disabled states, focused tests, typecheck, and ESLint; then commit.

### Task 8: Improve provider errors and final verification

**Files:**
- Modify: `lib/api-safety.ts`
- Modify: affected provider routes and focused tests
- Modify: `docs/provider-capabilities.md`

**Steps:**
1. Add failing tests for preserving safe `code`, `param`/`parameter`, request ID, retry delay, and provider guidance while redacting credentials.
2. Retry only documented transient statuses and produce actionable balance, plan, policy, validation, rate-limit, and expired-job messages.
3. Update the provider capability matrix with implemented behavior and explicit advanced-workflow gaps.
4. Run `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `git diff --check` without running build or dev.
5. Request an independent code review, address important findings, and verify the final repository status and commit history.
