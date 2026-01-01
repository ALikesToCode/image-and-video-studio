export const runtime = "edge";

type ImageRequest = {
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  numberOfImages?: number;
  quality?: string;
  style?: string;
};

export async function POST(req: Request) {
  let body: ImageRequest;
  try {
    body = (await req.json()) as ImageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, model, prompt, size, numberOfImages, quality, style } = body;
  if (!apiKey || !model || !prompt) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const response = await fetch("https://api.navy/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      ...(size ? { size } : {}),
      ...(numberOfImages ? { n: numberOfImages } : {}),
      ...(quality ? { quality } : {}),
      ...(style ? { style } : {}),
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Image generation failed." },
      { status: response.status }
    );
  }

  const images = data?.data?.map((item: { url: string }) => ({
    url: item.url,
  }));

  if (!images?.length) {
    return Response.json(
      { error: "No images were returned by the model." },
      { status: 502 }
    );
  }

  return Response.json({ images });
}
