import test from "node:test";
import assert from "node:assert/strict";

import {
  hasMediaReferencePayload,
  normalizeImageReferencePayload,
} from "./media-reference.ts";

test("image references accept HTTPS and valid image data URLs", () => {
  assert.equal(
    normalizeImageReferencePayload(" https://example.com/reference.png "),
    "https://example.com/reference.png"
  );
  assert.deepEqual(
    normalizeImageReferencePayload([
      "data:image/png;base64,AQID",
      "https://example.com/reference.webp",
    ]),
    [
      "data:image/png;base64,AQID",
      "https://example.com/reference.webp",
    ]
  );
});

test("image references fail closed on unsafe or malformed entries", () => {
  for (const value of [
    "file:///tmp/reference.png",
    "javascript:alert(1)",
    "http://example.com/reference.png",
    "data:image/svg+xml;base64,AQID",
    "data:image/png;base64,not-valid!",
  ]) {
    assert.equal(normalizeImageReferencePayload(value), undefined);
  }
  assert.equal(
    normalizeImageReferencePayload([
      "https://example.com/reference.png",
      "file:///tmp/reference.png",
    ]),
    undefined
  );
  assert.equal(
    normalizeImageReferencePayload([
      "https://example.com/1.png",
      "https://example.com/2.png",
    ], 1),
    undefined
  );
});

test("media reference presence distinguishes absent and rejected payloads", () => {
  assert.equal(hasMediaReferencePayload(undefined), false);
  assert.equal(hasMediaReferencePayload(null), false);
  assert.equal(hasMediaReferencePayload([]), false);
  assert.equal(hasMediaReferencePayload("file:///tmp/reference.png"), true);
});
