import {
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  multiLlmErrorMessage,
  readUpstreamError,
  resolveMultiLlmApiKey,
  type MultiLlmMediaSource,
  type MultiLlmModelKind,
} from "@/lib/multillm-proxy";
import { mergeImageModelOptionLists } from "@/lib/model-options";
import { readJsonResponse } from "@/lib/server/json-body";
import { normalizeMultiLlmMediaCatalog } from "@/lib/multillm-media-catalog";

export const dynamic = "force-dynamic";

type CatalogTarget = {
  source?: MultiLlmMediaSource;
  path: string;
  assumeKind?: boolean;
  idPrefix?: string;
  requireDeclaredImageOutput?: boolean;
};

const catalogTargets: Record<MultiLlmModelKind, CatalogTarget[]> = {
  chat: [{ path: "/v1/models" }],
  image: [
    {
      path: "/v1/models",
      requireDeclaredImageOutput: true,
    },
    { source: "navyai", path: "/navyai/v1/models" },
    { source: "linkapi", path: "/linkapi/v1/models" },
    {
      source: "nanogpt",
      path: "/nanogpt/v1/image-models?detailed=true",
    },
  ],
  video: [
    { source: "navyai", path: "/navyai/v1/models" },
    {
      source: "nanogpt",
      path: "/nanogpt/v1/video-models?detailed=true",
      assumeKind: true,
    },
  ],
  audio: [
    { source: "navyai", path: "/navyai/v1/models" },
  ],
};

const isModelKind = (value: string): value is MultiLlmModelKind =>
  value === "chat" ||
  value === "image" ||
  value === "video" ||
  value === "audio";

export async function GET(request: Request) {
  const kindParam = new URL(request.url).searchParams.get("kind") ?? "chat";
  if (!isModelKind(kindParam)) {
    return Response.json(
      { error: "kind must be chat, image, video, or audio." },
      { status: 400 }
    );
  }

  const apiKey = resolveMultiLlmApiKey(request);
  if (!apiKey) {
    return Response.json(
      {
        error:
          "Missing MultiLLM API key. Add it in Settings or set MULTILLM_API_KEY on the server.",
      },
      { status: 400 }
    );
  }

  const baseUrl = getMultiLlmProxyBaseUrl();
  // A media catalog can be partially available, so one provider failure must
  // not hide healthy models from the other provider.
  const settled = await Promise.all(
    catalogTargets[kindParam].map(async (target) => {
      try {
        const response = await fetch(`${baseUrl}${target.path}`, {
          headers: multiLlmAuthorizationHeaders(apiKey),
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) {
          throw new Error(
            await readUpstreamError(
              response,
              "Unable to fetch model catalog.",
              [apiKey]
            )
          );
        }
        const payload = await readJsonResponse(response, 8 * 1024 * 1024);
        return {
          status: "fulfilled" as const,
          models: normalizeMultiLlmMediaCatalog(payload, {
            source: target.source,
            kind: kindParam === "chat" ? undefined : kindParam,
            assumeKind: target.assumeKind,
            idPrefix: target.idPrefix,
            requireDeclaredImageOutput: target.requireDeclaredImageOutput,
          }),
        };
      } catch (error) {
        return {
          status: "rejected" as const,
          source: target.source ?? "unified",
          error: multiLlmErrorMessage(
            error,
            "Unable to fetch model catalog.",
            apiKey
          ),
        };
      }
    })
  );

  const discoveredModels = settled.flatMap((entry) =>
    entry.status === "fulfilled" ? entry.models : []
  );
  const models =
    kindParam === "image"
      ? mergeImageModelOptionLists([discoveredModels])
      : discoveredModels;
  const warnings = settled.flatMap((entry) =>
    entry.status === "rejected"
      ? [`${entry.source}: ${entry.error}`]
      : []
  );

  if (!models.length && warnings.length) {
    return Response.json({ error: warnings.join(" ") }, { status: 502 });
  }

  return Response.json(
    { models, warnings, failedSources: settled.flatMap((entry) => entry.status === "rejected" ? [entry.source] : []) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
