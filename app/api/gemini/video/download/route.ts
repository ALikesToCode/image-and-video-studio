export const runtime = "edge";

type DownloadRequest = {
  apiKey: string;
  uri: string;
};

export async function POST(req: Request) {
  let body: DownloadRequest;
  try {
    body = (await req.json()) as DownloadRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const { apiKey, uri } = body;
  if (!apiKey || !uri) {
    return Response.json({ error: "Missing API key or URI." }, { status: 400 });
  }

  const response = await fetch(uri, {
    headers: {
      "x-goog-api-key": apiKey,
    },
  });

  if (!response.ok) {
    return Response.json(
      { error: "Unable to download the video." },
      { status: response.status }
    );
  }

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "video/mp4",
    },
  });
}
