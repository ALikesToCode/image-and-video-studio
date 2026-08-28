import {
  getProviderApiKey,
  isJanitorAiUserscriptRequest,
  janitorAiJsonResponse,
  janitorAiOptionsResponse,
  jsonOrNull,
  providerErrorMessage,
} from "@/lib/api-safety";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";
import { IMAGE_MIME_TYPES } from "@/lib/studio-validation";
import {
  buildOpenRouterImagePayload,
  buildSaferImagePromptForModel,
  isLikelyImagePolicyError,
  supportsSaferImagePromptRetry,
} from "@/lib/studio-generation";

type ImageRequest = {
  apiKey?: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  outputModalities?: string[];
  referenceImages?: Array<{ dataUrl: string; role?: string }>;
};

type ImagePayload = {
  data: string;
  mimeType: string;
  model?: string;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

const parseDataUrl = (value: string) => {
  const match = /^data:([^;]+);base64,(.*)$/.exec(value);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
};

const fetchImageAsBase64 = async (url: string) => {
  const response = await safeFetchExternalMedia(url, {
    allowedHosts: ["openrouter.ai", ".openrouter.ai"],
    allowedContentTypes: [...IMAGE_MIME_TYPES],
    maxBytes: 50 * 1024 * 1024,
    timeoutMs: 30_000,
    allowRedirects: true,
  });
  const contentType = response.headers.get("content-type") ?? "image/png";
  const buffer = await response.arrayBuffer();
  return {
    data: arrayBufferToBase64(buffer),
    mimeType: contentType.split(";")[0] ?? "image/png",
  };
};

const extractResponseText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(extractResponseText).join(" ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [
      extractResponseText(record.text),
      extractResponseText(record.content),
      extractResponseText(record.message),
    ]
      .filter(Boolean)
      .join(" ");
  }
  return "";
};

const getMessageImages = (data: unknown) => {
  const dataRecord =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const choices = Array.isArray(dataRecord.choices) ? dataRecord.choices : [];
  const firstChoice =
    choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : {};
  const message =
    firstChoice.message && typeof firstChoice.message === "object"
      ? (firstChoice.message as Record<string, unknown>)
      : {};
  const images = message?.images ?? [];
  return {
    images: Array.isArray(images) ? images : [],
    responseText: extractResponseText(message.content),
  };
};

const imageResponsePayload = (
  images: ImagePayload[],
  model: string,
  includeUserscriptShape: boolean
) => {
  const payloadImages = images.map((image) =>
    includeUserscriptShape ? { ...image, model: image.model ?? model } : image
  );
  const firstImage = payloadImages[0];
  if (!includeUserscriptShape) return { images: payloadImages };
  return {
    ...(firstImage
      ? {
          imageUrl: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          model: firstImage.model,
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
    body = (await req.json()) as ImageRequest;
  } catch {
    return janitorAiJsonResponse(
      req,
      { error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const { model, prompt, aspectRatio, imageSize, outputModalities } = body;
  const userApiKey = getProviderApiKey("openrouter", req, body);
  const includeUserscriptShape = isJanitorAiUserscriptRequest(req, body);
  if (!userApiKey || !model || !prompt) {
    return janitorAiJsonResponse(
      req,
      { error: "Missing required fields." },
      { status: 400 }
    );
  }

  const postImageRequest = async (requestPrompt: string) => {
    const payload = buildOpenRouterImagePayload({
      model,
      prompt: requestPrompt,
      aspectRatio,
      imageSize,
      outputModalities,
      referenceImages: body.referenceImages,
    });
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${userApiKey}`,
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await jsonOrNull(response);
    const { images, responseText } = getMessageImages(data);
    return { response, data, images, responseText };
  };

  let { response, data, images, responseText } = await postImageRequest(prompt);
  if (!response.ok) {
    let errorMessage = providerErrorMessage(data, "Image generation failed.", [
      userApiKey,
    ]);
    if (
      supportsSaferImagePromptRetry(model) &&
      isLikelyImagePolicyError(errorMessage)
    ) {
      ({ response, data, images, responseText } = await postImageRequest(
        buildSaferImagePromptForModel(model, prompt)
      ));
      if (response.ok && images.length) {
        // Continue into the normal image normalization path.
      } else {
        errorMessage = providerErrorMessage(
          data,
          "Image generation failed.",
          [userApiKey]
        );
      }
    }
  }

  if (!response.ok) {
    return janitorAiJsonResponse(
      req,
      {
        error: providerErrorMessage(data, "Image generation failed.", [userApiKey]),
      },
      { status: response.status }
    );
  }

  if (
    images.length === 0 &&
    supportsSaferImagePromptRetry(model) &&
    isLikelyImagePolicyError(responseText)
  ) {
    ({ response, data, images } = await postImageRequest(
      buildSaferImagePromptForModel(model, prompt)
    ));
    if (!response.ok) {
      return janitorAiJsonResponse(
        req,
        {
          error: providerErrorMessage(data, "Image generation failed.", [
            userApiKey,
          ]),
        },
        { status: response.status }
      );
    }
  }

  if (images.length === 0) {
    return janitorAiJsonResponse(
      req,
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  const payloadImages: ImagePayload[] = [];
  for (const image of images) {
    const url = image?.image_url?.url ?? image?.imageUrl?.url;
    if (typeof url !== "string") {
      continue;
    }
    const dataUrl = parseDataUrl(url);
    if (dataUrl) {
      payloadImages.push({ data: dataUrl.data, mimeType: dataUrl.mimeType });
      continue;
    }
    payloadImages.push(await fetchImageAsBase64(url));
  }

  if (!payloadImages.length) {
    return janitorAiJsonResponse(
      req,
      { error: "No valid images were returned by the model." },
      { status: 502 }
    );
  }

  return janitorAiJsonResponse(
    req,
    imageResponsePayload(payloadImages, model, includeUserscriptShape)
  );
}
