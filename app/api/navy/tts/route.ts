import { getUserApiKey, jsonOrNull, providerErrorMessage } from "@/lib/api-safety";
import { readBoundedMediaBody } from "@/lib/server/media-response";
import { AUDIO_MIME_TYPES } from "@/lib/studio-validation";

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

type TtsRequest = {
  apiKey?: string;
  model: string;
  input: string;
  voice: string;
  speed?: number;
  responseFormat?: string;
};

const bytesToBase64 = (bytes: Uint8Array) => {
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

  const { model, input, voice, speed, responseFormat } = body;
  const userApiKey = getUserApiKey(req, body);
  if (!userApiKey || !model || !input || !voice) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  const response = await fetch("https://api.navy/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${userApiKey}`,
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
      const data = await jsonOrNull(response);
      return Response.json(
        {
          error: providerErrorMessage(data, "Speech generation failed.", [
            userApiKey,
          ]),
        },
        { status: response.status }
      );
    }
    return Response.json(
      { error: "Speech generation failed." },
      { status: response.status }
    );
  }

  let media;
  try {
    media = await readBoundedMediaBody(response, {
      allowedContentTypes: AUDIO_MIME_TYPES,
      maxBytes: MAX_AUDIO_BYTES,
    });
  } catch {
    return Response.json(
      { error: "NavyAI returned invalid audio data." },
      { status: 502 }
    );
  }
  return Response.json({
    audio: {
      data: bytesToBase64(media.bytes),
      mimeType: media.contentType,
    },
  });
}
