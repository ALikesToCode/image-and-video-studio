import test from "node:test";
import assert from "node:assert/strict";

import { buildChatGenerationSystemPrompt } from "./chat-generation-prompt.ts";

test("chat generation prompt prevents accidental tool calls", () => {
  const prompt = buildChatGenerationSystemPrompt({
    imageModel: {
      id: "gpt-image-2",
      label: "GPT Image 2",
      provider: "navy",
    },
  });

  assert.match(prompt, /only when the latest user turn asks to create or modify media now/i);
  assert.match(prompt, /do not call a generation tool for prompt writing/i);
  assert.match(prompt, /call the tool directly without drafting or summarizing/i);
  assert.doesNotMatch(prompt, /video readiness note/i);
  assert.doesNotMatch(prompt, /audio mood note/i);
});

test("image guidance follows the selected image model provider", () => {
  const prompt = buildChatGenerationSystemPrompt({
    chatModel: "gpt-5.6-luna",
    imageModel: {
      id: "gpt-image-2",
      label: "GPT Image 2",
      provider: "navy",
      maxReferenceImages: 5,
      supports: { referenceImages: true },
    },
    imageFallbackModels: [
      {
        id: "flux-pro",
        label: "Flux Pro",
        provider: "nanogpt",
      },
    ],
  });

  assert.match(prompt, /active image model: GPT Image 2 \(navy\/gpt-image-2\)/i);
  assert.match(prompt, /up to 5 reference images/i);
  assert.match(prompt, /configured fallback order: Flux Pro \(nanogpt\/flux-pro\)/i);
  assert.match(prompt, /do not send a style parameter/i);
  assert.match(prompt, /primary subject and action/i);
  assert.match(prompt, /background.*lowest visual priority/i);
  assert.match(prompt, /final renderable image brief/i);
  assert.match(prompt, /Never copy these instructions/i);
  assert.match(prompt, /roughly 120-220 words/i);
  assert.match(prompt, /no more than six short sections/i);
  assert.match(prompt, /render-only payload for the visual model/i);
  assert.match(prompt, /resolve alternatives into one camera/i);
  assert.match(prompt, /present-frame evidence/i);
  assert.match(prompt, /positive visible states/i);
  assert.match(prompt, /full-busted hourglass silhouette/i);
  assert.match(prompt, /secure opaque neckline/i);
  assert.match(prompt, /never drop a unique invariant/i);
  assert.match(prompt, /write each visual fact once/i);
  assert.match(prompt, /resolve continuity and workflow state internally/i);
  assert.match(prompt, /UNREGISTERED, REGISTERED, UNKNOWN/i);
  assert.match(prompt, /preserve requested non-explicit hyperfeminine styling/i);
  assert.match(prompt, /hourglass silhouette, layered jewelry/i);
  assert.match(prompt, /tasteful adult night-fashion or boudoir/i);
  assert.match(prompt, /minimal-coverage fashion with opaque strategic draping/i);
  assert.match(prompt, /do not flatten lawful adult glamour/i);
  assert.match(prompt, /requested visual medium as authoritative/i);
  assert.match(prompt, /do not add photography, live-action/i);
  assert.match(prompt, /Replace generic masterpiece/i);
  assert.match(prompt, /semantic age wording/i);
  assert.match(prompt, /late-thirties/i);
  assert.match(prompt, /never resubmit the unchanged prompt/i);
  assert.match(prompt, /prompt_help_model.*terra/i);
  assert.doesNotMatch(prompt, /Flux mode is active/i);
});

test("Terra can request Sol prompt help without changing the image model", () => {
  const prompt = buildChatGenerationSystemPrompt({
    chatModel: "gpt-5.6-terra",
    imageModel: {
      id: "nano-banana-2",
      label: "Nano Banana 2",
      provider: "navy",
    },
  });

  assert.match(prompt, /prompt_help_model.*sol/i);
  assert.match(prompt, /refines the prompt; it does not replace the selected image model/i);
});

test("Flux guidance is scoped to a selected Flux image model", () => {
  const prompt = buildChatGenerationSystemPrompt({
    imageModel: {
      id: "flux-kontext-pro",
      label: "Flux Kontext Pro",
      provider: "nanogpt",
    },
  });

  assert.match(prompt, /Flux mode is active/i);
  assert.match(prompt, /express exclusions as positive visual constraints/i);
  assert.doesNotMatch(prompt, /optimize for downstream video and audio/i);
});

test("chat generation prompt lists only active media models", () => {
  const prompt = buildChatGenerationSystemPrompt({
    videoModel: {
      id: "veo-3.1-fast",
      label: "Veo 3.1 Fast",
      provider: "navy",
    },
    audioModel: {
      id: "gpt-4o-mini-tts",
      label: "GPT-4o mini TTS",
      provider: "navy",
    },
  });

  assert.doesNotMatch(prompt, /active image model/i);
  assert.match(prompt, /active video model: Veo 3.1 Fast \(navy\/veo-3.1-fast\)/i);
  assert.match(prompt, /active audio model: GPT-4o mini TTS \(navy\/gpt-4o-mini-tts\)/i);
});

test("custom instructions do not replace generation safety rules", () => {
  const prompt = buildChatGenerationSystemPrompt({
    customPrompt: "Answer in short sentences.",
  });

  assert.match(prompt, /^Answer in short sentences\./);
  assert.match(prompt, /No generation tools are enabled/i);
  assert.match(prompt, /do not call a generation tool/i);
});
