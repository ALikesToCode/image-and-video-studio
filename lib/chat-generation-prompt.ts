import type { ModelOption } from "./constants.ts";

export type ChatGenerationPromptModel = Pick<
  ModelOption,
  "id" | "label" | "provider" | "maxReferenceImages" | "supports"
>;

type ChatGenerationSystemPromptOptions = {
  customPrompt?: string;
  imageModel?: ChatGenerationPromptModel;
  imageFallbackModels?: ChatGenerationPromptModel[];
  videoModel?: ChatGenerationPromptModel;
  audioModel?: ChatGenerationPromptModel;
};

const modelSummary = (model: ChatGenerationPromptModel) =>
  `${model.label || model.id} (${model.provider}/${model.id})`;

const buildImageGuidance = (
  model: ChatGenerationPromptModel,
  fallbackModels: ChatGenerationPromptModel[]
) => {
  const normalizedId = model.id.toLowerCase();
  const lines = [
    `Active image model: ${modelSummary(model)}.`,
    "When calling generate_image, include one production-ready visual prompt and preserve the user's subject, composition, identity, exact-text, reference, and exclusion constraints.",
    "Use the active image model unless the user explicitly names another valid model ID. Omit the model argument when uncertain so the configured fallback order remains authoritative.",
    "Do not automatically optimize an image for video, animation, narration, or audio. Add cross-modal direction only when the user asks for it.",
  ];

  const distinctFallbacks = fallbackModels
    .filter(
      (entry, index, items) =>
        entry.id !== model.id &&
        items.findIndex(
          (candidate) =>
            candidate.id === entry.id && candidate.provider === entry.provider
        ) === index
    )
    .slice(0, 3);
  if (distinctFallbacks.length) {
    lines.push(
      `Configured fallback order: ${distinctFallbacks.map(modelSummary).join(", ")}.`
    );
  }

  const acceptsReferences =
    model.supports?.referenceImages === true ||
    (typeof model.maxReferenceImages === "number" &&
      model.maxReferenceImages > 0);
  if (acceptsReferences) {
    const limit =
      typeof model.maxReferenceImages === "number"
        ? model.maxReferenceImages
        : "the catalog-advertised number of";
    lines.push(
      `The selected model accepts up to ${limit} reference images. Keep reference identity and requested edit invariants intact.`
    );
  }

  if (model.provider === "nanogpt") {
    lines.push(
      "For NanoGPT, use only fields advertised by the selected model's live catalog metadata."
    );
  } else if (model.provider === "navy") {
    lines.push(
      "For Navy, keep generation arguments within the selected model's documented capabilities and pass supported references through image_url."
    );
  } else {
    lines.push(
      "For Chutes, send only prompt and scalar controls supported by the selected model."
    );
  }

  if (/flux/.test(normalizedId)) {
    lines.push(
      "Flux mode is active. Write concrete positive visual details and express exclusions as positive visual constraints instead of a negative-prompt block."
    );
  }
  if (/gpt[-_. ]?image|dall[-_. ]?e/.test(normalizedId)) {
    lines.push(
      "For this OpenAI image family, put style direction in the prompt and do not send a style parameter. Render exact in-image text only when the user explicitly requests it."
    );
  }

  return lines.join("\n");
};

export const buildChatGenerationSystemPrompt = ({
  customPrompt = "",
  imageModel,
  imageFallbackModels = [],
  videoModel,
  audioModel,
}: ChatGenerationSystemPromptOptions) => {
  const toolSections: string[] = [];
  if (imageModel) {
    toolSections.push(buildImageGuidance(imageModel, imageFallbackModels));
  }
  if (videoModel) {
    toolSections.push(
      [
        `Active video model: ${modelSummary(videoModel)}.`,
        "When calling generate_video, write a concise motion prompt and include a source frame only when the selected workflow accepts or requires one.",
      ].join("\n")
    );
  }
  if (audioModel) {
    toolSections.push(
      [
        `Active audio model: ${modelSummary(audioModel)}.`,
        "When calling generate_audio, preserve the user's wording and use the configured voice, format, and speed unless the user requests changes.",
      ].join("\n")
    );
  }

  const toolGuidance = toolSections.length
    ? toolSections.join("\n\n")
    : "No generation tools are enabled. Help with answers, planning, and prompt work only.";
  const defaultPrompt = `You are a creative studio assistant. Answer questions and help with prompt writing normally.

Generation tool rules:
- Call a generation tool only when the latest user turn asks to create or modify media now, or when a clear follow-up relies on the conversation or attached media.
- Do not call a generation tool for prompt writing or editing, explanations, comparisons, brainstorming, capability questions, future plans, code or UI rendering, or negated requests.
- Respect the requested output. Words such as video, audio, or image can describe source material or context rather than the desired medium.
- If a generation request lacks a material detail that cannot be inferred safely, ask one short clarification question.
- When generation is clearly requested, call the tool directly without drafting or summarizing the prompt first. After tool results arrive, briefly explain the outcome.
- Never invent a model ID, provider field, or unsupported parameter.

${toolGuidance}`;
  const trimmedCustomPrompt = customPrompt.trim();
  return trimmedCustomPrompt
    ? `${trimmedCustomPrompt}\n\n${defaultPrompt}`
    : defaultPrompt;
};
