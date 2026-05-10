# Chat Embedding And Attachments

This app supports two separate embedding workflows:

- **Embed the Studio UI** in another page with an iframe.
- **Attach context to chat** so models can read images or extracted file text when their metadata advertises support.

## Embed URLs

Use `embed=1` to hide the Studio navigation chrome.

```html
<iframe
  src="https://YOUR_STUDIO_DOMAIN/?view=chat&embed=1"
  title="Studio chat"
  loading="lazy"
  allow="clipboard-read; clipboard-write; fullscreen"
  style="width: 100%; min-height: 720px; border: 0; border-radius: 12px;"
></iframe>
```

Supported `view` values:

- `chat`
- `image`
- `video`
- `audio`
- `gallery`

Use `fullscreen=1` with chat to open the chat surface in fullscreen mode:

```html
<iframe
  src="https://YOUR_STUDIO_DOMAIN/?view=chat&embed=1&fullscreen=1"
  title="Studio chat fullscreen"
  allow="clipboard-read; clipboard-write; fullscreen"
  style="width: 100%; min-height: 100dvh; border: 0;"
></iframe>
```

## Chat Attachments

The chat attachment button is enabled from model metadata:

- Image upload is available when the selected chat model advertises `image` input or `supportsVision`.
- PDF/text upload is available when the selected chat model advertises `file`, `document`, or `pdf` input.
- If metadata is unknown or does not include those inputs, the upload button is disabled instead of guessing.

Images are sent as OpenAI-compatible multimodal message parts:

```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "Describe this image." },
    {
      "type": "image_url",
      "image_url": { "url": "data:image/png;base64,..." }
    }
  ]
}
```

PDF and text files are extracted locally in the browser and sent as text context. This keeps the route compatible with providers that do not expose native file upload through chat completions.

## Limits

- Up to 6 pending attachments per chat turn.
- Images: 8 MB each.
- Text files: 2 MB each, trimmed to the chat extraction limit.
- PDFs: processed with the app's existing browser PDF extractor and trimmed to the chat extraction limit.

## Notes

- Attachments are not persisted to local chat history. They stay in the active browser session message only.
- Generated images, videos, and audio still use the existing generation tools and queues.
- Model input/output modality chips in the chat footer and model details dialog show why upload controls are available or disabled.
