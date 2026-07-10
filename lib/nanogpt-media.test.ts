import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeNanoGptImageModels,
  normalizeNanoGptVideoModels,
} from "./nanogpt-media.ts";

test("normalizes NanoGPT image catalog metadata and preserves slash-containing IDs", () => {
  const models = normalizeNanoGptImageModels({
    object: "list",
    data: [
      {
        id: "fal-ai/example/edit-image",
        name: "Example Image Editor",
        description: "Edits up to three source images.",
        architecture: {
          modality: "text+image->image",
          input_modalities: ["text", "image"],
          output_modalities: ["image"],
        },
        pricing: {
          currency: "USD",
          per_image: { "1024x1024": 0.04 },
        },
        capabilities: {
          image_generation: true,
          image_to_image: true,
          inpainting: false,
        },
        supported_parameters: {
          resolutions: ["auto", "1024x1024", null],
          max_images: 4,
          max_output_images: 2,
          max_input_images: 3,
          fixed_image_count: 1,
          input_image_constraints: {
            max_items: 3,
            route: {
              min_width: 8,
              min_height: 8,
              max_bytes: 31_457_280,
              formats: ["png", "jpeg", "webp"],
              source: "route-preflight",
              note: "Validated before provider submission.",
            },
            provider: {
              max_width: 4096,
              max_height: 4096,
              max_bytes: 20_000_000,
              formats: ["png", "jpeg"],
              source: "provider-docs",
            },
          },
        },
      },
    ],
  });

  assert.equal(models.length, 1);
  assert.deepEqual(models[0], {
    id: "fal-ai/example/edit-image",
    label: "Example Image Editor",
    provider: "nanogpt",
    endpoint: "nanogpt-images-generations",
    inputModalities: ["text", "image"],
    outputModalities: ["image"],
    modality: "text+image->image",
    description: "Edits up to three source images.",
    metadataSource: "nanogpt-catalog",
    metadataStatus: "known",
    pricing: {
      currency: "USD",
      per_image: { "1024x1024": 0.04 },
    },
    supports: {
      imageGeneration: true,
      imageEdit: true,
      referenceImages: true,
      size: true,
      sourceImage: true,
    },
    supportedResolutions: ["auto", "1024x1024"],
    maxOutputImages: 2,
    fixedOutputImages: 1,
    maxReferenceImages: 3,
    inputImageConstraints: {
      maxItems: 3,
      route: {
        minWidth: 8,
        minHeight: 8,
        maxBytes: 31_457_280,
        formats: ["png", "jpeg", "webp"],
        source: "route-preflight",
        note: "Validated before provider submission.",
      },
      provider: {
        maxWidth: 4096,
        maxHeight: 4096,
        maxBytes: 20_000_000,
        formats: ["png", "jpeg"],
        source: "provider-docs",
      },
    },
  });
});

test("normalizes NanoGPT video parameters, defaults, pricing, and conditional controls", () => {
  const models = normalizeNanoGptVideoModels({
    models: [
      {
        id: "luma/agent/ray/v3.2",
        name: "Luma Ray 3.2",
        description: "Text and image to video.",
        architecture: {
          modality: "text+image->video",
          input_modalities: ["text", "image"],
          output_modalities: ["video"],
        },
        pricing: {
          currency: "USD",
          per_second_by_resolution: { "540p": 0.1, "720p": 0.2 },
          default_duration: 5,
        },
        capabilities: {
          video_generation: true,
          text_to_video: true,
          image_to_video: true,
          audio_generation: false,
        },
        supported_parameters: {
          parameters: {
            duration: {
              label: "Duration",
              description: "Video duration",
              type: "select",
              options: [
                { value: "5s", label: "5 seconds" },
                { value: "10s", label: "10 seconds" },
              ],
              default: "5s",
            },
            resolution: {
              label: "Resolution",
              type: "select",
              options: [
                { value: "540p", label: "540p" },
                { value: "720p", label: "720p" },
              ],
              default: "540p",
            },
            seed: {
              label: "Seed",
              type: "number",
              min: -1,
              max: 2_147_483_647,
              step: 1,
              default: -1,
            },
            loop: {
              label: "Loop",
              type: "switch",
              default: false,
              showWhen: { duration: "5s" },
            },
            reference_image_urls: {
              label: "Reference Images",
              type: "text",
              placeholder: "https://example.test/reference.png",
              default: "",
            },
          },
          defaults: {
            duration: "5s",
            resolution: "540p",
            seed: -1,
            loop: false,
            reference_image_urls: "",
          },
        },
      },
    ],
  });

  assert.equal(models.length, 1);
  const model = models[0];
  assert.equal(model?.id, "luma/agent/ray/v3.2");
  assert.equal(model?.endpoint, "nanogpt-video-generation");
  assert.deepEqual(model?.inputModalities, ["text", "image"]);
  assert.deepEqual(model?.outputModalities, ["video"]);
  assert.deepEqual(model?.supportedResolutions, ["540p", "720p"]);
  assert.deepEqual(model?.pricing, {
    currency: "USD",
    per_second_by_resolution: { "540p": 0.1, "720p": 0.2 },
    default_duration: 5,
  });
  assert.deepEqual(model?.supports, {
    video: true,
    asyncJobs: true,
    textToVideo: true,
    imageToVideo: true,
    referenceImages: true,
    sourceImage: true,
    seed: true,
    size: true,
  });
  assert.deepEqual(model?.dynamicParameters, {
    duration: {
      label: "Duration",
      description: "Video duration",
      type: "select",
      options: [
        { value: "5s", label: "5 seconds" },
        { value: "10s", label: "10 seconds" },
      ],
      default: "5s",
    },
    resolution: {
      label: "Resolution",
      type: "select",
      options: [
        { value: "540p", label: "540p" },
        { value: "720p", label: "720p" },
      ],
      default: "540p",
    },
    seed: {
      label: "Seed",
      type: "number",
      min: -1,
      max: 2_147_483_647,
      step: 1,
      default: -1,
    },
    loop: {
      label: "Loop",
      type: "switch",
      default: false,
      showWhen: { duration: "5s" },
    },
    reference_image_urls: {
      label: "Reference Images",
      type: "text",
      placeholder: "https://example.test/reference.png",
      default: "",
    },
  });
  assert.deepEqual(model?.parameterDefaults, {
    duration: "5s",
    resolution: "540p",
    seed: -1,
    loop: false,
    reference_image_urls: "",
  });
});

test("marks image-only video models as requiring a source image", () => {
  const [model] = normalizeNanoGptVideoModels([
    {
      id: "provider/image-only-video",
      architecture: {
        modality: "text+image->video",
        input_modalities: ["text", "image"],
        output_modalities: ["video"],
      },
      capabilities: {
        video_generation: true,
        text_to_video: false,
        image_to_video: true,
      },
      supported_parameters: { parameters: {} },
    },
  ]);

  assert.equal(model?.supports?.textToVideo, false);
  assert.equal(model?.supports?.imageToVideo, true);
  assert.equal(model?.supports?.sourceImage, true);
});

test("uses the most conservative documented image caps", () => {
  const [model] = normalizeNanoGptImageModels([
    {
      id: "provider/conservative-edit",
      architecture: {
        input_modalities: ["text", "image"],
        output_modalities: ["image"],
      },
      supported_parameters: {
        max_images: 6,
        max_output_images: 4,
        max_input_images: 5,
        input_image_constraints: { max_items: 2 },
      },
    },
  ]);

  assert.equal(model?.maxOutputImages, 4);
  assert.equal(model?.maxReferenceImages, 2);
});

test("drops malformed catalog records and unsafe parameter descriptors", () => {
  const models = normalizeNanoGptVideoModels({
    data: [
      null,
      { name: "Missing ID" },
      { id: "   ", name: "Blank ID" },
      {
        id: "valid/video-model",
        architecture: {
          input_modalities: ["text", 12, "video"],
          output_modalities: ["video", null],
        },
        supported_parameters: {
          parameters: {
            valid: { type: "boolean", default: true },
            missing_type: { label: "No type" },
            unsupported_type: { type: "file", default: "ignore" },
            invalid_number: { type: "number", min: "zero", default: 0 },
          },
          defaults: {
            valid: true,
            nested: { unsafe: true },
            non_finite: Number.POSITIVE_INFINITY,
          },
        },
      },
      "not-a-model",
    ],
  });

  assert.equal(models.length, 1);
  assert.deepEqual(models[0]?.inputModalities, ["text", "video"]);
  assert.deepEqual(models[0]?.outputModalities, ["video"]);
  assert.deepEqual(models[0]?.dynamicParameters, {
    valid: { type: "boolean", default: true },
    invalid_number: { type: "number", default: 0 },
  });
  assert.deepEqual(models[0]?.parameterDefaults, {
    valid: true,
    invalid_number: 0,
  });
  assert.doesNotThrow(() => JSON.stringify(models));
});

test("accepts direct arrays and data or models catalog envelopes", () => {
  const record = {
    id: "provider/model",
    architecture: { output_modalities: ["image"] },
  };

  assert.equal(normalizeNanoGptImageModels([record]).length, 1);
  assert.equal(normalizeNanoGptImageModels({ data: [record] }).length, 1);
  assert.equal(normalizeNanoGptImageModels({ models: [record] }).length, 1);
  assert.deepEqual(normalizeNanoGptImageModels({ data: "invalid" }), []);
  assert.deepEqual(normalizeNanoGptVideoModels(undefined), []);
});
