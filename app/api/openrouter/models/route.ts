export const runtime = "edge";

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

  const response = await fetch(targetUrl.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Unable to fetch models." },
      { status: response.status }
    );
  }

  return Response.json(data);
}
