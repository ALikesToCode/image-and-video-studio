import test from "node:test";
import assert from "node:assert/strict";

import {
  dataUrlToInlineData,
  isValidModelId,
  normalizeVeoDuration,
  parseDataUrl,
} from "./studio-validation.ts";

test("data URL parsing accepts allowed image base64 and normalizes mime type", () => {
  assert.deepEqual(parseDataUrl("data:image/PNG;base64,YWJj"), {
    dataUrl: "data:image/png;base64,YWJj",
    mimeType: "image/png",
    data: "YWJj",
  });
  assert.deepEqual(dataUrlToInlineData("data:image/jpeg;base64,ZA=="), {
    inlineData: {
      mimeType: "image/jpeg",
      data: "ZA==",
    },
  });
});

test("data URL parsing rejects non-base64 and disallowed mime types", () => {
  assert.equal(parseDataUrl("data:text/html;base64,PGgxPg=="), null);
  assert.equal(parseDataUrl("data:image/png,plain"), null);
  assert.equal(parseDataUrl("https://example.com/image.png"), null);
});

test("model ID validation blocks whitespace and shell-like characters", () => {
  assert.equal(isValidModelId("google/gemini-2.5-flash-image-preview"), true);
  assert.equal(isValidModelId("black-forest-labs/flux.2-pro"), true);
  assert.equal(isValidModelId("bad model"), false);
  assert.equal(isValidModelId("../secret"), false);
});

test("Veo duration is forced to 8 seconds for constrained workflows", () => {
  assert.equal(normalizeVeoDuration("4", { resolution: "720p" }), "4");
  assert.equal(normalizeVeoDuration("4", { resolution: "1080p" }), "8");
  assert.equal(normalizeVeoDuration("6", { hasReferenceImages: true }), "8");
  assert.equal(normalizeVeoDuration("bad", {}), "8");
});
