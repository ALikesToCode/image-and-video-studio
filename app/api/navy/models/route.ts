export const runtime = "edge";

import { jsonOrNull, providerErrorDetails } from "@/lib/api-safety";
import { groupNavyModelsByCapability } from "@/lib/studio-generation";

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");

  const response = await fetch("https://api.navy/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  const data = await jsonOrNull(response);
  if (data === null) {
    return Response.json(
      { error: "Unable to parse models response." },
      { status: 502 }
    );
  }
  if (!response.ok) {
    return Response.json(
      providerErrorDetails(data, "Unable to fetch models.", {
        knownSecrets: apiKey ? [apiKey] : [],
        response,
      }),
      { status: response.status }
    );
  }

  return Response.json(groupNavyModelsByCapability(data));
}
