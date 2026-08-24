import { providerErrorDetails, redactSecrets } from "@/lib/api-safety";

const NAVY_MODEL_STATUS_URL = "https://api.navy/v1/models/status";
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
const MAX_REQUESTED_MODEL_IDS = 50;
const MODEL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]*(?:\/[A-Za-z0-9][A-Za-z0-9._:-]*)*$/;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const finiteNumberOrNull = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringOrNull = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null;

const parseRequestedModelIds = (requestUrl: string) => {
  const searchParams = new URL(requestUrl).searchParams;
  if (!searchParams.has("ids")) return { ids: null } as const;

  const values = searchParams.getAll("ids");
  const ids =
    values.length === 1
      ? values[0].split(",").map((id) => id.trim())
      : [];
  if (
    ids.length === 0 ||
    ids.length > MAX_REQUESTED_MODEL_IDS ||
    ids.some((id) => !id || id.length > 128 || !MODEL_ID_PATTERN.test(id))
  ) {
    return {
      error: "Navy model IDs must be a comma-separated list of valid IDs.",
    } as const;
  }

  return { ids: [...new Set(ids)] } as const;
};

const compactModelStatus = (id: string, value: unknown) => {
  const status = asRecord(value);
  if (!status) return null;

  const stats = asRecord(status.stats);
  const lastError = stringOrNull(status.lastError);

  return {
    id,
    endpoint: stringOrNull(status.endpoint),
    status: stringOrNull(status.lastStatus),
    lastChecked: stringOrNull(status.lastChecked),
    inProgress:
      typeof status.inProgress === "boolean" ? status.inProgress : null,
    uptimePercent: finiteNumberOrNull(stats?.uptimePercent),
    checksCount: finiteNumberOrNull(stats?.checksCount),
    okCount: finiteNumberOrNull(stats?.okCount),
    avgTtft: finiteNumberOrNull(stats?.avgTtft),
    avgTotal: finiteNumberOrNull(stats?.avgTotal),
    ...(lastError
      ? { error: redactSecrets(lastError).trim().slice(0, 500) }
      : {}),
  };
};

const isMediaStatus = (value: unknown) => {
  const endpoint = stringOrNull(asRecord(value)?.endpoint)?.toLowerCase();
  return Boolean(
    endpoint?.includes("/images/generations") ||
      endpoint?.includes("/videos/generations"),
  );
};

export async function GET(req: Request) {
  const requested = parseRequestedModelIds(req.url);
  if ("error" in requested) {
    return Response.json({ error: requested.error }, { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(NAVY_MODEL_STATUS_URL, {
      headers: { Accept: "application/json" },
    });
  } catch {
    return Response.json(
      { error: "Unable to fetch Navy model status." },
      { status: 502 },
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return Response.json(
      { error: "Unable to parse Navy model status response." },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return Response.json(
      providerErrorDetails(payload, "Unable to fetch Navy model status.", {
        response,
      }),
      { status: response.status },
    );
  }

  const root = asRecord(payload);
  const upstreamModels = asRecord(root?.models);
  if (!root || !upstreamModels) {
    return Response.json(
      { error: "Navy returned an invalid model status response." },
      { status: 502 },
    );
  }

  const candidates = requested.ids
    ? requested.ids
        .map((id) => [id, upstreamModels[id]] as const)
        .filter(
          (entry): entry is readonly [string, unknown] =>
            entry[1] !== undefined,
        )
    : Object.entries(upstreamModels).filter(([, value]) => isMediaStatus(value));
  const models = Object.fromEntries(
    candidates.flatMap(([id, value]) => {
      const summary = compactModelStatus(id, value);
      return summary ? [[id, summary] as const] : [];
    }),
  );

  return Response.json(
    {
      lastUpdated: stringOrNull(root.lastUpdated),
      models,
    },
    { headers: { "Cache-Control": CACHE_CONTROL } },
  );
}
