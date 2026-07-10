import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeNanoGptChatMeta,
  normalizeNanoGptChatModels,
} from "./nanogpt-chat.ts";

test("NanoGPT text models preserve documented detailed metadata safely", () => {
  const models = normalizeNanoGptChatModels({
    object: "list",
    data: [
      {
        id: "google/gemini-3-flash-preview",
        object: "model",
        created: 1_736_966_400,
        owned_by: "google",
        name: "Gemini 3 Flash Preview",
        description: "Fast multimodal reasoning model",
        context_length: 1_000_000,
        max_output_tokens: 65_536,
        architecture: {
          modality: "text+image+audio+video->text",
          input_modalities: ["text", "image", "audio", "video"],
          output_modalities: ["text"],
        },
        capabilities: {
          vision: true,
          video_input: true,
          audio_input: true,
          reasoning: true,
          tool_calling: true,
          parallel_tool_calls: true,
          structured_output: true,
          pdf_upload: true,
          undocumented: "do not reflect arbitrary metadata",
        },
        pricing: {
          prompt: 0.15,
          completion: 0.6,
          cacheReadInputPer1kTokens: 0.0001,
          cacheWriteInputPer1kTokens: 0.0002,
          currency: "USD",
          unit: "per_million_tokens",
          note: "Cache prices are per 1K tokens.",
          undocumented: "drop-me",
        },
        icon_url: "/icons/Google.svg",
        cost_estimate: 0.0058,
        category: "reasoning",
        providers: ["google", "vertex", "google", "bad provider"],
        subscription: {
          included: true,
          inputTokenMultiplier: 2,
          note: "Included in subscription (uses 2x input tokens)",
        },
        distillationPolicy: {
          status: "allowed",
          label: "License permits distillation",
          basis: "permissive-open-weights",
          sourceUrl: "https://example.com/license",
          note: "Check the current provider route policy too.",
          ignored: "drop-me",
        },
      },
      {
        id: "google/gemini-3-flash-preview",
        name: "Duplicate must not reorder or replace the first model",
      },
      { id: "   ", name: "Missing identifier" },
      null,
    ],
  });

  assert.deepEqual(models, [
    {
      id: "google/gemini-3-flash-preview",
      label: "Gemini 3 Flash Preview",
      provider: "nanogpt",
      endpoint: "nanogpt-chat-completions",
      metadataSource: "nanogpt-text-catalog",
      metadataStatus: "known",
      object: "model",
      created: 1_736_966_400,
      ownedBy: "google",
      description: "Fast multimodal reasoning model",
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      modality: "text+image+audio+video->text",
      inputModalities: ["text", "image", "audio", "video", "file"],
      outputModalities: ["text"],
      supportsVision: true,
      supportsAudioInput: true,
      supportsVideoInput: true,
      supportsTools: true,
      supportsFunctionCalling: true,
      supportsReasoning: true,
      supportsJsonMode: true,
      capabilities: {
        vision: true,
        video_input: true,
        audio_input: true,
        reasoning: true,
        tool_calling: true,
        parallel_tool_calls: true,
        structured_output: true,
        pdf_upload: true,
      },
      pricing: {
        prompt: 0.15,
        completion: 0.6,
        cacheReadInputPer1kTokens: 0.0001,
        cacheWriteInputPer1kTokens: 0.0002,
        currency: "USD",
        unit: "per_million_tokens",
        note: "Cache prices are per 1K tokens.",
      },
      iconUrl: "https://nano-gpt.com/icons/Google.svg",
      costEstimate: 0.0058,
      category: "reasoning",
      providers: ["google", "vertex"],
      subscription: {
        included: true,
        inputTokenMultiplier: 2,
        note: "Included in subscription (uses 2x input tokens)",
      },
      premium: false,
      tokenMultiplier: 2,
      distillationPolicy: {
        status: "allowed",
        label: "License permits distillation",
        basis: "permissive-open-weights",
        sourceUrl: "https://example.com/license",
        note: "Check the current provider route policy too.",
      },
    },
  ]);
});

test("NanoGPT text models reject unsafe values and preserve explicit false or null metadata", () => {
  const costEstimate = JSON.parse(
    '{"cheap":false,"nested":{"score":2},"__proto__":{"polluted":true}}',
  ) as Record<string, unknown>;
  costEstimate.fn = () => "unsafe";
  const models = normalizeNanoGptChatModels([
    {
      id: "safe/model",
      name: "Safe model",
      context_length: null,
      max_output_tokens: null,
      capabilities: {
        vision: false,
        reasoning: false,
        tool_calling: false,
        structured_output: false,
        pdf_upload: false,
      },
      pricing: {
        prompt: -1,
        completion: Number.POSITIVE_INFINITY,
        currency: "USD",
        unit: "per_million_tokens",
      },
      icon_url: "javascript:alert(1)",
      cost_estimate: costEstimate,
      distillationPolicy: {
        sourceUrl: "javascript:alert(1)",
      },
    },
    { id: "x".repeat(300) },
  ]);

  assert.equal(models.length, 1);
  assert.deepEqual(models[0], {
    id: "safe/model",
    label: "Safe model",
    provider: "nanogpt",
    endpoint: "nanogpt-chat-completions",
    metadataSource: "nanogpt-text-catalog",
    metadataStatus: "known",
    contextWindow: null,
    maxOutputTokens: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsVision: false,
    supportsTools: false,
    supportsFunctionCalling: false,
    supportsReasoning: false,
    supportsJsonMode: false,
    capabilities: {
      vision: false,
      reasoning: false,
      tool_calling: false,
      structured_output: false,
      pdf_upload: false,
    },
    pricing: {
      currency: "USD",
      unit: "per_million_tokens",
    },
    costEstimate: {
      cheap: false,
      nested: { score: 2 },
    },
  });
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("NanoGPT text catalog metadata is bounded to safe JSON", () => {
  const meta = normalizeNanoGptChatMeta({
    meta: {
      count: 2,
      distillation: "all",
      generated_at: "2026-07-10T00:00:00.000Z",
      fn: () => "unsafe",
      nested: { ok: true },
    },
  });

  assert.deepEqual(meta, {
    count: 2,
    distillation: "all",
    generated_at: "2026-07-10T00:00:00.000Z",
    nested: { ok: true },
  });
});
