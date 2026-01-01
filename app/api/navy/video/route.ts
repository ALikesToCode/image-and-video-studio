export const runtime = "edge";

type VideoRequest = {
  apiKey: string;
  model: string;
  prompt: string;
};

export async function POST(req: Request) {
  let body: VideoRequest;
  try {
    body = (await req.json()) as VideoRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, model, prompt } = body;
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
      sync: false,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Video generation failed." },
      { status: response.status }
    );
  }

  if (!data?.id) {
    return Response.json(
      { error: "No job id returned by NavyAI." },
      { status: 502 }
    );
  }

  return Response.json({ id: data.id });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const apiKey = req.headers.get("x-user-api-key");

  if (!id || !apiKey) {
    return Response.json({ error: "Missing job id or API key." }, { status: 400 });
  }

  const response = await fetch(`https://api.navy/v1/images/generations/${id}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }
  );

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Unable to fetch job." },
      { status: response.status }
    );
  }

  if (data.status && data.status !== "completed") {
    return Response.json({ done: false, status: data.status });
  }

  const result = data.result ?? data;
  const url = result?.data?.[0]?.url;

  if (!url) {
    return Response.json(
      { done: true, error: "Video URL not found in response." },
      { status: 502 }
    );
  }

  return Response.json({ done: true, videoUrl: url });
}
