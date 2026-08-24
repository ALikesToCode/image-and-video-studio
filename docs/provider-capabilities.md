# Provider Capabilities

Last verified against the provider documentation, live model catalog, and application routes on 2026-08-24.

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
- Image discovery follows the endpoint and output modalities declared by each live model. Native image/video models use `POST /v1/images/generations`; chat models that declare image output remain in the chat catalog and are also exposed in the image catalog through `POST /v1/chat/completions` with `modalities` and `image_config`.
- The native image request builder sends only model-compatible fields, including `size`/`aspect_ratio`, `image_url`, `negative_prompt`, `seed`, documented quality, DALL-E-only style, video seconds, response format, and async `sync: false` when a job handle is needed. Chat-image requests use multipart message content with text first and preserve the model's declared text/image output modalities.
- Compatible editing models accept one reference or an array of at most five references. Native NavyAI image generation does not use `n`; chat-image models receive a bounded OpenAI-compatible `n` only when more than one image is requested.
- Async image and video results are polled through `GET /v1/images/generations/:id`. Active remote handles can be restored after a refresh when the matching provider key is available. Rate limits remain pending and honor `Retry-After`.
- Generated media downloads are performed server-side through bounded host/content-type/size checks. Provider credentials are attached only to trusted NavyAI media hosts.
- NavyAI chat supports the app's AI SDK tool loop for image, video, and speech tools. OpenAI-family text models use `POST /v1/responses`, including Responses-native tool calls, reasoning controls, and typed SSE text events; other model families remain on `POST /v1/chat/completions`. Vision uploads and tool availability are gated by normalized model metadata.

### Explicit gaps

- The UI does not expose dedicated raw NavyAI Messages or Responses request builders, embeddings, moderation, or speech-to-text workflows. Responses transport is selected automatically for OpenAI-family chat models.
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

## MultiLLM Proxy

- Unified text discovery uses `GET /v1/models`. The Studio retains MultiLLM's safe Navy metadata, including provider endpoint/owner, plan gate, multiplier, nullable limits, modalities, capability flags, description, pricing, and metadata provenance. OpenAI-family chat models use `POST /v1/responses` with the catalog's `provider:model` IDs; LinkAPI models use its provider-specific `/linkapi/v1/responses` path. Other model families continue to use the OpenAI-compatible `POST /v1/chat/completions` stream.
- NavyAI media discovery uses `GET /navyai/v1/models`. Both native image-generation entries and chat-completion entries declaring image output are source-tagged and routed to their catalog-declared transport. Gemini image model IDs remain on the chat-image transport if cached client metadata is missing. NanoGPT image and video discovery use `GET /nanogpt/v1/image-models` and `GET /nanogpt/v1/video-models`.
- The studio source-tags media IDs as `navyai:model` or `nanogpt:model`. The tag is removed before forwarding the request and is retained locally only to select the correct provider-specific proxy route.
- Native NavyAI image generation uses the raw `POST /navyai/v1/images/generations` contract with a raw model ID. It omits unsupported `n`, advertises one fixed output, keeps aspect ratios separate from pixel sizes, and submits at most once so an ambiguous timeout cannot duplicate a paid render. Gemini image models use `POST /navyai/v1/chat/completions` with image output modalities. Both transports normalize URL, base64, binary, and asynchronous NavyAI job responses.
- Reference images are limited to five validated HTTPS or image `data:` URLs. Hosted image downloads use bounded HTTPS/content-type/size validation. Provider failures preserve redacted error codes, parameters, request IDs, retry delays, and safe guidance for actionable UI diagnostics.
- NavyAI and NanoGPT video submissions are polled by job ID until a terminal state. Processing jobs are never automatically resubmitted. Completed job downloads are re-resolved server-side and bounded before reaching the browser.
- Audio generation uses the provider-specific OpenAI-compatible speech endpoint and streams the returned audio body without buffering it in application state.
- `MULTILLM_API_KEY` can remain a server-side environment secret. A browser-held key is also supported through the same key-storage modes as the direct providers. `PROXY_BASE_URL` or `MULTILLM_PROXY_BASE_URL` can override the default deployment origin.

## NanoGPT

### Implemented

- Image discovery uses `GET /api/v1/images/models`; video discovery uses `GET /api/v1/video-models`. The adapters normalize model IDs, modalities, reference/source requirements, supported resolutions, output limits, dynamic scalar parameters/defaults, conditional controls, and pricing. Static entries remain fallback data when discovery fails.
- Image generation uses the normalized `POST /api/v1/images` endpoint. The proxy bounds output/reference counts against the validated request capability snapshot and global route limits, then forwards documented `resolution`, `aspect_ratio`, `quality`, `output_format`, `seed`, and `input_references`. The legacy `/v1/images/generations` shape is available only through an explicit compatibility mode.
- Image responses normalize hosted URLs and base64 data, billing metadata, and request IDs. Chat image tools select the NanoGPT key when a NanoGPT image model is chosen, independently of the text-chat provider.
- Video generation submits asynchronous work to `POST /api/generate-video`, stores the returned NanoGPT job ID, and polls the unified `GET /api/video/status?requestId=...` endpoint. Catalog-derived scalar controls and validated direct image/video/audio sources and reference lists are forwarded.
- Completed videos are downloaded only after the server re-resolves the job status. The caller cannot supply an arbitrary download URL; external media fetches enforce HTTPS, redirect, content-type, and size bounds.
- In-flight NanoGPT jobs can be restored after refresh when the matching provider key is available. Poll responses retain progress, time estimates, timestamps, model, billing metadata, provider request IDs, terminal guidance, and retry delays where supplied.
- `GET /api/v1/usage`, `POST /api/check-balance`, and `GET /api/subscription/v1/usage` are aggregated into one no-store account response. Core usage/balance failures remain fatal; an unavailable optional subscription section becomes a warning.
- NanoGPT image and video models are available to the chat tool loop with provider-aware API-key routing.
- Text-chat discovery uses `GET /api/v1/models?detailed=true`: authenticated requests use the account-specific favorites order without shared caching, while unauthenticated discovery uses the public most-used order with short caching. The bounded adapter retains context/output limits, architecture modalities, image/audio/video/PDF input flags, reasoning and tool support, cache pricing, provider routes, and subscription token multipliers from the current catalog.
- NanoGPT text chat runs through the AI SDK OpenAI-compatible adapter at `/api/v1/chat/completions`. The server owns and allowlists tool schemas, streams text/reasoning and usage metadata, handles multiple media tool calls returned in one turn, gates tool availability from model metadata, and round-trips Gemini thought signatures across tool turns.

### Explicit gaps

- Midjourney's task-based `POST /api/generate-video/extend` flow (`runId`/`taskId` plus result index) is not exposed.
- Recent-run recovery through `GET /api/generate-video/recover` and the Sora content proxy through `GET /api/generate-video/content` are not exposed.
- Conversation-linked generations, library attachment IDs, and nested LongStories `storyConfig` payloads are not implemented. The current generic video adapter intentionally accepts direct media plus safe scalar catalog controls, not arbitrary nested objects.
- Accountless x402 payments, explicit provider routing/billing overrides, and team-context headers are not exposed in the studio UI.
- Dedicated controls for model suffix composition, context memory, prompt-caching boundaries, service tiers, and `billing_mode` are not exposed. Exact catalog model IDs still work, but the studio does not invent or silently append routing suffixes.
- Dynamic controls support safe scalar select, boolean, number, and text values. Provider workflows requiring structured/nested parameter editors need a dedicated implementation rather than being forwarded generically.

Official references: [text models](https://docs.nano-gpt.com/api-reference/endpoint/models), [chat completions](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion), [Image API guide](https://docs.nano-gpt.com/api-reference/image-generation), [normalized image generation endpoint](https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate), [video generation](https://docs.nano-gpt.com/api-reference/endpoint/video-generation), [video status](https://docs.nano-gpt.com/api-reference/endpoint/video-status-unified), [error handling](https://docs.nano-gpt.com/api-reference/miscellaneous/error-handling), [balance](https://docs.nano-gpt.com/api-reference/endpoint/check-balance), and [subscription usage](https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage).

## FAL

FAL remains partial. It should either be promoted into the provider registry with routes, UI selectors, pricing, and tests, or hidden from visible product flows until that work is complete.
