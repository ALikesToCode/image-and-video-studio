export const runtime = "edge";

import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import {
  buildGeminiImagePayload,
  buildSaferImagePromptForModel,
  isLikelyImagePolicyError,
  supportsSaferImagePromptRetry,
} from "@/lib/studio-generation";

type ImageRequest = {
  apiKey?: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  imageSize?: string;
  numberOfImages?: number;
  personGeneration?: string;
  referenceImages?: Array<{ dataUrl: string; role?: string }>;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const pickImagesFromGemini = (data: unknown) => {
  const record = toRecord(data);
  const candidates = asArray(record?.candidates);
  const firstCandidate = toRecord(candidates[0]);
  const content = toRecord(firstCandidate?.content);
  const parts = asArray(content?.parts);
  return parts
    .map((part) => {
      const partRecord = toRecord(part);
      const inlineData = toRecord(partRecord?.inlineData ?? partRecord?.inline_data);
      const imageData =
        typeof inlineData?.data === "string" ? inlineData.data : "";
      if (!imageData) return null;
      const mimeType =
        typeof inlineData?.mimeType === "string"
          ? inlineData.mimeType
          : typeof inlineData?.mime_type === "string"
            ? inlineData.mime_type
          : "image/png";
      return { data: imageData, mimeType };
    })
    .filter(
      (item): item is { data: string; mimeType: string } => item !== null
    );
};

const pickImagesFromImagen = (data: unknown) => {
  const record = toRecord(data);
  const predictions = asArray(record?.predictions);
  return predictions
    .map((item) => {
      const recordItem = toRecord(item);
      const imageData =
        typeof recordItem?.bytesBase64Encoded === "string"
          ? recordItem.bytesBase64Encoded
          : typeof recordItem?.bytes_base64_encoded === "string"
            ? recordItem.bytes_base64_encoded
            : "";
      if (!imageData) return null;
      const mimeType =
        typeof recordItem?.mimeType === "string"
          ? recordItem.mimeType
          : "image/png";
      return { data: imageData, mimeType };
    })
    .filter(
      (item): item is { data: string; mimeType: string } => item !== null
    );
};

const payloadLooksPolicyBlocked = (data: unknown) =>
  isLikelyImagePolicyError(JSON.stringify(data ?? ""));

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { prompt, model, aspectRatio, imageSize, numberOfImages } = body;
  const userApiKey = getUserApiKey(req, body);
  if (!userApiKey || !prompt || !model) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }
  const requestImages = async (requestPrompt: string) => {
    const { endpoint, payload } = buildGeminiImagePayload({
      model,
      prompt: requestPrompt,
      aspectRatio,
      imageSize,
      numberOfImages,
      referenceImages: body.referenceImages,
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": userApiKey,
      },
      body: JSON.stringify(payload),
    });
    const data = (await jsonOrNull(response)) as Record<string, unknown> | null;
    const images = model.startsWith("imagen-")
      ? pickImagesFromImagen(data)
      : pickImagesFromGemini(data);
    return { response, data, images };
  };

  let { response, data, images } = await requestImages(prompt);
  if (!response.ok) {
    let errorMessage = providerErrorMessage(
      data,
      "Image generation failed.",
      [userApiKey]
    );
    if (
      supportsSaferImagePromptRetry(model) &&
      isLikelyImagePolicyError(errorMessage)
    ) {
      ({ response, data, images } = await requestImages(
        buildSaferImagePromptForModel(model, prompt)
      ));
      if (response.ok && images.length) {
        return Response.json({ images });
      }
      errorMessage = providerErrorMessage(
        data,
        "Image generation failed.",
        [userApiKey]
      );
    }
    return Response.json({ error: errorMessage }, { status: response.status });
  }

  if (
    !images.length &&
    supportsSaferImagePromptRetry(model) &&
    payloadLooksPolicyBlocked(data)
  ) {
    ({ response, data, images } = await requestImages(
      buildSaferImagePromptForModel(model, prompt)
    ));
    if (!response.ok) {
      const errorMessage = providerErrorMessage(
        data,
        "Image generation failed.",
        [userApiKey]
      );
      return Response.json({ error: errorMessage }, { status: response.status });
    }
  }

  if (!images.length) {
    return Response.json(
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  return Response.json({ images });
}
