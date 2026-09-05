import test from "node:test";
import assert from "node:assert/strict";
import { mergePartialMultiLlmCatalog, normalizeMultiLlmMediaCatalog } from "./multillm-media-catalog.ts";

test("NanoGPT video metadata survives MultiLLM routing", () => {
  const [model] = normalizeMultiLlmMediaCatalog({ data: [{
    id: "image-to-video", output_modalities: ["video"], input_modalities: ["image"],
    capabilities: { image_to_video: true, text_to_video: false, video_generation: true },
    supported_parameters: { resolutions: ["720p", "1080p"],
      duration: { type: "enum", values: ["5", "10"], default: "5" },
    },
  }] }, { source: "nanogpt", kind: "video", assumeKind: true });
  assert.equal(model.id, "nanogpt:image-to-video");
  assert.equal(model.provider, "multillm");
  assert.equal(model.endpoint, "multillm-video-generation");
  assert.equal(model.supports?.textToVideo, false);
  assert.equal(model.supports?.imageToVideo, true);
  assert.deepEqual(model.inputModalities, ["image"]);
  assert.deepEqual(model.supportedResolutions, ["720p", "1080p"]);
  assert.ok(model.dynamicParameters?.duration);
});

test("partial refresh keeps unavailable sources and refreshes healthy sources", () => {
  const option = (id: string) => ({ id, label: id });
  const previous = ["linkapi:cached", "navyai:removed", "gguu:cached"].map(option);
  const incoming = [option("navyai:new")];
  assert.deepEqual(mergePartialMultiLlmCatalog(previous, incoming, ["linkapi", "unified"]).map((model) => model.id),
    ["linkapi:cached", "gguu:cached", "navyai:new"]);
  assert.deepEqual(mergePartialMultiLlmCatalog(previous, incoming, []).map((model) => model.id), ["navyai:new"]);
});
