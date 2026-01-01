export const runtime = "edge";

type ImageRequest = {
  apiKey: string;
  prompt: string;
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

const extractFromJson = (data: any) => {
  const images: ImagePayload[] = [];
  const urls: string[] = [];
  const addBase64 = (value: unknown, mimeType?: string) => {
    if (typeof value !== "string") return;
    const dataUrl = parseDataUrl(value);
    if (dataUrl) {
      images.push({ data: dataUrl.data, mimeType: dataUrl.mimeType });
      return;
    }
    images.push({ data: value, mimeType: mimeType ?? "image/png" });
  };
  const addUrl = (value: unknown) => {
    if (typeof value === "string") urls.push(value);
  };

  addBase64(data?.image, data?.mime_type ?? data?.mimeType);
  addBase64(data?.image_base64, data?.mime_type ?? data?.mimeType);
  addBase64(data?.imageBase64, data?.mime_type ?? data?.mimeType);
  addBase64(data?.output, data?.mime_type ?? data?.mimeType);
  addUrl(data?.url);
  addUrl(data?.output_url);
  addUrl(data?.outputUrl);

  const candidates = data?.images ?? data?.data ?? data?.outputs ?? [];
  if (Array.isArray(candidates)) {
    for (const item of candidates) {
      if (typeof item === "string") {
        if (item.startsWith("http")) {
          addUrl(item);
        } else {
          addBase64(item);
        }
        continue;
      }
      if (!item || typeof item !== "object") continue;
      addBase64(
        item.image ?? item.base64 ?? item.b64_json ?? item.data,
        item.mime_type ?? item.mimeType
      );
      addUrl(item.url ?? item.output_url ?? item.outputUrl);
    }
  }

  return { images, urls };
};

const downloadImage = async (url: string) => {
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

  const { apiKey, prompt } = body;
  if (!apiKey || !prompt) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const response = await fetch("https://chutes-z-image-turbo.chutes.ai/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ prompt }),
  });

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return Response.json(
        { error: data?.error?.message ?? "Image generation failed." },
        { status: response.status }
      );
    }
    return Response.json(
      { error: "Image generation failed." },
      { status: response.status }
    );
  }

  if (contentType.startsWith("image/")) {
    const buffer = await response.arrayBuffer();
    return Response.json({
      images: [
        {
          data: arrayBufferToBase64(buffer),
          mimeType: contentType.split(";")[0] ?? "image/png",
        },
      ],
    });
  }

  let data: any;
  try {
    data = await response.json();
  } catch {
    return Response.json(
      { error: "Unexpected response from Chutes." },
      { status: 502 }
    );
  }
  const { images, urls } = extractFromJson(data);

  if (images.length) {
    return Response.json({ images });
  }

  if (urls.length) {
    const downloaded: ImagePayload[] = [];
    for (const url of urls) {
      downloaded.push(await downloadImage(url));
    }
    return Response.json({ images: downloaded });
  }

  return Response.json(
    { error: "No images were returned by the model." },
    { status: 502 }
  );
}
