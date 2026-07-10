import test from "node:test";
import assert from "node:assert/strict";

import type { ModelOption } from "./constants.ts";
import * as modelMediaCapabilities from "./model-media-capabilities.ts";
import {
  getModelReferenceLimit,
  modelAcceptsImageReferences,
  modelAcceptsSourceImage,
} from "./model-media-capabilities.ts";

test("known text-only models do not advertise image inputs", () => {
  const model: ModelOption = {
    id: "text-to-video",
    label: "Text to video",
    metadataStatus: "known",
    inputModalities: ["text"],
    supports: { video: true },
  };

  assert.equal(modelAcceptsImageReferences(model), false);
  assert.equal(modelAcceptsSourceImage(model), false);
  assert.equal(getModelReferenceLimit(model), 0);
});

test("catalog image inputs and explicit limits enable the matching controls", () => {
  const model: ModelOption = {
    id: "image-to-video",
    label: "Image to video",
    metadataStatus: "known",
    inputModalities: ["text", "image"],
    maxReferenceImages: 4,
    supports: {
      video: true,
      sourceImage: true,
      referenceImages: true,
    },
  };

  assert.equal(modelAcceptsImageReferences(model), true);
  assert.equal(modelAcceptsSourceImage(model), true);
  assert.equal(getModelReferenceLimit(model), 4);
});

test("legacy models without capability metadata preserve existing image controls", () => {
  const model: ModelOption = { id: "legacy", label: "Legacy" };

  assert.equal(modelAcceptsImageReferences(model), true);
  assert.equal(modelAcceptsSourceImage(model), true);
  assert.equal(getModelReferenceLimit(model), undefined);
});

test("explicit zero and false capabilities override modality fallbacks", () => {
  const model: ModelOption = {
    id: "no-reference",
    label: "No reference",
    inputModalities: ["text", "image"],
    maxReferenceImages: 0,
    supports: { referenceImages: false, sourceImage: false },
  };

  assert.equal(modelAcceptsImageReferences(model), false);
  assert.equal(modelAcceptsSourceImage(model), false);
  assert.equal(getModelReferenceLimit(model), 0);
});

test("standalone video support keeps text/image workflows and rejects source-only media", () => {
  const getSupport = (
    modelMediaCapabilities as unknown as {
      getStandaloneVideoModelSupport?: (model: ModelOption) => {
        supported: boolean;
        reason?: string;
      };
    }
  ).getStandaloneVideoModelSupport;
  if (typeof getSupport !== "function") {
    assert.fail("getStandaloneVideoModelSupport is not implemented");
  }

  assert.deepEqual(
    getSupport({
      id: "image-video",
      label: "Image video",
      inputModalities: ["text", "image"],
      modality: "text+image->video",
      supports: { video: true, imageToVideo: true },
    }),
    { supported: true },
  );

  const inferredImageWorkflowWithAudio = getSupport({
    id: "audio-avatar",
    label: "Audio avatar",
    inputModalities: ["image", "audio"],
    supports: { video: true, imageToVideo: true },
  });
  assert.equal(inferredImageWorkflowWithAudio.supported, false);
  assert.match(inferredImageWorkflowWithAudio.reason ?? "", /audio/i);

  const sourceVideoOnly = getSupport({
    id: "extend-video",
    label: "Extend video",
    inputModalities: ["video"],
    supports: { video: true, textToVideo: false, imageToVideo: false },
  });
  assert.equal(sourceVideoOnly.supported, false);
  assert.match(sourceVideoOnly.reason ?? "", /source video/i);

  const audioDrivenOnly = getSupport({
    id: "lipsync",
    label: "Lipsync",
    modality: "audio+image->video",
    supports: { video: true, textToVideo: false, imageToVideo: false },
  });
  assert.equal(audioDrivenOnly.supported, false);
  assert.match(audioDrivenOnly.reason ?? "", /audio/i);

  const audioParameterOnly = getSupport({
    id: "audio-parameter-avatar",
    label: "Audio parameter avatar",
    supports: { video: true, imageToVideo: true },
    dynamicParameters: {
      audio_url: { type: "text" },
    },
  });
  assert.equal(audioParameterOnly.supported, false);
  assert.match(audioParameterOnly.reason ?? "", /audio/i);
});

test("image input validation enforces conservative format, byte, and item limits", () => {
  const validate = (
    modelMediaCapabilities as unknown as {
      validateModelImageInputs?: (
        model: ModelOption | undefined,
        inputs: Array<{ name?: string; mimeType?: string; size?: number }>,
        label?: string,
      ) => string | null;
    }
  ).validateModelImageInputs;
  if (typeof validate !== "function") {
    assert.fail("validateModelImageInputs is not implemented");
  }

  const model: ModelOption = {
    id: "strict-editor",
    label: "Strict editor",
    inputImageConstraints: {
      maxItems: 2,
      route: {
        maxBytes: 4 * 1024 * 1024,
        formats: ["image/jpeg", "image/png"],
      },
      provider: {
        maxBytes: 2 * 1024 * 1024,
        formats: ["jpg", "png"],
      },
    },
  };

  assert.equal(
    validate(model, [
      { name: "a.jpg", mimeType: "image/jpeg", size: 1024 },
      { name: "b.png", mimeType: "image/png", size: 2048 },
    ]),
    null,
  );
  assert.match(
    validate(model, [
      { name: "a.jpg", mimeType: "image/jpeg", size: 1024 },
      { name: "b.png", mimeType: "image/png", size: 2048 },
      { name: "c.jpg", mimeType: "image/jpeg", size: 1024 },
    ]) ?? "",
    /up to 2/i,
  );
  assert.match(
    validate(model, [
      { name: "large.jpg", mimeType: "image/jpeg", size: 3 * 1024 * 1024 },
    ]) ?? "",
    /2 MB/i,
  );
  assert.match(
    validate(model, [
      { name: "reference.webp", mimeType: "image/webp", size: 1024 },
    ]) ?? "",
    /JPEG.*PNG|PNG.*JPEG/i,
  );
  assert.match(
    validate(undefined, [
      { name: "notes.txt", mimeType: "text/plain", size: 128 },
    ]) ?? "",
    /not an image/i,
  );
  assert.match(
    validate(undefined, [
      { name: "document.pdf", mimeType: "", size: 128 },
    ]) ?? "",
    /not an image/i,
  );
  assert.equal(
    validate(
      {
        id: "jxl-editor",
        label: "JXL editor",
        inputImageConstraints: {
          provider: { formats: ["image/jxl"] },
        },
      },
      [{ name: "reference.jxl", mimeType: "", size: 128 }],
    ),
    null,
  );
  assert.match(
    validate(
      {
        id: "tiff-only",
        label: "TIFF only",
        inputImageConstraints: {
          provider: { formats: ["image/tiff"] },
        },
      },
      [{ name: "reference.png", mimeType: "image/png", size: 128 }],
    ) ?? "",
    /TIFF/i,
  );
});

test("image input metadata reads MIME type and byte size from data URLs", () => {
  const fromDataUrl = (
    modelMediaCapabilities as unknown as {
      imageInputMetadataFromDataUrl?: (dataUrl: string) => {
        mimeType?: string;
        size?: number;
      };
    }
  ).imageInputMetadataFromDataUrl;
  if (typeof fromDataUrl !== "function") {
    assert.fail("imageInputMetadataFromDataUrl is not implemented");
  }

  assert.deepEqual(fromDataUrl("data:image/png;base64,AQIDBA=="), {
    mimeType: "image/png",
    size: 4,
  });
  assert.deepEqual(fromDataUrl("https://example.test/image.png"), {});
});

test("cached image constraints reject malformed nested values", () => {
  const sanitize = (
    modelMediaCapabilities as unknown as {
      sanitizeModelInputImageConstraints?: (value: unknown) =>
        | ModelOption["inputImageConstraints"]
        | undefined;
    }
  ).sanitizeModelInputImageConstraints;
  if (typeof sanitize !== "function") {
    assert.fail("sanitizeModelInputImageConstraints is not implemented");
  }

  assert.deepEqual(
    sanitize({
      maxItems: 3,
      route: {
        maxBytes: 4_000_000,
        minWidth: -10,
        formats: ["image/png", 12, "  image/jpeg  "],
      },
      provider: "unsafe",
    }),
    {
      maxItems: 3,
      route: {
        maxBytes: 4_000_000,
        formats: ["image/png", "image/jpeg"],
      },
    },
  );
});

test("reference submission avoids duplicating the source and respects the total image cap", () => {
  const selectReferences = (
    modelMediaCapabilities as unknown as {
      selectModelReferenceImagesForSubmission?: (
        model: ModelOption | undefined,
        sourceImage: string | null,
        referenceImages: string[],
      ) => string[];
    }
  ).selectModelReferenceImagesForSubmission;
  if (typeof selectReferences !== "function") {
    assert.fail("selectModelReferenceImagesForSubmission is not implemented");
  }

  const model: ModelOption = {
    id: "capped-video",
    label: "Capped video",
    maxReferenceImages: 5,
    inputImageConstraints: { maxItems: 2 },
  };
  assert.deepEqual(
    selectReferences(model, "data:image/png;base64,AQ==", [
      "data:image/png;base64,AQ==",
      "data:image/png;base64,Ag==",
      "data:image/png;base64,Aw==",
    ]),
    ["data:image/png;base64,Ag=="],
  );
  assert.deepEqual(
    selectReferences(model, null, [
      "data:image/png;base64,AQ==",
      "data:image/png;base64,Ag==",
      "data:image/png;base64,Aw==",
    ]),
    ["data:image/png;base64,AQ==", "data:image/png;base64,Ag=="],
  );
});
