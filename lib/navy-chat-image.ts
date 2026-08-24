import {
  normalizeNavyImageUrlPayload,
  prepareImagePromptForModel,
  resolveOpenRouterModalities,
} from "./studio-generation.ts";
import { appendImagePromptDirective } from "./image-prompt-language.ts";

type NavyChatImageGenerationInput = {
  model: string;
  prompt: string;
  size?: string;
  numberOfImages?: number;
  imageUrl?: string | string[];
  negativePrompt?: string;
  aspectRatio?: string;
  outputModalities?: string[];
};

export const isNavyChatImageEndpoint = (value: unknown) =>
  typeof value === "string" &&
  value.trim().replace(/\/+$/, "").toLowerCase() ===
    "/v1/chat/completions";

export const buildNavyChatImagePayload = ({
  model,
  prompt,
  size,
  numberOfImages,
  imageUrl,
  negativePrompt,
  aspectRatio,
  outputModalities,
}: NavyChatImageGenerationInput) => {
  const prepared = prepareImagePromptForModel(model, prompt, negativePrompt);
  const preparedPrompt = prepared.negativePrompt
    ? appendImagePromptDirective(
        prepared.prompt,
        `Avoid these visual issues: ${prepared.negativePrompt}.`,
      )
    : prepared.prompt;
  const normalizedImageUrl = normalizeNavyImageUrlPayload(imageUrl);
  const imageUrls = Array.isArray(normalizedImageUrl)
    ? normalizedImageUrl
    : normalizedImageUrl
      ? [normalizedImageUrl]
      : [];
  const content = imageUrls.length
    ? [
        { type: "text", text: preparedPrompt },
        ...imageUrls.map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
      ]
    : preparedPrompt;
  const normalizedSize = typeof size === "string" ? size.trim() : "";
  const normalizedAspectRatio =
    typeof aspectRatio === "string" ? aspectRatio.trim() : "";

  return {
    model,
    messages: [{ role: "user", content }],
    modalities: resolveOpenRouterModalities(model, outputModalities),
    ...(typeof numberOfImages === "number" && numberOfImages > 1
      ? { n: Math.floor(numberOfImages) }
      : {}),
    ...(normalizedSize || normalizedAspectRatio
      ? {
          image_config: {
            ...(normalizedSize ? { image_size: normalizedSize } : {}),
            ...(normalizedAspectRatio
              ? { aspect_ratio: normalizedAspectRatio }
              : {}),
          },
        }
      : {}),
  };
};
