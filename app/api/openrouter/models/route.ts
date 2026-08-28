import { providerErrorDetails } from "@/lib/api-safety";
import { readJsonResponse } from "@/lib/server/json-body";

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");
  if (!apiKey) {
    return Response.json({ error: "Missing API key." }, { status: 400 });
  }

  const incomingUrl = new URL(req.url);
  const targetUrl = new URL("https://openrouter.ai/api/v1/models");
  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  let response: Response;
  try {
    response = await fetch(targetUrl.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (error) {
    return Response.json(
      providerErrorDetails(error, "Unable to fetch models.", {
        knownSecrets: [apiKey],
      }),
      { status: 502 }
    );
  }

  let data: unknown;
  try {
    data = await readJsonResponse(response, 8 * 1024 * 1024);
  } catch {
    return Response.json(
      { error: "Unable to parse OpenRouter model catalog." },
      { status: 502 }
    );
  }
  if (!response.ok) {
    return Response.json(
      providerErrorDetails(data, "Unable to fetch models.", {
        knownSecrets: [apiKey],
        response,
      }),
      { status: response.status }
    );
  }

  return Response.json(data);
}
