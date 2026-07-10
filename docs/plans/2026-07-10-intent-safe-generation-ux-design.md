# Intent-safe generation UX

## Summary

Make chat generation deliberate and visible, then make the image workspace feel like a usable creative control desk instead of a prompt box above anonymous square outputs.

The app should let the AI SDK resolve automatic tool use from the full conversation instead of converting loose phrase matches into irrevocable generation commands. Requests to write or improve prompts, explain image generation, compare models, brainstorm ideas, or answer capability questions must not be locally forced into generation. Every turn also gets a visible override so the user can choose deterministic chat or media creation before sending.

## Current problems

- Chat uses a global bag-of-words match. Any creation verb plus any media noun can force generation, while the word `now` alone is treated as a creation signal.
- Once that match fires, the selected tool is forced and a synthetic tool call runs even when the model does not call it. The model therefore cannot recover from a false positive.
- The composer does not reveal whether Send will answer in chat or start a potentially slow or paid generation.
- Queued chat turns preserve text and attachments, but not the user's intended action.
- The image workspace disables its generation button while a job is active even though the generation layer supports queued jobs.
- Image results hide their useful actions, open a raw data URL in another tab, and do not expose the prompt as a reusable input.

## Considered approaches

### Tighten the existing regular expression

More exclusions would reduce today's false positives, but intent would remain hidden and each new phrasing would add another edge case. This is useful as one layer, not as the whole interaction.

### Classify every turn with another model call

A structured classifier could understand more phrasing, but it adds latency and provider cost before every message and is still probabilistic. It also makes the action difficult to explain before the call completes.

### AI SDK auto tool choice with a visible override

The selected approach removes local phrase-based forcing. The composer exposes `Auto`, `Chat`, and the available media actions. `Auto` sends the available tools with AI SDK `toolChoice: "auto"`, preserving the conversation, attachments, and the model's ability to choose multiple tools or no tool. `Chat` sends no media tools. A manually selected medium forces only that tool and is the only path allowed to synthesize a fallback call. Queued turns snapshot the selected mode.

This keeps the common path fast, makes mistakes reversible, eliminates context-blind forced calls, and reserves synthetic fallback calls for explicit generation requests.

## Chat behavior

- `Auto` makes all enabled media tools available with AI SDK automatic tool choice; no tool is locally forced and no synthetic fallback is allowed.
- Tool descriptions and the runtime system prompt tell the model not to call generation for negated requests, capability questions, prompt-writing/editing, explanations, comparisons, or brainstorming.
- `Chat` sends no generation tools for that turn.
- An explicit media mode forces exactly that tool on the first step. If a model does not support tool calling, the existing local fallback may execute because the user explicitly selected the action.
- The selected behavior and a short explanation appear beside the composer before submission.
- Each queued turn stores its mode so later input changes cannot alter it.

The installed AI SDK supports `toolChoice: "none"` and `activeTools`; this app's existing transport already omits tools when `allowTools` is false. The change therefore uses the established request path rather than adding a second agent or classifier call.

## Image workspace behavior

- Show a compact generation recipe with provider, model, output count, size/aspect, pipeline state, and selected references.
- Keep Generate enabled while other jobs run and label it `Add to queue`.
- Provide several high-quality starter prompts only in the empty state; choosing one fills the editor without starting a request.
- Give each result a stable visible footer with model, prompt summary, Preview, Download, and Reuse prompt actions.
- Reuse the shared responsive media viewer instead of opening a raw data URL.
- Keep errors adjacent to the composer with `role="alert"`, preserve 44-pixel touch targets, visible focus, responsive wrapping, and reduced-motion-safe transitions.

## Verification

Start with focused intent tests that reproduce current false positives and verify direct image, video, and audio requests. Then run the intent test file, TypeScript checking, focused lint, the full test suite, and the production build. Finally exercise desktop and mobile chat/image flows with the system CloakBrowser-backed Playwright setup before pushing and verifying the deployment.
