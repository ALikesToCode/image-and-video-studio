# Provider Capabilities

Last verified against the provider documentation and the application routes on 2026-07-10.

The capability foundation lives in `lib/providers`. Static entries in `lib/constants.ts` are fallbacks; provider catalogs replace or enrich them when live discovery succeeds. Unknown catalog values remain `null` or absent and are never treated as zero or `false`.

## Provider error contract

NanoGPT and NavyAI catalog, account, and media proxy failures keep the user-safe parts of the provider response:

- `error`: redacted human-readable message;
- `code`: validated provider code or error type;
- `parameter`: normalized from provider `param` or `parameter`;
- `requestId`: validated body ID or `X-Request-ID` response header;
- `retryAfterMs`: validated body delay or `Retry-After` response header;
- `guidance`: redacted provider `userFriendlyError`, guidance, hint, suggestion, or refund message.

Credential values are redacted before errors reach the browser. Unknown nested fields, stacks, and unsafe identifiers are not copied. A retry hint is metadata, not permission to retry validation, authentication, balance, policy, or plan failures. NanoGPT documents transient retry for `408`, `429`, `500`, and `503`; polling routes respect rate-limit delays without marking an active job failed.

## Gemini

- Native Gemini image models support text-to-image and image/reference-assisted editing through `generateContent`.
- Imagen models use the separate `:predict` payload and text-only input.
- Veo 3.1 uses long-running operations, supports landscape/portrait, image/reference-assisted workflows, first/last frame payloads, native audio, and resolution constraints.

## NavyAI

### Implemented

- `GET /v1/models` is the live source for endpoint compatibility, model identity, plan requirements, token multipliers, nullable limits, capability flags, modalities, descriptions, pricing, and metadata provenance. The app groups the catalog into chat, image, video, and speech choices while retaining `null` as unknown.
- `GET /v1/models/status` feeds a compact, cached media-health view. The proxy accepts only validated model IDs and exposes current status, last check, in-progress state, uptime/check counts, latency summaries, and a redacted last error; provider history arrays are intentionally omitted.
- `GET /v1/usage` supplies account usage for the generation and chat-tool surfaces. It refreshes while NavyAI is the active provider, after media tools, and on explicit user refresh.
- `POST /v1/images/generations` handles both images and videos. The request builder sends only model-compatible fields, including `size`/`aspect_ratio`, `image_url`, `negative_prompt`, `seed`, documented quality, DALL-E-only style, video seconds, response format, and async `sync: false` when a job handle is needed.
- Compatible editing models accept one reference or an array of at most five references. NavyAI does not support `n`; the app treats each provider request as one output.
- Async image and video results are polled through `GET /v1/images/generations/:id`. Active remote handles can be restored after a refresh when the matching provider key is available. Rate limits remain pending and honor `Retry-After`.
- Generated media downloads are performed server-side through bounded host/content-type/size checks. Provider credentials are attached only to trusted NavyAI media hosts.
- NavyAI chat supports the app's AI SDK tool loop for image, video, and speech tools. Vision uploads and tool availability are gated by normalized model metadata.

### Explicit gaps

- The UI does not expose dedicated NavyAI Messages, Responses, embeddings, moderation, or speech-to-text workflows, even though the public API documents those endpoints.
- Model status is a compact current-health summary, not a provider-history dashboard or alerting system.
- Usage remains a current account snapshot; the app does not implement historical spend charts, configurable limit alerts, or plan management.

Official references: [overview](https://api.navy/docs), [models](https://api.navy/docs/models), [image and video generation](https://api.navy/docs/image-generation), [job polling](https://api.navy/docs/job-polling), and [usage](https://api.navy/docs/usage-statistics).

## OpenRouter

- Image generation uses Chat Completions with `modalities`.
- Model discovery uses `/api/v1/models?output_modalities=image`.
- Image inputs are sent as multipart chat message content with text first, then `image_url` entries.

## Chutes

- Chutes image, video, audio, and chat routes are separate provider adapters in the app API layer.
- Model-specific settings are validated before request submission.
- Generated image URL downloads are bounded through safe media fetching.

## NanoGPT

### Implemented

- Image discovery uses `GET /api/v1/images/models`; video discovery uses `GET /api/v1/video-models`. The adapters normalize model IDs, modalities, reference/source requirements, supported resolutions, output limits, dynamic scalar parameters/defaults, conditional controls, and pricing. Static entries remain fallback data when discovery fails.
- Image generation uses the normalized `POST /api/v1/images` endpoint. The proxy clamps output/reference counts to the selected capability snapshot and forwards documented `resolution`, `aspect_ratio`, `quality`, `output_format`, `seed`, and `input_references`. The legacy `/v1/images/generations` shape is available only through an explicit compatibility mode.
- Image responses normalize hosted URLs and base64 data, billing metadata, and request IDs. Chat image tools select the NanoGPT key when a NanoGPT image model is chosen, independently of the text-chat provider.
- Video generation submits asynchronous work to `POST /api/generate-video`, stores the returned NanoGPT job ID, and polls the unified `GET /api/video/status?requestId=...` endpoint. Catalog-derived scalar controls and validated direct image/video/audio sources and reference lists are forwarded.
- Completed videos are downloaded only after the server re-resolves the job status. The caller cannot supply an arbitrary download URL; external media fetches enforce HTTPS, redirect, content-type, and size bounds.
- In-flight NanoGPT jobs can be restored after refresh when the matching provider key is available. Poll responses retain progress, time estimates, timestamps, model, billing metadata, provider request IDs, terminal guidance, and retry delays where supplied.
- `GET /api/v1/usage`, `POST /api/check-balance`, and `GET /api/subscription/v1/usage` are aggregated into one no-store account response. Core usage/balance failures remain fatal; an unavailable optional subscription section becomes a warning.
- NanoGPT image and video models are available to the chat tool loop with provider-aware API-key routing.

### Explicit gaps

- Midjourney's task-based `POST /api/generate-video/extend` flow (`runId`/`taskId` plus result index) is not exposed.
- Recent-run recovery through `GET /api/generate-video/recover` and the Sora content proxy through `GET /api/generate-video/content` are not exposed.
- Conversation-linked generations, library attachment IDs, and nested LongStories `storyConfig` payloads are not implemented. The current generic video adapter intentionally accepts direct media plus safe scalar catalog controls, not arbitrary nested objects.
- Accountless x402 payments, explicit provider routing/billing overrides, and team-context headers are not exposed in the studio UI.
- Dynamic controls support safe scalar select, boolean, number, and text values. Provider workflows requiring structured/nested parameter editors need a dedicated implementation rather than being forwarded generically.

Official references: [Image API guide](https://docs.nano-gpt.com/api-reference/image-generation), [normalized image generation endpoint](https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate), [video generation](https://docs.nano-gpt.com/api-reference/endpoint/video-generation), [video status](https://docs.nano-gpt.com/api-reference/endpoint/video-status-unified), [error handling](https://docs.nano-gpt.com/api-reference/miscellaneous/error-handling), [balance](https://docs.nano-gpt.com/api-reference/endpoint/check-balance), and [subscription usage](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage).

## FAL

FAL remains partial. It should either be promoted into the provider registry with routes, UI selectors, pricing, and tests, or hidden from visible product flows until that work is complete.
