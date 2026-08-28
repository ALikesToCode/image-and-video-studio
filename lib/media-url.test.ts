import test from "node:test";
import assert from "node:assert/strict";

import { normalizeInlineMediaData, sanitizeMediaUrl } from "./media-url.ts";

test("media URLs allow HTTPS and media-kind data URLs", () => {
  assert.equal(
    sanitizeMediaUrl(" https://media.example/video.mp4 ", { kind: "video" }),
    "https://media.example/video.mp4"
  );
  assert.equal(
    sanitizeMediaUrl("data:image/png;base64,YWJj", { kind: "image" }),
    "data:image/png;base64,YWJj"
  );
  assert.equal(
    sanitizeMediaUrl("data:audio/mpeg;base64,YWJj", { kind: "audio" }),
    "data:audio/mpeg;base64,YWJj"
  );
});

test("media URLs reject unsafe schemes, credentials, and mismatched data", () => {
  for (const value of [
    "file:///home/user/video.mp4",
    "javascript:alert(1)",
    "http://media.example/video.mp4",
    "ftp://media.example/video.mp4",
    "https://user:secret@media.example/video.mp4",
    "/relative/video.mp4",
  ]) {
    assert.equal(sanitizeMediaUrl(value, { kind: "video" }), null);
  }

  assert.equal(
    sanitizeMediaUrl("data:text/html;base64,YWJj", { kind: "image" }),
    null
  );
  assert.equal(
    sanitizeMediaUrl("data:image/png;base64,YWJj", { kind: "video" }),
    null
  );
});

test("blob URLs require an explicit live-runtime allowance", () => {
  const blobUrl = "blob:https://studio.example/7fcb6ce7-5fc3-4ef5";
  assert.equal(sanitizeMediaUrl(blobUrl, { kind: "video" }), null);
  assert.equal(
    sanitizeMediaUrl(blobUrl, { kind: "video", allowBlob: true }),
    blobUrl
  );
  assert.equal(
    sanitizeMediaUrl("blob:javascript:alert(1)", {
      kind: "video",
      allowBlob: true,
    }),
    null
  );
});

test("inline media normalization validates MIME, base64, and decoded size", () => {
  assert.deepEqual(
    normalizeInlineMediaData("YWJj", {
      kind: "image",
      mimeType: "image/png",
      maxBytes: 3,
    }),
    {
      dataUrl: "data:image/png;base64,YWJj",
      mimeType: "image/png",
      data: "YWJj",
    }
  );
  assert.equal(
    normalizeInlineMediaData("not base64!", {
      kind: "image",
      mimeType: "image/png",
    }),
    null
  );
  assert.equal(
    normalizeInlineMediaData("YWJj", {
      kind: "image",
      mimeType: "image/svg+xml",
    }),
    null
  );
  assert.equal(
    sanitizeMediaUrl("data:image/png;base64,YWJj", {
      kind: "image",
      maxBytes: 2,
    }),
    null
  );
});
