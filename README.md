# Image & Video Studio

Local-first studio for generating images and short videos with Gemini and NavyAI. The UI stores API keys and the image gallery in `localStorage`, so nothing is persisted on the server.

## Features

- Gemini image models (Gemini Native Image + Imagen 4) and Veo 3.1 video models
- NavyAI image and video generation (OpenAI-style endpoints)
- NavyAI text-to-speech (TTS) with voice selection
- OpenRouter image generation via chat completions + modalities
- Chutes Z Image Turbo endpoint support
- Local gallery with one-click wipe
- Edge-safe API routes for Cloudflare Workers

## Running locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000` and add your API key in the UI (Gemini, NavyAI, OpenRouter, or Chutes).

## Deploying to Cloudflare Workers

This project uses Next.js App Router with edge runtime API routes, so it is compatible with Cloudflare Workers / Pages.

1. Build with the Cloudflare adapter:

```bash
npx @cloudflare/next-on-pages@latest
```

2. Deploy the output in `.vercel/output/static` and `.vercel/output/functions` using Wrangler or Cloudflare Pages.

If you prefer Workers-only deployments, you can also wrap the output with the Next-on-Pages worker as documented here: https://developers.cloudflare.com/pages/framework-guides/nextjs/

## Notes

- API keys are stored in your browser only. Use the **Forget key** button to remove them.
- Images are stored in `localStorage` and capped to the latest 12 items to avoid quota issues.
- Video generations are not stored locally; use the download link if you want to keep them.
- OpenRouter image generation uses `chat/completions` with `modalities: ["image", "text"]`.
