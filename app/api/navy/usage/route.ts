import { jsonOrNull, providerErrorDetails } from "@/lib/api-safety";

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");
  if (!apiKey) {
    return Response.json({ error: "Missing API key." }, { status: 400 });
  }

  const response = await fetch("https://api.navy/v1/usage", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await jsonOrNull(response);
  if (data === null) {
    return Response.json(
      { error: "Unable to parse Navy usage response." },
      { status: 502 },
    );
  }
  if (!response.ok) {
    return Response.json(
      providerErrorDetails(data, "Unable to fetch usage.", {
        knownSecrets: [apiKey],
        response,
      }),
      { status: response.status }
    );
  }

  return Response.json(data);
}
