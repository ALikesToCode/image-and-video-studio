# Image & Video Studio

Browser-based local-first workspace for image, video, audio/TTS, and chat-assisted media creation. The app supports browser-held provider keys and an optional server-side MultiLLM Proxy key.

## Privacy model

- API keys default to `sessionStorage`, can be kept in memory-only manual mode, and can be persisted in `localStorage` only by explicit opt-in.
- Generated media, uploaded references, and resumable provider job metadata are stored locally in browser storage, primarily IndexedDB.
- App API routes proxy provider requests for CORS, streaming, and media download compatibility.
- The server/edge runtime does not persist API keys, generated assets, chat history, or user accounts. Deployments may inject the MultiLLM Proxy key as an environment secret.
- Provider calls still leave your browser and go through the configured edge route to the selected provider.

## Features

- Gemini image generation/editing through Gemini native image models, plus Imagen via its separate `:predict` payload.
- Gemini Veo 3.1 text-to-video and image/reference-assisted video workflows.
- NavyAI image, video, chat, usage, model catalog, and TTS support, including image-output models served through either native image generation or Chat Completions.
- Chat attachments for advertised image/file-capable models, plus iframe embedding for chat and generation views.
- OpenRouter image-capable chat completion models with output modality discovery.
- Chutes image, video, audio, and chat support with provider-specific settings isolated.
- NanoGPT image generation/editing support for HiDream, Chroma, Z Image Turbo, Qwen Image, and Step Image Edit 2.
- MultiLLM Proxy chat routing plus NavyAI/NanoGPT/LinkAPI image, asynchronous video, and NavyAI audio generation through one base URL and credential.
- Local reference strip for source images, style, character, product/object, first-frame, and last-frame references.
- Local asset library with search, media filters, sorting, delete, clear, prompt copy, download, and JSON export.
- Local storage status panel with quota estimate and persistent-storage request.

## Local storage architecture

- `localStorage` keeps small settings, selected model IDs, lightweight metadata caches, and API keys only when persistent key storage is explicitly selected.
- `sessionStorage` is the default API key storage mode.
- IndexedDB stores blobs, references, resumable jobs, and versioned stores:
  - `assets`
  - `assetBlobs`
  - `references`
  - `jobs`
  - `conversations`
  - `modelCatalogs`
  - `settings`
- Legacy gallery blobs from the old `images` object store are still read during migration.
- Heavy chat media payloads are stripped before chat history is stored.

See [Chat Embedding And Attachments](docs/chat-embedding.md) for iframe snippets, fullscreen chat URLs, and attachment behavior.

## Provider setup

Open Settings in the app and add keys for the providers you want to use:

- Gemini API key
- NavyAI API key
- OpenRouter API key
- Chutes API key
- NanoGPT API key
- MultiLLM Proxy API key (optional when `MULTILLM_API_KEY` is configured on the server)

Keys are sent to app API routes with `x-user-api-key` where practical. Route handlers also keep backward-compatible body-key fallback for older local state, sanitize provider errors, and avoid logging keys. Old `studio_api_key_*` localStorage keys are detected in Settings and must be explicitly migrated or discarded.

For server-side MultiLLM authentication, copy `.env.example` to `.env.local` and set:

```bash
PROXY_BASE_URL=https://multillm-proxy.cserules.workers.dev
MULTILLM_API_KEY=your-proxy-key
```

Unified chat catalog entries keep their `provider:model` IDs and retain safe upstream model details supplied by MultiLLM. LinkAPI chat models use the same convention and are routed through the provider-specific proxy endpoint; the chat fallback catalog includes `linkapi:gpt-5.6-luna`. Media catalogs are source-tagged in the UI as `navyai:model`, `nanogpt:model`, or `linkapi:model` so the app can select the correct provider-specific route while using the same proxy credential. Navy image models follow the endpoint declared in the live catalog, including chat models with image output. The image fallback catalog includes `linkapi:gpt-image-2-c`.

## Running locally

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm lint
```

For development, run:

```bash
pnpm dev
```

Open `http://localhost:3000` and add provider keys in Settings.

## Deploying to Cloudflare Workers

This project deploys to Cloudflare Workers through the OpenNext Cloudflare adapter.

```bash
pnpm preview
pnpm deploy
```

The Worker entrypoint and assets output are configured in `wrangler.jsonc`. OpenNext configuration lives in `open-next.config.ts`.

## Tests and checks

- `pnpm run typecheck` runs TypeScript without emit.
- `pnpm test` runs Node's test runner with `tsx` so nested `lib/**/*.test.ts` files are loaded.
- `pnpm lint` runs ESLint.
- `pnpm build` runs the Next.js production build.
- `pnpm verify` runs typecheck, lint, tests, and build. In Codex sessions, build/dev are not run unless you explicitly ask.

## Known limitations

- Provider-hosted video URLs can expire; download generated videos into the local gallery promptly.
- JSON gallery export is local-only and includes data URLs; large exports can be big.
- Browser storage quota and persistent-storage behavior vary by browser and private browsing mode.
- Resumable polling depends on the provider returning a stable remote job or operation ID and either the matching browser-stored key or the server-side MultiLLM key still being available.
