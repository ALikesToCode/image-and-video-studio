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

const pickImagesFromGemini = (data: any) => {
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part: any) => part.inlineData?.data)
    .map((part: any) => ({
      data: part.inlineData.data as string,
      mimeType: part.inlineData.mimeType ?? "image/png",
    }));
};

const pickImagesFromImagen = (data: any) => {
  const predictions = data?.predictions ?? [];
  return predictions
    .filter((item: any) => item.bytesBase64Encoded || item.bytes_base64_encoded)
    .map((item: any) => ({
      data: (item.bytesBase64Encoded ?? item.bytes_base64_encoded) as string,
      mimeType: item.mimeType ?? "image/png",
    }));
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

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Image generation failed." },
      { status: response.status }
    );
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
