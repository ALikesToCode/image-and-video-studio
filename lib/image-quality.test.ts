import assert from "node:assert/strict";
import test from "node:test";

import {
  describeImageQualityRequest,
  resolveMaximumGptImage2Size,
  resolveMaximumImageQualityRequest,
  selectHighestImageResolution,
} from "./image-quality.ts";

test("GPT Image 2 uses the largest valid dimensions for the requested aspect", () => {
  assert.equal(resolveMaximumGptImage2Size("1:1"), "2880x2880");
  assert.equal(resolveMaximumGptImage2Size("16:9"), "3840x2160");
  assert.equal(resolveMaximumGptImage2Size("9:16"), "2160x3840");
});

test("maximum quality forces GPT Image 2 size and high quality", () => {
  for (const model of [
    "aihubmix:gpt-image-2-free",
    "gguu:gpt-image-2",
  ]) {
    assert.deepEqual(
      resolveMaximumImageQualityRequest({
        enabled: true,
        provider: "multillm",
        model,
        request: {
          aspectRatio: "16:9",
          size: "1024x1024",
          quality: "low",
        },
      }),
      {
        aspectRatio: "16:9",
        size: "3840x2160",
        quality: "high",
      },
    );
  }
});

test("maximum quality preserves an aspect implied by selected dimensions", () => {
  assert.equal(
    resolveMaximumImageQualityRequest({
      enabled: true,
      provider: "multillm",
      model: "aihubmix:gpt-image-2-free",
      request: { aspectRatio: "auto", size: "1536x1024" },
    }).size,
    "3520x2352",
  );
});

test("NanoGPT GPT Image 2 honors its live 2560px transport limit", () => {
  assert.equal(
    resolveMaximumImageQualityRequest({
      enabled: true,
      provider: "multillm",
      model: "nanogpt:gpt-image-2",
      request: { aspectRatio: "16:9" },
    }).size,
    "2560x1440",
  );
  assert.equal(
    resolveMaximumImageQualityRequest({
      enabled: true,
      provider: "nanogpt",
      model: "gpt-image-2",
      request: { aspectRatio: "1:1" },
    }).resolution,
    "2560x2560",
  );
});

test("maximum quality uses documented Gemini and Imagen maxima", () => {
  assert.equal(
    resolveMaximumImageQualityRequest({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.1-flash-image-preview",
      request: {},
    }).imageSize,
    "4K",
  );
  assert.equal(
    resolveMaximumImageQualityRequest({
      enabled: true,
      provider: "gemini",
      model: "imagen-4.0-generate-001",
      request: {},
    }).imageSize,
    "2K",
  );
});

test("catalog maximum selection preserves the requested aspect ratio", () => {
  const values = ["1024x1024", "1536x1024", "2048x2048", "3840x2160"];
  assert.equal(selectHighestImageResolution(values, "1:1"), "2048x2048");
  assert.equal(selectHighestImageResolution(values, "16:9"), "3840x2160");
});

test("catalog maximum selection keeps abstract quality tiers in consideration", () => {
  assert.equal(
    selectHighestImageResolution(["1024x1024", "2K", "4K"], "1:1"),
    "4K",
  );
});

test("catalog-backed providers use their highest declared size and quality", () => {
  const result = resolveMaximumImageQualityRequest({
    enabled: true,
    provider: "nanogpt",
    model: "canvas-pro",
    modelOption: {
      id: "canvas-pro",
      label: "Canvas Pro",
      supportedResolutions: ["1024x1024", "2048x2048"],
      dynamicParameters: {
        resolution: {
          type: "select",
          options: [
            { value: "1024x1024", label: "1024" },
            { value: "2048x2048", label: "2048" },
          ],
        },
        quality: {
          type: "select",
          options: [
            { value: "low", label: "Low" },
            { value: "high", label: "High" },
          ],
        },
      },
    },
    request: {
      resolution: "1024x1024",
      quality: "low",
      parameters: { resolution: "1024x1024", quality: "low" },
    },
  });

  assert.equal(result.resolution, "2048x2048");
  assert.equal(result.quality, "high");
  assert.deepEqual(result.parameters, {
    resolution: "2048x2048",
    quality: "high",
  });
});

test("disabled maximum quality preserves manual request values", () => {
  const request = { size: "1024x1024", quality: "medium" };
  assert.deepEqual(
    resolveMaximumImageQualityRequest({
      enabled: false,
      provider: "navy",
      model: "gpt-image-2",
      request,
    }),
    request,
  );
});

test("maximum quality labels omit automatic placeholder values", () => {
  assert.equal(
    describeImageQualityRequest({ imageSize: "4K", quality: "auto" }),
    "4K",
  );
});
