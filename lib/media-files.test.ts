import test from "node:test";
import assert from "node:assert/strict";

import { mediaExtensionFromMimeType } from "./media-files.ts";

test("download extensions follow the actual media MIME type", () => {
  assert.equal(mediaExtensionFromMimeType("image/webp", "image"), "webp");
  assert.equal(mediaExtensionFromMimeType("image/jpeg", "image"), "jpg");
  assert.equal(mediaExtensionFromMimeType("video/webm", "video"), "webm");
  assert.equal(mediaExtensionFromMimeType("audio/flac", "audio"), "flac");
  assert.equal(mediaExtensionFromMimeType(undefined, "image"), "png");
});
