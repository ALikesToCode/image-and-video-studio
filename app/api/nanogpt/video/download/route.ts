import {
  getProviderApiKey,
  jsonOrNull,
  providerErrorDetails,
  providerErrorMessage,
} from "@/lib/api-safety";
import {
  jsonBodyErrorDetails,
  readJsonRequestObject,
} from "@/lib/server/json-body";
import {
  safeFetchExternalMedia,
  validateExternalMediaUrl,
} from "@/lib/server/safe-fetch";
import { normalizeNanoGptVideoJobId } from "@/lib/studio-validation";

type UnknownRecord = Record<string, unknown>;

const MAX_VIDEO_BYTES = 256 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;

const asRecord = (value: unknown): UnknownRecord | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;

const nonEmptyString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const normalizedStatus = (value: unknown) =>
  nonEmptyString(value)?.toLowerCase().replace(/[\s-]+/g, "_") ?? "";

const videoUrlFromStatus = (root: UnknownRecord, status: UnknownRecord) => {
  const output = asRecord(status.output) ?? asRecord(root.output);
  const video = asRecord(output?.video);
  return (
    nonEmptyString(video?.url) ??
    nonEmptyString(status.videoUrl) ??
    nonEmptyString(status.video_url) ??
    nonEmptyString(root.videoUrl) ??
    nonEmptyString(root.video_url)
  );
};

const isCompletedStatus = (status: string) =>
  ["complete", "completed", "success", "succeeded"].includes(status);

const isFailedStatus = (status: string) =>
  ["error", "failed", "failure", "canceled", "cancelled"].includes(status);

const statusError = (
  root: UnknownRecord,
  status: UnknownRecord,
  apiKey: string,
  response: Response,
) => {
  const friendlyError =
    nonEmptyString(status.userFriendlyError) ??
    nonEmptyString(root.userFriendlyError);
  const structuredError =
    status.error !== undefined ? status.error : root.error;
  const payload = {
    ...root,
    ...status,
    ...(structuredError !== undefined
      ? { error: structuredError }
      : friendlyError
        ? { error: friendlyError }
        : {}),
  };
  const details = providerErrorDetails(payload, "Video generation failed.", {
    knownSecrets: [apiKey],
    response,
  });
  return {
    ...details,
    ...(friendlyError
      ? {
          error: providerErrorMessage(
            { error: friendlyError },
            details.error,
            [apiKey],
          ),
        }
      : {}),
  };
};

const trustedDownloadUrl = (value: string) => {
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    throw new Error("Invalid video URL.");
  }
  return validateExternalMediaUrl(value, [candidate.hostname]);
};

export async function POST(req: Request) {
  let body: UnknownRecord;
  try {
    body = await readJsonRequestObject<UnknownRecord>(req);
  } catch (error) {
    const details = jsonBodyErrorDetails(error);
    return Response.json({ error: details.error }, { status: details.status });
  }

  const bodyKeys = Object.keys(body);
  if (bodyKeys.some((key) => key !== "id")) {
    return Response.json(
      { error: "Only a NanoGPT video job id is accepted." },
      { status: 400 }
    );
  }

  const jobId = normalizeNanoGptVideoJobId(body.id);
  if (!jobId) {
    return Response.json(
      { error: "Invalid NanoGPT video job id." },
      { status: 400 }
    );
  }

  const apiKey = getProviderApiKey("nanogpt", req);
  if (!apiKey) {
    return Response.json(
      { error: "Missing NanoGPT API key." },
      { status: 400 }
    );
  }

  let statusResponse: Response;
  try {
    statusResponse = await fetch(
      `https://nano-gpt.com/api/video/status?requestId=${encodeURIComponent(jobId)}`,
      {
        headers: { "x-api-key": apiKey },
        redirect: "error",
      }
    );
  } catch (error) {
    return Response.json(
      {
        error: providerErrorMessage(
          error,
          "Unable to fetch NanoGPT video job.",
          [apiKey]
        ),
      },
      { status: 502 }
    );
  }

  const statusPayload = await jsonOrNull(statusResponse);
  if (!statusResponse.ok) {
    const retryAfter = statusResponse.headers.get("retry-after");
    return Response.json(
      providerErrorDetails(statusPayload, "Unable to fetch NanoGPT video job.", {
        knownSecrets: [apiKey],
        response: statusResponse,
      }),
      {
        status: statusResponse.status,
        ...(retryAfter ? { headers: { "Retry-After": retryAfter } } : {}),
      }
    );
  }

  const root = asRecord(statusPayload) ?? {};
  const statusRecord = asRecord(root.data) ?? root;
  const status = normalizedStatus(statusRecord.status ?? root.status);
  if (isFailedStatus(status)) {
    return Response.json(
      statusError(root, statusRecord, apiKey, statusResponse),
      { status: 502 }
    );
  }
  if (!status) {
    return Response.json(
      { error: "NanoGPT returned an invalid video status." },
      { status: 502 }
    );
  }
  if (!isCompletedStatus(status)) {
    return Response.json(
      { error: "NanoGPT video is not ready yet." },
      { status: 409 }
    );
  }

  const videoUrl = videoUrlFromStatus(root, statusRecord);
  if (!videoUrl) {
    return Response.json(
      { error: "NanoGPT completed the job without a video URL." },
      { status: 502 }
    );
  }

  let downloadUrl: URL;
  try {
    downloadUrl = trustedDownloadUrl(videoUrl);
  } catch {
    return Response.json(
      { error: "NanoGPT returned an unsafe video URL." },
      { status: 502 }
    );
  }

  let videoResponse: Response;
  try {
    videoResponse = await safeFetchExternalMedia(downloadUrl.toString(), {
      allowedHosts: [downloadUrl.hostname],
      allowedContentTypes: ["video/"],
      maxBytes: MAX_VIDEO_BYTES,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      allowRedirects: true,
    });
  } catch {
    return Response.json(
      { error: "Unable to download the completed NanoGPT video." },
      { status: 502 }
    );
  }

  const contentType = videoResponse.headers.get("content-type") ?? "video/mp4";
  const contentLength = videoResponse.headers.get("content-length");
  return new Response(videoResponse.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      ...(contentLength ? { "Content-Length": contentLength } : {}),
      "Cache-Control": "private, no-store",
    },
  });
}
