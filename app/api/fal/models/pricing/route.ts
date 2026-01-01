export const runtime = "edge";

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
  const response = await fetch(targetUrl.toString(), {
    headers: {
      Authorization: `Key ${apiKey}`,
    },
  });

  const data = await response.json();
  if (!response.ok) {
    return Response.json(
      { error: data?.error?.message ?? "Unable to fetch pricing." },
      { status: response.status }
    );
  }

  return Response.json(data);
}
