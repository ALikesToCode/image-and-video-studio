# Provider Capabilities

The capability foundation lives in `lib/providers`. Static fallbacks are built from `lib/constants.ts`; dynamic model discovery is merged when providers expose catalog endpoints.

## Gemini

- Native Gemini image models support text-to-image and image/reference-assisted editing through `generateContent`.
- Imagen models use the separate `:predict` payload and text-only input.
- Veo 3.1 uses long-running operations, supports landscape/portrait, image/reference-assisted workflows, first/last frame payloads, native audio, and resolution constraints.

## NavyAI

- `/v1/models` is used for endpoint-compatible model catalogs and capability metadata. Nullable fields such as `context_window`, `max_output_tokens`, modalities, support flags, descriptions, pricing, `metadata_source`, and `metadata_status` must be preserved; `null` means unknown, not zero or false.
- `/v1/images/generations` is used for image and video jobs.
- Navy image generation accepts `image_url` as one string or an array of up to 5 reference images for multi-reference editing. Studio image mode and chat image tools should pass selected/user-provided references through that shape.
- `/v1/audio/speech` is used for TTS.
- `/v1/usage` can surface plan and rate-limit information near generation controls.

## OpenRouter

- Image generation uses Chat Completions with `modalities`.
- Model discovery uses `/api/v1/models?output_modalities=image`.
- Image inputs are sent as multipart chat message content with text first, then `image_url` entries.

## Chutes

- Chutes image, video, audio, and chat routes are separate provider adapters in the app API layer.
- Model-specific settings must be validated before request submission.
- Generated image URL downloads are bounded through safe media fetching.

## FAL

FAL currently remains partial. It should either be promoted into the provider registry with routes, UI selectors, pricing, and tests, or hidden from visible product flows until that is complete.
