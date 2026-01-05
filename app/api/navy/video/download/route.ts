export const runtime = "edge";

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const url = body.url;
  if (!url) {
    return Response.json({ error: "Missing video URL." }, { status: 400 });
  }

  const apiKey = req.headers.get("x-user-api-key");
  const response = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  if (!response.ok) {
    return Response.json(
      { error: "Unable to download the rendered video." },
      { status: response.status }
    );
  }

  const contentType =
    response.headers.get("content-type") ?? "video/mp4";

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
    },
  });
}
