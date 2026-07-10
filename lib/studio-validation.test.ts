import test from "node:test";
import assert from "node:assert/strict";

import {
  dataUrlToInlineData,
  geminiOperationStatusUrl,
  isValidModelId,
  normalizeGeminiImageModelId,
  normalizeGeminiOperationName,
  normalizeGeminiVideoModelId,
  normalizeNanoGptVideoJobId,
  normalizeNavyJobId,
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

test("provider path inputs are normalized before URL construction", () => {
  assert.equal(
    normalizeGeminiImageModelId("gemini-3.1-flash-image-preview"),
    "gemini-3.1-flash-image-preview"
  );
  assert.equal(normalizeGeminiImageModelId("google/gemini-2.5"), null);
  assert.equal(
    normalizeGeminiVideoModelId("veo-3.1-generate-preview"),
    "veo-3.1-generate-preview"
  );
  assert.equal(normalizeGeminiVideoModelId("veo-3.1/../../bad"), null);
  assert.equal(
    normalizeGeminiOperationName("operations/abc_123-xyz"),
    "operations/abc_123-xyz"
  );
  assert.equal(
    normalizeGeminiOperationName(
      "models/veo-3.1-generate-preview/operations/abc_123"
    ),
    "models/veo-3.1-generate-preview/operations/abc_123"
  );
  assert.equal(normalizeGeminiOperationName("../operations/abc"), null);
  assert.equal(normalizeNavyJobId("job_abc-123_DEF"), "job_abc-123_DEF");
  assert.equal(normalizeNavyJobId("job_../../secret"), null);
  assert.equal(
    geminiOperationStatusUrl("operations/abc_123-xyz"),
    "https://generativelanguage.googleapis.com/v1beta/operations/abc_123-xyz"
  );
});

test("NanoGPT video job IDs accept documented and legacy-safe handles", () => {
  assert.equal(
    normalizeNanoGptVideoJobId(" vid_m1abc123def456 "),
    "vid_m1abc123def456"
  );
  assert.equal(
    normalizeNanoGptVideoJobId("legacy-provider.request:abc_123"),
    "legacy-provider.request:abc_123"
  );
  assert.equal(normalizeNanoGptVideoJobId("../video/status"), null);
  assert.equal(normalizeNanoGptVideoJobId("job id with spaces"), null);
  assert.equal(normalizeNanoGptVideoJobId("x".repeat(257)), null);
});

test("Veo duration is forced to 8 seconds for constrained workflows", () => {
  assert.equal(normalizeVeoDuration("4", { resolution: "720p" }), "4");
  assert.equal(normalizeVeoDuration("4", { resolution: "1080p" }), "8");
  assert.equal(normalizeVeoDuration("6", { hasReferenceImages: true }), "8");
  assert.equal(normalizeVeoDuration("bad", {}), "8");
});
