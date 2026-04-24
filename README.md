# Image & Video Studio

Browser-based local-first workspace for image, video, audio/TTS, and chat-assisted media creation. The app is BYOK: provider API keys are entered in the UI and stored in the browser.

## Privacy model

- API keys are stored in browser `localStorage` so they survive refreshes on the same device.
- Generated media, uploaded references, and resumable provider job metadata are stored locally in browser storage.
- App API routes proxy provider requests for CORS, streaming, and media download compatibility.
- The server/edge runtime does not persist API keys, generated assets, chat history, or user accounts.
- Provider calls still leave your browser and go through the configured edge route to the selected provider.

## Features

- Gemini image generation/editing through Gemini native image models, plus Imagen via its separate `:predict` payload.
- Gemini Veo 3.1 text-to-video and image/reference-assisted video workflows.
- NavyAI image, video, chat, usage, model catalog, and TTS support.
- OpenRouter image-capable chat completion models with output modality discovery.
- Chutes image, video, audio, and chat support with provider-specific settings isolated.
- Local reference strip for source images, style, character, product/object, first-frame, and last-frame references.
- Local asset library with search, media filters, sorting, delete, clear, prompt copy, download, and JSON export.
- Local storage status panel with quota estimate and persistent-storage request.

## Local storage architecture

- `localStorage` keeps small settings, provider keys, selected model IDs, and lightweight metadata caches.
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

## Provider setup

Open Settings in the app and add keys for the providers you want to use:

- Gemini API key
- NavyAI API key
- OpenRouter API key
- Chutes API key

Keys are sent to app API routes with `x-user-api-key` where practical. Route handlers also keep backward-compatible body-key fallback for older local state, sanitize provider errors, and avoid logging keys.

## Running locally

```bash
pnpm install
pnpm test
pnpm lint
pnpm build
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

- `npm test` runs Node's test runner with `tsx` so `lib/*.test.ts` files are actually loaded.
- `npm run lint` runs ESLint.
- `npm run build` runs the Next.js production build.

## Known limitations

- Provider-hosted video URLs can expire; download generated videos into the local gallery promptly.
- JSON gallery export is local-only and includes data URLs; large exports can be big.
- Browser storage quota and persistent-storage behavior vary by browser and private browsing mode.
- Resumable polling depends on the provider returning a stable remote job or operation ID and the matching browser-stored API key still being present.
