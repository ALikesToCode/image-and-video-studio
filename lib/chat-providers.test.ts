import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChutesChat } from "../app/components/chutes-chat.tsx";
import {
  CHAT_PROVIDER_OPTIONS,
  chatProviderDisplayName,
  isChatProvider,
} from "./chat-providers.ts";
import {
  NANOGPT_IMAGE_MODELS,
  NANOGPT_LLM_MODELS,
  NANOGPT_VIDEO_MODELS,
} from "./constants.ts";

test("chat provider options expose NanoGPT alongside existing providers", () => {
  assert.deepEqual(
    CHAT_PROVIDER_OPTIONS.map((option) => option.id),
    ["chutes", "navy", "nanogpt"],
  );
  assert.equal(chatProviderDisplayName("nanogpt"), "NanoGPT");
  assert.equal(isChatProvider("nanogpt"), true);
  assert.equal(isChatProvider("openrouter"), false);
});

test("NanoGPT chat renders its provider-aware controls without audio-only tools", () => {
  const markup = renderToStaticMarkup(
    React.createElement(ChutesChat, {
      apiKey: "nano-key",
      provider: "nanogpt",
      setProvider: () => undefined,
      models: NANOGPT_LLM_MODELS,
      model: NANOGPT_LLM_MODELS[0]?.id ?? "",
      setModel: () => undefined,
      imageModels: NANOGPT_IMAGE_MODELS,
      videoModels: NANOGPT_VIDEO_MODELS,
      audioModels: [],
      toolImageModel: NANOGPT_IMAGE_MODELS[0]?.id ?? "",
      setToolImageModel: () => undefined,
      imagePipelineEnabled: false,
      setImagePipelineEnabled: () => undefined,
      imageModelOrder: [],
      setImageModelOrder: () => undefined,
      imageRetryAttempts: 1,
      setImageRetryAttempts: () => undefined,
    }),
  );

  assert.match(markup, /NanoGPT Chat/);
  assert.match(markup, /aria-label="Chat Model"/);
  assert.match(markup, /aria-label="Audio Tool Model"[^>]*disabled/);
});
