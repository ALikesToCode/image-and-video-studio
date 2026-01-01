export const runtime = "edge";

type VideoRequest = {
  apiKey: string;
  prompt: string;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: string;
  negativePrompt?: string;
};

export async function POST(req: Request) {
  let body: VideoRequest;
  try {
    body = (await req.json()) as VideoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, prompt, model, aspectRatio, resolution, durationSeconds, negativePrompt } =
    body;
  if (!apiKey || !prompt || !model) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;
  const payload = {
    instances: [{ prompt }],
    parameters: {
      ...(aspectRatio ? { aspectRatio } : {}),
      ...(resolution ? { resolution } : {}),
      ...(durationSeconds ? { durationSeconds } : {}),
      ...(negativePrompt ? { negativePrompt } : {}),
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
      { error: data?.error?.message ?? "Video generation failed." },
      { status: response.status }
    );
  }

  if (!data?.name) {
    return Response.json(
      { error: "No operation name returned by Veo." },
      { status: 502 }
    );
  }

  return Response.json({ name: data.name });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  const apiKey = req.headers.get("x-user-api-key");

  if (!name || !apiKey) {
    return Response.json({ error: "Missing operation name or API key." }, { status: 400 });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/${name}`,
    {
      headers: {
        "x-goog-api-key": apiKey,
      },
    }
  );
  const data = await response.json();

  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Unable to fetch operation." },
      { status: response.status }
    );
  }

  if (!data.done) {
    return Response.json({ done: false });
  }

  if (data.error) {
    return Response.json(
      { done: true, error: data.error.message ?? "Video generation failed." },
      { status: 502 }
    );
  }

  const video =
    data?.response?.generateVideoResponse?.generatedSamples?.[0]?.video ?? null;
  const videoUri = video?.uri ?? null;

  if (!videoUri) {
    return Response.json(
      { done: true, error: "Video URL not found in response." },
      { status: 502 }
    );
  }

  return Response.json({ done: true, videoUri });
}
