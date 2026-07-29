import type { Provider } from "@/lib/constants";
import { dataUrlFromBase64 } from "@/lib/utils";

import {
  blobToDataUrl,
  createChatId,
  getNumberArg,
  getStringArg,
} from "./chutes-chat-runtime";

type RunChatAudioToolOptions = {
  args: Record<string, unknown>;
  signal?: AbortSignal;
  apiKey: string;
  allowServerApiKey: boolean;
  provider: Provider;
  toolAudioModel: string;
};

const audioMediaResult = ({
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
      kind: "audio" as const,
      dataUrl,
      mimeType,
      model,
    },
  ],
  model,
  prompt,
});

export const runChatAudioTool = async ({
  args,
  signal,
  apiKey,
  allowServerApiKey,
  provider,
  toolAudioModel,
}: RunChatAudioToolOptions) => {
  if (!apiKey.trim() && !allowServerApiKey) {
    throw new Error("Missing API key for audio tool.");
  }
  const prompt = getStringArg(args, [
    "input",
    "text",
    "prompt",
  ]);
  if (!prompt) {
    throw new Error("Tool call missing input text.");
  }
  const modelOverride =
    getStringArg(args, ["model"]) || toolAudioModel;

  if (provider === "multillm") {
    const speed = getNumberArg(args, ["speed"]);
    const voice =
      getStringArg(args, ["voice"]) || "alloy";
    const responseFormat = getStringArg(args, [
      "response_format",
    ]);
    const response = await fetch("/api/multillm/audio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-api-key": apiKey,
      },
      body: JSON.stringify({
        model: modelOverride,
        input: prompt,
        voice,
        speed: speed ?? undefined,
        responseFormat: responseFormat || undefined,
      }),
      signal,
    });
    if (!response.ok) {
      const contentType =
        response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        throw new Error(
          payload?.error ?? "Audio tool failed.",
        );
      }
      throw new Error(
        (await response.text()) || "Audio tool failed.",
      );
    }
    const blob = await response.blob();
    return audioMediaResult({
      dataUrl: await blobToDataUrl(blob),
      mimeType: blob.type || "audio/mpeg",
      model: modelOverride,
      prompt,
    });
  }

  if (provider === "navy") {
    const speed = getNumberArg(args, ["speed"]);
    const voice =
      getStringArg(args, ["voice"]) || "alloy";
    const responseFormat = getStringArg(args, [
      "response_format",
    ]);
    const response = await fetch("/api/navy/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user-api-key": apiKey,
      },
      body: JSON.stringify({
        model: modelOverride,
        input: prompt,
        voice,
        speed: speed ?? undefined,
        responseFormat: responseFormat || undefined,
      }),
      signal,
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(
        payload?.error ?? "Audio tool failed.",
      );
    }
    const audioData = payload?.audio?.data;
    const mimeType =
      typeof payload?.audio?.mimeType === "string"
        ? payload.audio.mimeType
        : "audio/mpeg";
    if (
      typeof audioData !== "string" ||
      !audioData.length
    ) {
      throw new Error(
        "No audio data returned by tool.",
      );
    }
    return audioMediaResult({
      dataUrl: dataUrlFromBase64(audioData, mimeType),
      mimeType,
      model: modelOverride,
      prompt,
    });
  }

  const speed = getNumberArg(args, ["speed"]);
  const speaker = getNumberArg(args, ["speaker"]);
  const maxDuration = getNumberArg(args, [
    "max_duration_ms",
    "maxDuration",
  ]);
  const response = await fetch("/api/chutes/audio", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-api-key": apiKey,
    },
    body: JSON.stringify({
      prompt,
      model: modelOverride,
      speed: speed ?? undefined,
      speaker: speaker ?? undefined,
      maxDuration: maxDuration ?? undefined,
    }),
    signal,
  });
  if (!response.ok) {
    const contentType =
      response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      throw new Error(
        payload?.error ?? "Audio tool failed.",
      );
    }
    throw new Error(
      (await response.text()) || "Audio tool failed.",
    );
  }
  const blob = await response.blob();
  return audioMediaResult({
    dataUrl: await blobToDataUrl(blob),
    mimeType: blob.type || "audio/mpeg",
    model: modelOverride,
    prompt,
  });
};
