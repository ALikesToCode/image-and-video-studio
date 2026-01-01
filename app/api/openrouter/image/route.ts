export const runtime = "edge";

type ImageRequest = {
  apiKey: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
};

type ImagePayload = {
  data: string;
  mimeType: string;
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
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Unable to fetch the generated image.");
  }
  const contentType = response.headers.get("content-type") ?? "image/png";
  const buffer = await response.arrayBuffer();
  return {
    data: arrayBufferToBase64(buffer),
    mimeType: contentType.split(";")[0] ?? "image/png",
  };
};

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, model, prompt, aspectRatio, imageSize } = body;
  if (!apiKey || !model || !prompt) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const payload = {
    model,
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
    ...(aspectRatio || imageSize
      ? {
          image_config: {
            ...(aspectRatio ? { aspect_ratio: aspectRatio } : {}),
            ...(imageSize ? { image_size: imageSize } : {}),
          },
        }
      : {}),
  };

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Image generation failed." },
      { status: response.status }
    );
  }

  const message = data?.choices?.[0]?.message;
  const images = message?.images ?? [];
  if (!Array.isArray(images) || images.length === 0) {
    return Response.json(
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
    return Response.json(
      { error: "No valid images were returned by the model." },
      { status: 502 }
    );
  }

  return Response.json({ images: payloadImages });
}
