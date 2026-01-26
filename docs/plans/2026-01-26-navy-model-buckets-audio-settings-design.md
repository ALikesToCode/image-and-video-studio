# Navy model buckets + audio settings

## Summary
Add strict Navy model buckets for chat/image/video/audio, surface model refresh + selection in Audio/TTS, and keep video mode aligned so selectors match the current mode.

## Goals
- Keep chat model selector limited to chat models only.
- Ensure video mode uses video-only models.
- Add Audio/TTS settings sidebar with model selector + refresh.
- Preserve model lists by caching in local storage and refreshing from `/api/navy/models`.

## Non-goals
- Redesign the audio generation UI flow.
- Change provider APIs or request payloads.

## Approach
- Use `/api/navy/models` to fetch all models and bucket them into chat/image/video/audio.
- In chat view, filter Navy chat models by removing any IDs in image/video/audio buckets.
- In chat view, keep the image tool selector bound to the Navy image bucket.
- In video view, force `mode = "video"` on mount to avoid stale mode.
- In audio view, reuse `ImgGenSettings` in a left sidebar to expose model refresh and TTS controls.

## Data flow
- StudioContext refreshes Navy models and stores them in local storage.
- Chat view derives a filtered list for the chat selector and corrects invalid selections.
- Audio/Video views use the same settings component with the correct mode.

## Error handling
- If model refresh fails, show the error under the selector and keep last-known lists.

## Testing
- Open Chat: verify only chat models show in the selector; image tool lists only image models.
- Open Video: verify only video models appear after switching to Video tab.
- Open Audio/TTS: verify left sidebar appears with model selector + refresh.
- Run `npm run lint`.
