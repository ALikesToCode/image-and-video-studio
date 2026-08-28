import type {
  ChatProvider,
  ModelOption,
  Provider,
} from "@/lib/constants";
import type { ChatImageAsset } from "@/lib/chat-media-persistence";
import { buildNanoGptImageToolRequest } from "@/lib/chat-media-tool-requests";
import {
  normalizeImageToolModelRequest,
  resolveRequestedImageModels,
  runImageModelPipelineParallel,
} from "@/lib/chat-image-pipeline";
import { repairImageToolArguments } from "@/lib/chat-tool-prompts";
import { formatProviderErrorForDisplay } from "@/lib/client/provider-error";
import { resolveMaximumImageQualityRequest } from "@/lib/image-quality";
import {
  dataUrlFromBase64,
  fetchAsDataUrl,
} from "@/lib/utils";
import {
  isFluxModel,
  isLikelyImagePolicyError,
  NAVY_JOB_POLL_INTERVAL_MS,
  NAVY_JOB_POLL_MAX_ATTEMPTS,
  normalizeImageRetryAttempts,
  normalizeImagePromptHelpModel,
  prepareImageModelRequests,
  prepareImagePromptForModel,
  resolveNavyChatImageSizing,
  resolveNavyJobPollDelayMs,
  summarizeImageModelPrompts,
} from "@/lib/studio-generation";

import {
  abortableDelay,
  createChatId,
  getNumberArg,
  getStringArg,
  getStringOrStringArrayArg,
  imageEndpointForProvider,
  imageProviderLabel,
} from "./chutes-chat-runtime";

export type ImageToolProgress = {
  model: string;
  status: "refining" | "running" | "rewriting" | "success" | "error";
  attempt?: number;
  maxAttempts?: number;
  prompt?: string;
  images?: ChatImageAsset[];
  error?: string;
};

type RunChatImageToolOptions = {
  args: Record<string, unknown>;
  context?: {
    assistantContent: string;
    userPrompt: string;
  };
  onModelProgress?: (update: ImageToolProgress) => void;
  signal?: AbortSignal;
  provider: ChatProvider;
  allowServerApiKey: boolean;
  imageModels: ModelOption[];
  imageProviderByModelId: ReadonlyMap<string, Provider>;
  imageApiKeyForProvider: (provider: Provider) => string;
  toolImageModel: string;
  imagePipelineEnabled: boolean;
  imageModelOrder: string[];
  imageRetryAttempts: number;
  preferMaximumImageQuality: boolean;
  recoverPrompt: (options: {
    targetModel: string;
    currentPrompt: string;
    errorMessage: string;
    nextAttempt: number;
    maxAttempts: number;
    signal?: AbortSignal;
  }) => Promise<string>;
  requestPromptHelp: (options: {
    targetModel: string;
    currentPrompt: string;
    requestedHelpModel: "auto" | "terra" | "sol";
    signal?: AbortSignal;
  }) => Promise<string>;
};

export const runChatImageTool = async ({
  args,
  context,
  onModelProgress,
  signal,
  provider,
  allowServerApiKey,
  imageModels,
  imageProviderByModelId,
  imageApiKeyForProvider,
  toolImageModel,
  imagePipelineEnabled,
  imageModelOrder,
  imageRetryAttempts,
  preferMaximumImageQuality,
  recoverPrompt,
  requestPromptHelp,
}: RunChatImageToolOptions) => {
  const rawRequestedModel = getStringArg(args, ["model"]);
  const requestedModel = normalizeImageToolModelRequest({
    requestedModel: rawRequestedModel,
  });
  const modelsToRun = resolveRequestedImageModels({
    requestedModel,
    defaultModel: toolImageModel,
    imagePipelineEnabled,
    imageModelOrder,
    availableModels: imageModels.map((item) => item.id),
  });
  if (!modelsToRun.length) {
    throw new Error(
      "No image models are available for the image tool.",
    );
  }
  let finalArgs =
    context && modelsToRun.some(isFluxModel)
      ? repairImageToolArguments(args, context, {
          preferAssistantPrompt: true,
        })
      : args;
  let prompt = getStringArg(finalArgs, ["prompt"]);
  if (!prompt) {
    throw new Error("Tool call missing prompt.");
  }
  const requestedHelpModel = normalizeImagePromptHelpModel(
    getStringArg(finalArgs, ["prompt_help_model"]),
  );
  if (requestedHelpModel) {
    const targetModel = modelsToRun[0] ?? toolImageModel;
    onModelProgress?.({
      model: targetModel,
      status: "refining",
      prompt,
    });
    const helpedPrompt = await requestPromptHelp({
      targetModel,
      currentPrompt: prompt,
      requestedHelpModel,
      signal,
    });
    if (helpedPrompt.trim()) {
      prompt = helpedPrompt.trim();
      finalArgs = { ...finalArgs, prompt };
    }
  }
  const negativePrompt = getStringArg(finalArgs, [
    "negative_prompt",
  ]);
  const imageRequests = modelsToRun.map((targetModel) => {
    const targetProvider =
      imageProviderByModelId.get(targetModel) ?? provider;
    const targetModelOption = imageModels.find(
      (entry) => entry.id === targetModel,
    );
    const requestedSize = getStringArg(finalArgs, ["size"]);
    const requestedAspectRatio = getStringArg(finalArgs, [
      "aspect_ratio",
      "aspectRatio",
    ]);
    const requestedQuality = getStringArg(finalArgs, ["quality"]);
    const requestedResolution = getStringArg(finalArgs, ["resolution"]);
    const requestedWidth = getNumberArg(finalArgs, ["width"]);
    const requestedHeight = getNumberArg(finalArgs, ["height"]);
    const maximumQuality = resolveMaximumImageQualityRequest({
      enabled: preferMaximumImageQuality,
      provider: targetProvider,
      model: targetModel,
      modelOption: targetModelOption,
      request: {
        size: requestedSize || undefined,
        aspectRatio: requestedAspectRatio || undefined,
        quality: requestedQuality || undefined,
        resolution: requestedResolution || undefined,
        width: requestedWidth ?? undefined,
        height: requestedHeight ?? undefined,
        parameters: {},
      },
    });
    if (targetProvider === "multillm") {
      const prepared = prepareImagePromptForModel(
        targetModel,
        prompt,
        negativePrompt || undefined,
      );
      const imageInput = getStringOrStringArrayArg(finalArgs, [
        "image_url",
        "image",
      ]);
      return {
        model: targetModel,
        prompt: prepared.prompt,
        body: {
          model: targetModel,
          prompt: prepared.prompt,
          negativePrompt: prepared.negativePrompt,
          size: maximumQuality.size || undefined,
          aspectRatio: maximumQuality.aspectRatio || undefined,
          quality: maximumQuality.quality || undefined,
          parameters: maximumQuality.parameters,
          modelEndpoint:
            targetModelOption?.upstreamEndpoint ??
            targetModelOption?.endpoint,
          outputModalities: targetModelOption?.outputModalities,
          imageDataUrl:
            typeof imageInput === "string"
              ? imageInput
              : undefined,
          imageDataUrls: Array.isArray(imageInput)
            ? imageInput
            : undefined,
          numberOfImages: 1,
          sync: false,
        },
      };
    }
    if (targetProvider === "nanogpt" && targetModelOption) {
      const [prepared] = prepareImageModelRequests({
        models: [targetModel],
        baseBody: {},
        prompt,
        negativePrompt: negativePrompt || undefined,
        includeNegativePrompt: false,
      });
      return {
        ...prepared,
        body: buildNanoGptImageToolRequest({
          model: targetModelOption,
          prompt: prepared.prompt,
          args: finalArgs,
          preferMaximumImageQuality,
        }),
      };
    }

    const baseBody: Record<string, unknown> = {};
    const imageUrl = getStringOrStringArrayArg(finalArgs, [
      "image_url",
      "image",
    ]);
    if (targetProvider === "navy") {
      const style = getStringArg(finalArgs, ["style"]);
      if (maximumQuality.size) {
        Object.assign(
          baseBody,
          resolveNavyChatImageSizing(maximumQuality.size),
        );
      }
      if (maximumQuality.aspectRatio) {
        baseBody.aspectRatio = maximumQuality.aspectRatio;
      }
      if (maximumQuality.quality) {
        baseBody.quality = maximumQuality.quality;
      }
      if (style) baseBody.style = style;
      if (imageUrl) baseBody.imageUrl = imageUrl;
      baseBody.modelEndpoint =
        targetModelOption?.upstreamEndpoint ?? targetModelOption?.endpoint;
      baseBody.outputModalities = targetModelOption?.outputModalities;
      baseBody.sync = false;
    } else {
      const guidanceScale = getNumberArg(finalArgs, [
        "guidance_scale",
      ]);
      const steps = getNumberArg(finalArgs, [
        "num_inference_steps",
      ]);
      const seed = getNumberArg(finalArgs, ["seed"]);
      baseBody.guidanceScale = guidanceScale ?? undefined;
      baseBody.width = maximumQuality.width
        ? Math.round(maximumQuality.width)
        : undefined;
      baseBody.height = maximumQuality.height
        ? Math.round(maximumQuality.height)
        : undefined;
      baseBody.resolution = maximumQuality.resolution || undefined;
      baseBody.numInferenceSteps = steps
        ? Math.round(steps)
        : undefined;
      baseBody.seed =
        seed !== null ? Math.round(seed) : null;
      if (imageUrl) baseBody.imageUrl = imageUrl;
    }
    return prepareImageModelRequests({
      models: [targetModel],
      baseBody,
      prompt,
      negativePrompt: negativePrompt || undefined,
    })[0];
  });
  const imageRequestByModel = new Map(
    imageRequests.map((request) => [request.model, request]),
  );

  const invokeImageModel = async (
    targetModel: string,
    state: { attempt: number; maxAttempts: number },
  ) => {
    const request = imageRequestByModel.get(targetModel);
    if (!request) {
      throw new Error(
        `Image model ${targetModel} is not prepared.`,
      );
    }
    const targetProvider =
      imageProviderByModelId.get(targetModel) ?? provider;
    const endpoint = imageEndpointForProvider(targetProvider);
    const imageApiKey =
      imageApiKeyForProvider(targetProvider);
    if (
      !imageApiKey &&
      !(targetProvider === "multillm" && allowServerApiKey)
    ) {
      throw new Error(
        `Missing ${imageProviderLabel(targetProvider)} API key for image tool.`,
      );
    }

    const executeRequest = async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": imageApiKey,
        },
        body: JSON.stringify(request.body),
        signal,
      });
      let payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          formatProviderErrorForDisplay(payload, {
            fallback: "Image tool failed.",
            status: response.status,
          }),
        );
      }

      if (
        (targetProvider === "navy" ||
          targetProvider === "multillm") &&
        typeof payload?.id === "string" &&
        payload.id
      ) {
        let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
        let didComplete = false;
        const source = targetModel.startsWith("nanogpt:")
          ? "nanogpt"
          : "navyai";
        for (
          let attempt = 0;
          attempt < NAVY_JOB_POLL_MAX_ATTEMPTS &&
          !didComplete;
          attempt += 1
        ) {
          const pollUrl =
            targetProvider === "multillm"
              ? `/api/multillm/image?id=${encodeURIComponent(payload.id)}&source=${source}`
              : `/api/navy/image?id=${encodeURIComponent(payload.id)}`;
          const pollResponse = await fetch(pollUrl, {
            headers: {
              "x-user-api-key": imageApiKey,
            },
            signal,
          });
          const pollPayload = await pollResponse
            .json()
            .catch(() => null);
          if (
            !pollResponse.ok &&
            pollResponse.status !== 429
          ) {
            throw new Error(
              formatProviderErrorForDisplay(pollPayload, {
                fallback: "Unable to poll image job.",
                status: pollResponse.status,
              }),
            );
          }
          if (pollPayload?.done) {
            if (
              typeof pollPayload?.error === "string" &&
              pollPayload.error
            ) {
              throw new Error(
                `Async image job failed: ${pollPayload.error}`,
              );
            }
            payload = pollPayload;
            didComplete = true;
            break;
          }
          delayMs = resolveNavyJobPollDelayMs({
            payload: pollPayload,
            responseStatus: pollResponse.status,
            currentDelayMs: delayMs,
          });
          await abortableDelay(delayMs, signal);
        }
        if (!didComplete) {
          throw new Error(
            "Timed out waiting for the Navy image job.",
          );
        }
      }

      const images = Array.isArray(payload?.images)
        ? (payload.images as Array<{
            data?: unknown;
            b64_json?: unknown;
            mimeType?: unknown;
            mime_type?: unknown;
            url?: unknown;
          }>)
        : [];
      if (!images.length) {
        throw new Error("No images returned by tool.");
      }
      const parsedImages = (
        await Promise.all(
          images.map(
            async (
              image,
            ): Promise<ChatImageAsset | null> => {
              const data =
                typeof image?.data === "string" && image.data
                  ? image.data
                  : typeof image?.b64_json === "string" &&
                      image.b64_json
                    ? image.b64_json
                    : "";
              const mimeType =
                typeof image?.mimeType === "string"
                  ? image.mimeType
                  : typeof image?.mime_type === "string"
                    ? image.mime_type
                    : "image/png";
              if (data) {
                return {
                  id: createChatId(),
                  dataUrl: dataUrlFromBase64(data, mimeType),
                  mimeType,
                  model: targetModel,
                  provider: targetProvider,
                };
              }
              if (typeof image?.url === "string") {
                return {
                  id: createChatId(),
                  dataUrl: await fetchAsDataUrl(image.url),
                  mimeType,
                  model: targetModel,
                  provider: targetProvider,
                };
              }
              return null;
            },
          ),
        )
      ).filter(
        (item): item is ChatImageAsset => Boolean(item),
      );
      if (!parsedImages.length) {
        throw new Error(
          "No usable images returned by tool.",
        );
      }
      return parsedImages;
    };

    try {
      return await executeRequest();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Image tool failed.";
      const currentPrompt =
        typeof request.body.prompt === "string"
          ? request.body.prompt
          : prompt;
      const shouldRecoverPrompt =
        state.attempt < state.maxAttempts &&
        isLikelyImagePolicyError(message);
      if (!shouldRecoverPrompt) throw error;

      onModelProgress?.({
        model: targetModel,
        status: "rewriting",
        attempt: state.attempt + 1,
        maxAttempts: state.maxAttempts,
        prompt: currentPrompt,
        error: message,
      });
      const retryPrompt = await recoverPrompt({
        targetModel,
        currentPrompt,
        errorMessage: message,
        nextAttempt: state.attempt + 1,
        maxAttempts: state.maxAttempts,
        signal,
      });
      if (retryPrompt && retryPrompt !== currentPrompt) {
        request.prompt = retryPrompt;
        request.body.prompt = retryPrompt;
      }
      throw error;
    }
  };

  const normalizedRetryAttempts =
    normalizeImageRetryAttempts(imageRetryAttempts);
  const result = await runImageModelPipelineParallel({
    models: modelsToRun,
    maxAttempts: normalizedRetryAttempts,
    runModel: invokeImageModel,
    onUpdate: (update) => {
      const targetModel = update.model;
      const request = imageRequestByModel.get(targetModel);
      const promptForModel =
        typeof request?.body.prompt === "string"
          ? request.body.prompt
          : prompt;
      if (update.status === "running") {
        onModelProgress?.({
          model: targetModel,
          status: "running",
          attempt: update.attempt,
          maxAttempts: update.maxAttempts,
          prompt: promptForModel,
        });
        return;
      }
      if (update.status === "success") {
        onModelProgress?.({
          model: targetModel,
          status: "success",
          attempt: update.attempt,
          maxAttempts: update.maxAttempts,
          prompt: promptForModel,
          images: update.value,
        });
        return;
      }
      if (update.status === "error") {
        onModelProgress?.({
          model: targetModel,
          status: "error",
          attempt: update.attempt,
          maxAttempts: update.maxAttempts,
          prompt: promptForModel,
          error:
            update.error instanceof Error
              ? update.error.message
              : "Image generation failed.",
        });
      }
    },
  });
  const parsedImages =
    result.status === "fulfilled"
      ? result.values.flatMap((entry) => entry.value)
      : [];
  const errors = result.errors.map(
    ({ model, reason, attempts }) => {
      const message =
        reason instanceof Error
          ? reason.message
          : "Image generation failed.";
      return `${model}: ${message} after ${attempts} ${
        attempts === 1 ? "try" : "tries"
      }`;
    },
  );

  if (!parsedImages.length) {
    throw new Error(
      errors.join(" | ") ||
        "No usable images returned by tool.",
    );
  }

  const successfulModels =
    result.status === "fulfilled"
      ? result.values.map((entry) => entry.model)
      : [];

  return {
    images: parsedImages,
    model: successfulModels.length
      ? successfulModels.join(", ")
      : modelsToRun.join(", "),
    prompt: summarizeImageModelPrompts(imageRequests),
    errors,
  };
};
