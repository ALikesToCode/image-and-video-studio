import test from "node:test";
import assert from "node:assert/strict";

import {
  collectUnsafeChatMediaAssets,
  sanitizeChatAttachmentAssets,
  sanitizeChatImageAssets,
  sanitizeChatMediaAssets,
  stripHeavyMediaFromMessagesForStorage,
} from "./chat-media-persistence.ts";

test("Chat image assets preserve per-image model labels", () => {
  assert.deepEqual(
    sanitizeChatImageAssets([
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "gpt-image-1.5",
        provider: "nanogpt",
      },
    ]),
    [
      {
        id: "img-1",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "gpt-image-1.5",
        provider: "nanogpt",
      },
    ]
  );
});

test("Chat media assets preserve per-image model labels", () => {
  assert.deepEqual(
    sanitizeChatMediaAssets([
      {
        id: "img-1",
        kind: "image",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "flux",
      },
    ]),
    [
      {
        id: "img-1",
        kind: "image",
        dataUrl: "data:image/png;base64,abc",
        mimeType: "image/png",
        model: "flux",
      },
    ]
  );
});

test("restored chat media rejects unsafe, stale, and mismatched URLs", () => {
  const safeVideo = {
    id: "safe-video",
    kind: "video",
    dataUrl: "https://media.example/video.mp4",
    mimeType: "video/mp4",
  };
  const unsafeMedia = [
    {
      id: "file-video",
      kind: "video",
      dataUrl: "file:///home/user/video.mp4",
      mimeType: "video/mp4",
    },
    {
      id: "script-audio",
      kind: "audio",
      dataUrl: "javascript:alert(1)",
      mimeType: "audio/mpeg",
    },
    {
      id: "stale-blob",
      kind: "image",
      dataUrl: "blob:https://studio.example/stale",
      mimeType: "image/png",
    },
    {
      id: "wrong-data-kind",
      kind: "video",
      dataUrl: "data:image/png;base64,YWJj",
      mimeType: "video/mp4",
    },
  ];

  assert.deepEqual(sanitizeChatMediaAssets([safeVideo, ...unsafeMedia]), [
    safeVideo,
  ]);
  assert.deepEqual(
    collectUnsafeChatMediaAssets([
      {
        id: "message-1",
        media: unsafeMedia,
      },
    ]),
    unsafeMedia.map((asset) => ({
      messageId: "message-1",
      field: "media",
      asset,
    }))
  );
});

test("restored chat images and attachments reject unsafe URLs", () => {
  const unsafeImage = {
    id: "unsafe-image",
    dataUrl: "file:///home/user/image.png",
    mimeType: "image/png",
  };
  const unsafeAttachment = {
    id: "unsafe-attachment",
    kind: "image",
    name: "image.png",
    dataUrl: "javascript:alert(1)",
    mimeType: "image/png",
  };

  assert.deepEqual(sanitizeChatImageAssets([unsafeImage]), []);
  assert.deepEqual(sanitizeChatAttachmentAssets([unsafeAttachment]), []);
});

test("Persisted chat history drops heavy media payloads and keeps newest entries", () => {
  const stored = stripHeavyMediaFromMessagesForStorage(
    [
      {
        id: "old",
        role: "assistant",
        content: "Old",
        media: [{ id: "m-old", kind: "image", dataUrl: "data:image/png;base64,old" }],
      },
      {
        id: "new",
        role: "tool",
        content: "Generated image.",
        images: [{ id: "img-1", dataUrl: "data:image/png;base64,new" }],
        attachments: [
          {
            id: "att-1",
            kind: "image",
            name: "source.png",
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,source",
          },
        ],
      },
    ],
    1
  );

  assert.deepEqual(stored, [
    {
      id: "new",
      role: "tool",
      content: "Generated image.",
    },
  ]);
});
