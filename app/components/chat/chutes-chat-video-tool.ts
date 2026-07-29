import {
  type ModelOption,
  type Provider,
} from "@/lib/constants";
import {
  buildNanoGptVideoToolRequest,
  isChatVideoModelSupported,
  resolveNavyVideoStartResult,
} from "@/lib/chat-tooling";
import {
  NAVY_JOB_POLL_INTERVAL_MS,
  NAVY_JOB_POLL_MAX_ATTEMPTS,
  resolveNavyJobPollDelayMs,
} from "@/lib/studio-generation";
import { dataUrlFromBase64 } from "@/lib/utils";

import {
  abortableDelay,
  blobToDataUrl,
  createChatId,
  getNumberArg,
  getStringArg,
  imageProviderLabel,
} from "./chutes-chat-runtime";

type RunChatVideoToolOptions = {
  args: Record<string, unknown>;
  signal?: AbortSignal;
  provider: Provider;
  allowServerApiKey: boolean;
  toolVideoModel: string;
  videoModelById: ReadonlyMap<string, ModelOption>;
  videoProviderByModelId: ReadonlyMap<string, Provider>;
  videoApiKeyForProvider: (provider: Provider) => string;
  latestGeneratedImage: string | null;
  videoImage?: string | null;
  videoAspect?: string;
  videoDuration?: string;
};

const videoMediaResult = ({
  dataUrl,
  mimeType,
  model,
  prompt,
}: {
  dataUrl: string;
  mimeType: string;
  model: string;
  prompt: string;
}) => ({
  media: [
    {
      id: createChatId(),
      kind: "video" as const,
      dataUrl,
      mimeType,
      model,
    },
  ],
  model,
  prompt,
});

export const runChatVideoTool = async ({
  args,
  signal,
  provider,
  allowServerApiKey,
  toolVideoModel,
  videoModelById,
  videoProviderByModelId,
  videoApiKeyForProvider,
  latestGeneratedImage,
  videoImage,
  videoAspect,
  videoDuration,
}: RunChatVideoToolOptions) => {
  const prompt = getStringArg(args, ["prompt"]);
  if (!prompt) {
    throw new Error("Tool call missing prompt.");
  }
  const modelOverride =
    getStringArg(args, ["model"]) || toolVideoModel;
  const targetModel = videoModelById.get(modelOverride);
  if (
    !targetModel ||
    !isChatVideoModelSupported(targetModel)
  ) {
    throw new Error(
      `Video model ${modelOverride || "(none)"} is not available to chat.`,
    );
  }
  const targetProvider =
    videoProviderByModelId.get(modelOverride) ?? provider;
  const targetApiKey =
    videoApiKeyForProvider(targetProvider);
  if (
    !targetApiKey &&
    !(targetProvider === "multillm" && allowServerApiKey)
  ) {
    throw new Error(
      `Missing ${imageProviderLabel(targetProvider)} API key for video tool.`,
    );
  }
  const sourceImage =
    getStringArg(args, ["image_url", "image"]) ||
    latestGeneratedImage ||
    videoImage ||
    "";

  if (targetProvider === "multillm") {
    const source = modelOverride.startsWith("nanogpt:")
      ? "nanogpt"
      : "navyai";
    const size = getStringArg(args, [
      "size",
      "resolution",
    ]);
    const aspectRatio =
      getStringArg(args, ["aspect_ratio", "aspectRatio"]) ||
      videoAspect;
    const seconds =
      getNumberArg(args, ["seconds", "duration"]) ??
      (videoDuration ? Number(videoDuration) : undefined);
    const createResponse = await fetch(
      "/api/multillm/video",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify({
          model: modelOverride,
          prompt,
          sourceImage: sourceImage || undefined,
          size: size || undefined,
          resolution: size || undefined,
          aspectRatio: aspectRatio || undefined,
          seconds,
        }),
        signal,
      },
    );
    const contentType =
      createResponse.headers.get("content-type") ?? "";
    if (contentType.startsWith("video/")) {
      if (!createResponse.ok) {
        throw new Error(
          "MultiLLM video generation failed.",
        );
      }
      const blob = await createResponse.blob();
      return videoMediaResult({
        dataUrl: await blobToDataUrl(blob),
        mimeType: blob.type || "video/mp4",
        model: modelOverride,
        prompt,
      });
    }

    const createPayload = await createResponse.json();
    if (!createResponse.ok) {
      throw new Error(
        createPayload?.error ??
          "Unable to start MultiLLM video generation.",
      );
    }
    let videoUrl =
      typeof createPayload?.videoUrl === "string"
        ? createPayload.videoUrl
        : "";
    const jobId =
      typeof createPayload?.id === "string"
        ? createPayload.id
        : "";
    if (!videoUrl && !jobId) {
      throw new Error(
        "No MultiLLM video result or job id returned.",
      );
    }

    for (
      let attempt = 0;
      !videoUrl &&
      attempt < NAVY_JOB_POLL_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const pollResponse = await fetch(
        `/api/multillm/video?id=${encodeURIComponent(jobId)}&source=${source}`,
        {
          headers: {
            "x-user-api-key": targetApiKey,
          },
          signal,
        },
      );
      const pollPayload = await pollResponse.json();
      if (!pollResponse.ok) {
        throw new Error(
          pollPayload?.error ??
            "Unable to check MultiLLM video status.",
        );
      }
      if (pollPayload?.done) {
        if (
          typeof pollPayload?.error === "string" &&
          pollPayload.error
        ) {
          throw new Error(pollPayload.error);
        }
        if (
          typeof pollPayload?.videoUrl === "string" &&
          pollPayload.videoUrl
        ) {
          videoUrl = pollPayload.videoUrl;
        }
        break;
      }
      const delayMs = resolveNavyJobPollDelayMs({
        payload: pollPayload,
        responseStatus: pollResponse.status,
        currentDelayMs: NAVY_JOB_POLL_INTERVAL_MS,
      });
      await abortableDelay(delayMs, signal);
    }
    if (!videoUrl) {
      throw new Error(
        "MultiLLM video generation timed out before a result was available.",
      );
    }

    if (jobId) {
      const downloadResponse = await fetch(
        "/api/multillm/video/download",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-user-api-key": targetApiKey,
          },
          body: JSON.stringify({ id: jobId, source }),
          signal,
        },
      );
      if (!downloadResponse.ok) {
        const payload = await downloadResponse
          .json()
          .catch(() => null);
        throw new Error(
          payload?.error ??
            "Unable to download MultiLLM video.",
        );
      }
      const blob = await downloadResponse.blob();
      return videoMediaResult({
        dataUrl: await blobToDataUrl(blob),
        mimeType: blob.type || "video/mp4",
        model: modelOverride,
        prompt,
      });
    }
    return videoMediaResult({
      dataUrl: videoUrl,
      mimeType: "video/mp4",
      model: modelOverride,
      prompt,
    });
  }

  if (targetProvider === "navy") {
    const size = getStringArg(args, ["size"]);
    const seconds = getNumberArg(args, ["seconds"]);
    const seed = getNumberArg(args, ["seed"]);
    const createResponse = await fetch("/api/navy/video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-api-key": targetApiKey,
      },
      body: JSON.stringify({
        model: modelOverride,
        prompt,
        size: size || undefined,
        imageUrl: sourceImage || undefined,
        seconds: seconds ?? undefined,
        seed: seed ?? undefined,
      }),
      signal,
    });
    const createPayload = await createResponse.json();
    if (!createResponse.ok) {
      throw new Error(
        createPayload?.error ??
          "Unable to start video generation.",
      );
    }

    const startResult =
      resolveNavyVideoStartResult(createPayload);
    const jobId = startResult.jobId;
    let videoUrl = startResult.videoUrl;
    if (!videoUrl && !jobId) {
      throw new Error(
        "No video result or job id returned by provider.",
      );
    }
    for (
      let attempt = 0;
      !videoUrl &&
      attempt < NAVY_JOB_POLL_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const pollResponse = await fetch(
        `/api/navy/video?id=${encodeURIComponent(jobId)}`,
        {
          headers: {
            "x-user-api-key": targetApiKey,
          },
          signal,
        },
      );
      const pollPayload = await pollResponse.json();
      if (!pollResponse.ok) {
        throw new Error(
          pollPayload?.error ??
            "Unable to check video generation status.",
        );
      }
      if (!pollPayload?.done) {
        const delayMs = resolveNavyJobPollDelayMs({
          payload: pollPayload,
          responseStatus: pollResponse.status,
          currentDelayMs: NAVY_JOB_POLL_INTERVAL_MS,
        });
        await abortableDelay(delayMs, signal);
        continue;
      }
      if (
        typeof pollPayload?.error === "string" &&
        pollPayload.error.length
      ) {
        throw new Error(pollPayload.error);
      }
      if (
        typeof pollPayload?.videoUrl === "string" &&
        pollPayload.videoUrl.length
      ) {
        videoUrl = pollPayload.videoUrl;
      }
    }
    if (!videoUrl) {
      throw new Error(
        "Video generation timed out before a result was available.",
      );
    }

    const downloadResponse = await fetch(
      "/api/navy/video/download",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify({ url: videoUrl }),
        signal,
      },
    );
    if (!downloadResponse.ok) {
      let message =
        "Unable to download generated video.";
      try {
        const payload = await downloadResponse.json();
        if (
          typeof payload?.error === "string" &&
          payload.error
        ) {
          message = payload.error;
        }
      } catch {
        // Preserve a concise fallback for non-JSON failures.
      }
      throw new Error(message);
    }
    const blob = await downloadResponse.blob();
    return videoMediaResult({
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || "video/mp4",
      model: modelOverride,
      prompt,
    });
  }

  if (targetProvider === "nanogpt") {
    const requiresSourceImage =
      targetModel.supports?.imageToVideo === true &&
      targetModel.supports.textToVideo === false;
    if (requiresSourceImage && !sourceImage) {
      throw new Error(
        `${targetModel.label} requires a source image.`,
      );
    }
    const createResponse = await fetch(
      "/api/nanogpt/video",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify(
          buildNanoGptVideoToolRequest({
            model: targetModel,
            prompt,
            sourceImage,
            args,
          }),
        ),
        signal,
      },
    );
    const createPayload = await createResponse.json();
    if (!createResponse.ok) {
      throw new Error(
        createPayload?.error ??
          "Unable to start NanoGPT video generation.",
      );
    }
    const jobId =
      typeof createPayload?.id === "string"
        ? createPayload.id
        : typeof createPayload?.runId === "string"
          ? createPayload.runId
          : "";
    if (!jobId) {
      throw new Error(
        "No NanoGPT video job id returned.",
      );
    }

    let completed = false;
    let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
    for (
      let attempt = 0;
      !completed &&
      attempt < NAVY_JOB_POLL_MAX_ATTEMPTS;
      attempt += 1
    ) {
      await abortableDelay(delayMs, signal);
      const pollResponse = await fetch(
        `/api/nanogpt/video?id=${encodeURIComponent(jobId)}`,
        {
          headers: {
            "x-user-api-key": targetApiKey,
          },
          signal,
        },
      );
      const pollPayload = await pollResponse.json();
      if (!pollResponse.ok) {
        throw new Error(
          pollPayload?.error ??
            "Unable to check NanoGPT video status.",
        );
      }
      completed = pollPayload?.done === true;
      if (!completed) {
        delayMs = resolveNavyJobPollDelayMs({
          payload: pollPayload,
          responseStatus: pollResponse.status,
          currentDelayMs: delayMs,
        });
      }
    }
    if (!completed) {
      throw new Error(
        "NanoGPT video generation timed out before completion.",
      );
    }

    const downloadResponse = await fetch(
      "/api/nanogpt/video/download",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-api-key": targetApiKey,
        },
        body: JSON.stringify({ id: jobId }),
        signal,
      },
    );
    if (!downloadResponse.ok) {
      let message =
        "Unable to download generated NanoGPT video.";
      try {
        const payload = await downloadResponse.json();
        if (
          typeof payload?.error === "string" &&
          payload.error
        ) {
          message = payload.error;
        }
      } catch {
        // Preserve a concise fallback for non-JSON failures.
      }
      throw new Error(message);
    }
    const blob = await downloadResponse.blob();
    return videoMediaResult({
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || "video/mp4",
      model: modelOverride,
      prompt,
    });
  }

  if (!sourceImage) {
    throw new Error(
      "Chutes video generation requires an image URL or data URI.",
    );
  }
  const fps = getNumberArg(args, ["fps"]);
  const guidanceScale = getNumberArg(args, [
    "guidance_scale_2",
  ]);
  const response = await fetch("/api/chutes/video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-api-key": targetApiKey,
    },
    body: JSON.stringify({
      prompt,
      model: modelOverride,
      image: sourceImage,
      fps: fps ?? undefined,
      guidance_scale_2: guidanceScale ?? undefined,
    }),
    signal,
  });
  if (!response.ok) {
    const contentType =
      response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      throw new Error(
        payload?.error ?? "Video tool failed.",
      );
    }
    throw new Error(
      (await response.text()) || "Video tool failed.",
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = await response.json();
    if (
      typeof payload?.error === "string" &&
      payload.error.length
    ) {
      throw new Error(payload.error);
    }
    if (
      typeof payload?.url === "string" &&
      payload.url.length
    ) {
      return videoMediaResult({
        dataUrl: payload.url,
        mimeType: "video/mp4",
        model: modelOverride,
        prompt,
      });
    }
    if (
      typeof payload?.data === "string" &&
      payload.data.length
    ) {
      const mimeType =
        typeof payload?.mimeType === "string"
          ? payload.mimeType
          : "video/mp4";
      return videoMediaResult({
        dataUrl: dataUrlFromBase64(
          payload.data,
          mimeType,
        ),
        mimeType,
        model: modelOverride,
        prompt,
      });
    }
    throw new Error(
      "No usable video output returned by tool.",
    );
  }

  const blob = await response.blob();
  return videoMediaResult({
    dataUrl: await blobToDataUrl(blob),
    mimeType: blob.type || "video/mp4",
    model: modelOverride,
    prompt,
  });
};
