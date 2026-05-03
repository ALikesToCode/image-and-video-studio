export const runtime = "edge";

import { safeFetchExternalMedia, validateExternalMediaUrl } from "@/lib/server/safe-fetch";
import { NAVY_MEDIA_HOSTS, shouldAttachNavyAuth } from "@/lib/server/navy-media";

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
  let downloadUrl: URL;
  try {
    downloadUrl = validateExternalMediaUrl(url, NAVY_MEDIA_HOSTS);
  } catch {
    return Response.json({ error: "Invalid video URL." }, { status: 400 });
  }

  const apiKey = req.headers.get("x-user-api-key");
  let response: Response;
  try {
    response = await safeFetchExternalMedia(downloadUrl.toString(), {
      allowedHosts: NAVY_MEDIA_HOSTS,
      allowedContentTypes: ["video/"],
      maxBytes: 512 * 1024 * 1024,
      timeoutMs: 60_000,
      allowRedirects: true,
      headers:
        apiKey && shouldAttachNavyAuth(downloadUrl)
          ? { Authorization: `Bearer ${apiKey}` }
          : undefined,
    });
  } catch {
    return Response.json(
      { error: "Unable to download the rendered video." },
      { status: 400 }
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: "Unable to download the rendered video." },
      { status: response.status }
    );
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "video/mp4",
    },
  });
}
