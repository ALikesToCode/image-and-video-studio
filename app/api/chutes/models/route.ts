import { jsonOrNull, providerErrorMessage } from "@/lib/api-safety";

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");
  if (!apiKey) {
    return Response.json({ error: "Missing API key." }, { status: 400 });
  }

  const response = await fetch("https://llm.chutes.ai/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await jsonOrNull(response);
  if (!response.ok) {
    return Response.json(
      { error: providerErrorMessage(data, "Unable to fetch models.", [apiKey]) },
      { status: response.status }
    );
  }

  return Response.json(data);
}
