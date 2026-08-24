export const dynamic = "force-dynamic";

import {
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  parseVideoJobPayload,
  readUpstreamErrorDetails,
  resolveMultiLlmApiKey,
  type MultiLlmMediaSource,
} from "@/lib/multillm-proxy";
import { shouldAttachNavyAuth } from "@/lib/server/navy-media";
import { safeFetchExternalMedia } from "@/lib/server/safe-fetch";

type DownloadRequest = {
  id?: string;
  source?: MultiLlmMediaSource;
};

const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000;

const isMediaSource = (value: unknown): value is MultiLlmMediaSource =>
  value === "navyai" || value === "nanogpt";

const statusUrl = (
  baseUrl: string,
  source: MultiLlmMediaSource,
  id: string
) =>
  source === "navyai"
    ? `${baseUrl}/navyai/v1/images/generations/${encodeURIComponent(id)}`
    : `${baseUrl}/nanogpt/video/status?requestId=${encodeURIComponent(id)}`;

export async function POST(request: Request) {
  let body: DownloadRequest;
  try {
    body = (await request.json()) as DownloadRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  const source = body.source;
  const apiKey = resolveMultiLlmApiKey(request);
  if (!apiKey || !id || !isMediaSource(source)) {
    return Response.json(
      { error: "A valid job id, source, and MultiLLM API key are required." },
      { status: 400 }
    );
  }

  const baseUrl = getMultiLlmProxyBaseUrl();
  const statusResponse = await fetch(statusUrl(baseUrl, source, id), {
    headers: multiLlmAuthorizationHeaders(apiKey),
    cache: "no-store",
    signal: request.signal,
  });
  if (!statusResponse.ok) {
    return Response.json(
      await readUpstreamErrorDetails(
        statusResponse,
        "Unable to fetch the video job.",
        [apiKey]
      ),
      { status: statusResponse.status }
    );
  }

  const parsed = parseVideoJobPayload(await statusResponse.json());
  if (!parsed.done) {
    return Response.json(
      { error: "MultiLLM video is not ready yet." },
      { status: 409 }
    );
  }
  if (parsed.error || !parsed.videoUrl) {
    return Response.json(
      { error: parsed.error ?? "Completed video job did not include a URL." },
      { status: 502 }
    );
  }

  let mediaUrl: URL;
  try {
    mediaUrl = new URL(parsed.videoUrl);
  } catch {
    return Response.json(
      { error: "MultiLLM returned an invalid video URL." },
      { status: 502 }
    );
  }

  const proxyHost = new URL(baseUrl).hostname;
  const attachAuthorization =
    mediaUrl.hostname === proxyHost ||
    (source === "navyai" && shouldAttachNavyAuth(mediaUrl));
  try {
    const mediaResponse = await safeFetchExternalMedia(mediaUrl.toString(), {
      allowedHosts: [mediaUrl.hostname],
      allowedContentTypes: ["video/"],
      maxBytes: MAX_VIDEO_BYTES,
      timeoutMs: VIDEO_DOWNLOAD_TIMEOUT_MS,
      allowRedirects: true,
      ...(attachAuthorization
        ? { headers: multiLlmAuthorizationHeaders(apiKey) }
        : {}),
    });
    const contentType =
      mediaResponse.headers.get("content-type") ?? "video/mp4";
    const contentLength = mediaResponse.headers.get("content-length");
    return new Response(mediaResponse.body, {
      headers: {
        "Content-Type": contentType,
        ...(contentLength ? { "Content-Length": contentLength } : {}),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Unable to download the completed MultiLLM video." },
      { status: 502 }
    );
  }
}
