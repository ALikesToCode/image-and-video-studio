import {
  getProviderApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorMessage,
} from "@/lib/api-safety";
import {
  buildGeminiImagePayload,
  buildSaferImagePromptForModel,
  isLikelyImagePolicyError,
  supportsSaferImagePromptRetry,
} from "@/lib/studio-generation";
import { normalizeGeminiImageModelId } from "@/lib/studio-validation";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";

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

const imageResponsePayload = (
  images: Array<{ data: string; mimeType: string }>,
  model: string,
  includeUserscriptShape: boolean
) => {
  const payloadImages = images.map((image) =>
    includeUserscriptShape ? { ...image, model } : image
  );
  const firstImage = payloadImages[0];
  if (!includeUserscriptShape) return { images: payloadImages };
  return {
    ...(firstImage
      ? {
          imageUrl: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          model,
        }
      : { model }),
    images: payloadImages,
  };
};

export async function OPTIONS(req: Request) {
  return janitorAiOptionsResponse(req);
}

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = await readJsonRequestObject<ImageRequest>(req);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return janitorAiJsonResponse(
      req,
      { error: details.error },
      { status: details.status }
    );
  }

  const { prompt, model, aspectRatio, imageSize, numberOfImages } = body;
  const userApiKey = getProviderApiKey("gemini", req, body);
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req, body);
  if (!userApiKey || !prompt || !model) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing required fields." },
      { status: 400 }
    );
  }
  const geminiModel = normalizeGeminiImageModelId(model);
  if (!geminiModel) {
    return janitorAiJsonResponse(
      req,
      { error: "Unsupported Gemini image model." },
      { status: 400 }
    );
  }
  const requestImages = async (requestPrompt: string) => {
    const { endpoint, payload } = buildGeminiImagePayload({
      model: geminiModel,
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
    const images = geminiModel.startsWith("imagen-")
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
      supportsSaferImagePromptRetry(geminiModel) &&
      isLikelyImagePolicyError(errorMessage)
    ) {
      ({ response, data, images } = await requestImages(
        buildSaferImagePromptForModel(geminiModel, prompt)
      ));
      if (response.ok && images.length) {
        return janitorAiJsonResponse(
          req,
          imageResponsePayload(images, geminiModel, includeUserscriptShape)
        );
      }
      errorMessage = providerErrorMessage(
        data,
        "Image generation failed.",
        [userApiKey]
      );
    }
    return janitorAiJsonResponse(
      req,
      { error: errorMessage },
      { status: response.status }
    );
  }

  if (
    !images.length &&
    supportsSaferImagePromptRetry(geminiModel) &&
    payloadLooksPolicyBlocked(data)
  ) {
    ({ response, data, images } = await requestImages(
      buildSaferImagePromptForModel(geminiModel, prompt)
    ));
    if (!response.ok) {
      const errorMessage = providerErrorMessage(
        data,
        "Image generation failed.",
        [userApiKey]
      );
      return janitorAiJsonResponse(
        req,
        { error: errorMessage },
        { status: response.status }
      );
    }
  }

  if (!images.length) {
    return janitorAiJsonResponse(
      req,
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  return janitorAiJsonResponse(
    req,
    imageResponsePayload(images, geminiModel, includeUserscriptShape)
  );
}
