export const runtime = "edge";

type ImageRequest = {
  apiKey: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  imageSize?: string;
  numberOfImages?: number;
  personGeneration?: string;
};

const isImagenModel = (model: string) => model.startsWith("imagen-");

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
      const inlineData = toRecord(partRecord?.inlineData);
      const imageData =
        typeof inlineData?.data === "string" ? inlineData.data : "";
      if (!imageData) return null;
      const mimeType =
        typeof inlineData?.mimeType === "string"
          ? inlineData.mimeType
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

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, prompt, model, aspectRatio, imageSize, numberOfImages } = body;
  if (!apiKey || !prompt || !model) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const isImagen = isImagenModel(model);
  const endpoint = isImagen
    ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const payload = isImagen
    ? {
        instances: [{ prompt }],
        parameters: {
          sampleCount: numberOfImages ?? 1,
          ...(aspectRatio ? { aspectRatio } : {}),
          ...(imageSize ? { imageSize } : {}),
        },
      }
    : {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          ...(aspectRatio || imageSize
            ? {
                imageConfig: {
                  ...(aspectRatio ? { aspectRatio } : {}),
                  ...(imageSize ? { imageSize } : {}),
                },
              }
            : {}),
        },
      };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const errorRecord = toRecord(data.error);
    const errorMessage =
      typeof errorRecord?.message === "string"
        ? errorRecord.message
        : typeof data.error === "string"
          ? data.error
          : "Image generation failed.";
    return Response.json({ error: errorMessage }, { status: response.status });
  }

  const images = isImagen ? pickImagesFromImagen(data) : pickImagesFromGemini(data);
  if (!images.length) {
    return Response.json(
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  return Response.json({ images });
}
