# Security Notes

## Local-First Boundary

Image & Video Studio has no server database and does not persist API keys, prompts, generated media, chat history, or usage data on the server. API routes only proxy provider requests and bounded media downloads.

## API Key Storage

Settings supports three key storage modes:

- `session`: default. Keys are stored in `sessionStorage` and cleared by the browser when the session ends.
- `manual`: keys stay only in React memory and are forgotten on reload.
- `persistent`: opt-in. Keys are stored in `localStorage` and survive browser restarts.

Persistent mode is explicitly warned because `localStorage` is readable by scripts running on the same origin and persists across sessions. Old `studio_api_key_*` keys are not silently reused; the Settings dialog shows a migration prompt so the user can migrate or discard them.

## API Transport

Client requests send user keys to internal API routes through `x-user-api-key` headers where practical. Routes keep a compatibility fallback for older body payloads, but new client code should not put API keys into JSON job payloads.

Provider errors are normalized and redacted before being returned to the UI. Keys must not be logged.

## Safe Media Fetching

Server-side media downloads use `safeFetchExternalMedia` from `lib/server/safe-fetch.ts`.

The helper enforces:

- valid URL parsing
- `https:` only
- explicit provider host allowlists
- localhost/private IP literal rejection
- no URL credentials
- bounded redirects
- content type prefixes such as `image/`, `video/`, or `audio/`
- `Content-Length` and streamed byte limits
- request timeout with `AbortController`

User authorization headers are only attached to hosts explicitly trusted for that provider.

## Security Headers

`next.config.ts` sets:

- Content Security Policy with `frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` disabling unused sensitive browser APIs
- HSTS in production HTTPS builds only

The CSP allows `blob:` and `data:` for media previews because local IndexedDB blobs are surfaced through object URLs and some providers return base64 media.
