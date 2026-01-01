export const runtime = "edge";

type TtsRequest = {
  apiKey: string;
  model: string;
  input: string;
  voice: string;
  speed?: number;
  responseFormat?: string;
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

export async function POST(req: Request) {
  let body: TtsRequest;
  try {
    body = (await req.json()) as TtsRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, model, input, voice, speed, responseFormat } = body;
  if (!apiKey || !model || !input || !voice) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const response = await fetch("https://api.navy/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input,
      voice,
      ...(typeof speed === "number" ? { speed } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    }),
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = await response.json();
      return Response.json(
        { error: data?.error?.message ?? "Speech generation failed." },
        { status: response.status }
      );
    }
    return Response.json(
      { error: "Speech generation failed." },
      { status: response.status }
    );
  }

  const contentType = response.headers.get("content-type") ?? "audio/mpeg";
  const buffer = await response.arrayBuffer();
  return Response.json({
    audio: {
      data: arrayBufferToBase64(buffer),
      mimeType: contentType.split(";")[0] ?? "audio/mpeg",
    },
  });
}
