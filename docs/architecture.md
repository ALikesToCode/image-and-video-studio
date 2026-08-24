# Architecture

## State Flow

`StudioContext` owns the local workspace state: active provider, mode, model selections, settings, queue, references, gallery assets, storage status, and provider keys. Views read and update that context directly.

Generation flow:

1. UI validates the prompt, key, provider, and mode.
2. A local `GenerationJob` is queued with the selected model/settings and selected reference IDs.
3. The queue processor starts image jobs concurrently and non-image jobs one at a time.
4. Client fetches call app API routes with provider keys in `x-user-api-key` where practical.
5. Route handlers build provider-specific payloads and proxy to Gemini, NavyAI, OpenRouter, or Chutes.
6. Returned media is converted to local blobs/data URLs for display and optional gallery save.

## IndexedDB Schema

Database: `studio-gallery`, version 2.

- `assets`: future asset metadata store.
- `assetBlobs`: binary blobs for images, video, audio, and references.
- `references`: reference metadata with blob keys and roles.
- `jobs`: lightweight resumable job records. API keys are not stored here.
- `conversations`: reserved for local chat/conversation persistence.
- `modelCatalogs`: reserved for local provider catalog caching.
- `settings`: reserved for settings migration out of `localStorage`.
- `images`: legacy blob store, retained for older gallery items.

`localStorage` still stores small user preferences, provider keys, model selections, gallery metadata cache, and selected reference IDs.

## Provider API Flow

- Gemini image models use `models/{model}:generateContent` with `contents.parts`, text first, then `inline_data` image references.
- Imagen models remain separate on `models/{model}:predict` with `instances` and `parameters`.
- Gemini Veo uses `models/{model}:predictLongRunning`, then operation polling and a validated Gemini download proxy.
- NavyAI native image/video requests use the OpenAI-compatible image generation endpoint. Catalog entries served through Chat Completions use an image-output chat payload instead. Async job IDs from the native generation endpoint are stored locally and polling can resume after refresh.
- OpenRouter image generation uses chat completions with `modalities` and optional multipart text-plus-image content.
- Chutes routes keep Chutes-specific payloads and settings isolated.

## Async Job Lifecycle

Async routes return a remote operation/job ID when the provider does not return media immediately.

- In-memory jobs keep the active API key only while the current tab is running.
- Persisted jobs store only job metadata and remote IDs.
- On refresh, jobs with pending remote IDs are restored as queued polling jobs if the matching browser-stored provider key still exists.
- Completed and failed jobs are removed from the persisted job store.

## Privacy and Security Model

- No app accounts, server database, telemetry, or server asset persistence.
- API keys are stored in the browser and sent to edge API routes only for the request being made.
- Route handlers sanitize provider error messages and avoid logging provider keys.
- Download proxy routes validate provider URLs before attaching auth headers.
- Local exports are generated in the browser and are not uploaded to the server.

## Compatibility Notes

The app targets Next.js App Router plus OpenNext Cloudflare edge routes. Route handlers avoid Node-only APIs so they can run in an edge-compatible runtime.
