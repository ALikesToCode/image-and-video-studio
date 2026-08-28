import { providerErrorDetails } from "@/lib/api-safety";
import { readJsonResponse } from "@/lib/server/json-body";

const buildTargetUrl = (req: Request, baseUrl: string) => {
  const incomingUrl = new URL(req.url);
  const targetUrl = new URL(baseUrl);
  incomingUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });
  return targetUrl;
};

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");
  if (!apiKey) {
    return Response.json({ error: "Missing API key." }, { status: 400 });
  }

  const targetUrl = buildTargetUrl(req, "https://api.fal.ai/v1/models/pricing");
  let response: Response;
  try {
    response = await fetch(targetUrl.toString(), {
      headers: {
        Authorization: `Key ${apiKey}`,
      },
    });
  } catch (error) {
    return Response.json(
      providerErrorDetails(error, "Unable to fetch pricing.", {
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
      { error: "Unable to parse model pricing." },
      { status: 502 }
    );
  }
  if (!response.ok) {
    return Response.json(
      providerErrorDetails(data, "Unable to fetch pricing.", {
        knownSecrets: [apiKey],
        response,
      }),
      { status: response.status }
    );
  }

  return Response.json(data);
}
