import { getUserApiKey } from "@/lib/api-safety";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";
import { safeFetchExternalMedia, validateExternalMediaUrl } from "@/lib/server/safe-fetch";

type DownloadRequest = {
  apiKey?: string;
  uri: string;
};

export async function POST(req: Request) {
  let body: DownloadRequest;
  try {
    body = await readJsonRequestObject<DownloadRequest>(req);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return Response.json({ error: details.error }, { status: details.status });
  }

  const { uri } = body;
  const apiKey = getUserApiKey(req, body);
  if (!apiKey || !uri) {
    return Response.json({ error: "Missing API key or URI." }, { status: 400 });
  }
  let downloadUrl: URL;
  try {
    downloadUrl = validateExternalMediaUrl(uri, [
      "generativelanguage.googleapis.com",
    ]);
    if (!downloadUrl.pathname.startsWith("/v1beta/")) {
      throw new Error("Invalid Gemini media path.");
    }
  } catch {
    return Response.json({ error: "Invalid Gemini video URI." }, { status: 400 });
  }

  let response: Response;
  try {
    response = await safeFetchExternalMedia(downloadUrl.toString(), {
      allowedHosts: ["generativelanguage.googleapis.com"],
      allowedContentTypes: ["video/"],
      maxBytes: 512 * 1024 * 1024,
      timeoutMs: 60_000,
      allowRedirects: true,
      headers: {
        "x-goog-api-key": apiKey,
      },
    });
  } catch {
    return Response.json(
      { error: "Unable to download the video." },
      { status: 400 }
    );
  }

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
