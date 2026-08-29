import { getUserApiKey } from "@/lib/api-safety";
import {
  getMultiLlmProxyBaseUrl,
  multiLlmAuthorizationHeaders,
  multiLlmErrorMessage,
  readUpstreamErrorDetails,
} from "@/lib/multillm-proxy";
import {
  normalizeNanoGptBalance,
  normalizeNanoGptSubscription,
  normalizeNanoGptUsage,
  normalizeNavyUsage,
  type MultiLlmUsageResponse,
  type UsageSection,
  type UsageUnavailable,
} from "@/lib/multillm-usage";
import { readJsonResponse } from "@/lib/server/json-body";

export const dynamic = "force-dynamic";

const MAX_USAGE_RESPONSE_BYTES = 512 * 1024;
const MAX_API_KEY_LENGTH = 4_096;
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
} as const;

type UpstreamResult =
  | { status: "fulfilled"; payload: unknown }
  | UsageUnavailable;

const usageJson = (payload: unknown, status = 200) =>
  Response.json(payload, { status, headers: NO_STORE_HEADERS });

const publicOperationsUrl = (baseUrl: string) => {
  const url = new URL(baseUrl);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
};

const fetchUsageSection = async (
  baseUrl: string,
  apiKey: string,
  path: string,
  label: string,
  signal: AbortSignal,
  method: "GET" | "POST" = "GET",
): Promise<UpstreamResult> => {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...multiLlmAuthorizationHeaders(apiKey),
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal,
    });

    if (!response.ok) {
      const details = await readUpstreamErrorDetails(
        response,
        `Unable to fetch ${label}.`,
        [apiKey],
      );
      return {
        status: "unavailable",
        error: details.error,
        statusCode: response.status,
        ...(details.code ? { code: details.code } : {}),
        ...(details.requestId ? { requestId: details.requestId } : {}),
        ...(details.retryAfterMs !== undefined
          ? { retryAfterMs: details.retryAfterMs }
          : {}),
      };
    }

    return {
      status: "fulfilled",
      payload: await readJsonResponse(response, MAX_USAGE_RESPONSE_BYTES),
    };
  } catch (error) {
    return {
      status: "unavailable",
      error: multiLlmErrorMessage(
        error,
        `Unable to fetch ${label}.`,
        apiKey,
      ),
    };
  }
};

const normalizeSection = <T>(
  result: UpstreamResult,
  normalize: (payload: unknown) => T | null,
  invalidResponseError: string,
): UsageSection<T> => {
  if (result.status === "unavailable") return result;
  const data = normalize(result.payload);
  return data
    ? { status: "available", data }
    : { status: "unavailable", error: invalidResponseError };
};

export async function GET(request: Request) {
  // Account balances and quota are private. Never fall back to the deployment's
  // shared server key on this route, even when generation uses that key.
  const apiKey = getUserApiKey(request);
  if (!apiKey) {
    return usageJson(
      {
        error:
          "Add a browser-held MultiLLM API key to view private account usage.",
      },
      401,
    );
  }
  if (apiKey.length > MAX_API_KEY_LENGTH) {
    return usageJson({ error: "MultiLLM API key is too long." }, 400);
  }

  let baseUrl: string;
  try {
    baseUrl = getMultiLlmProxyBaseUrl();
  } catch {
    return usageJson({ error: "MultiLLM proxy configuration is invalid." }, 500);
  }

  const [navyResult, nanoUsageResult, nanoBalanceResult, nanoSubscriptionResult] =
    await Promise.all([
      fetchUsageSection(
        baseUrl,
        apiKey,
        "/navyai/v1/usage",
        "NavyAI usage",
        request.signal,
      ),
      fetchUsageSection(
        baseUrl,
        apiKey,
        "/nanogpt/v1/usage",
        "NanoGPT usage",
        request.signal,
      ),
      fetchUsageSection(
        baseUrl,
        apiKey,
        "/nanogpt/check-balance",
        "NanoGPT balance",
        request.signal,
        "POST",
      ),
      fetchUsageSection(
        baseUrl,
        apiKey,
        "/nanogpt/subscription/v1/usage",
        "NanoGPT subscription usage",
        request.signal,
      ),
    ]);

  const navyai = normalizeSection(
    navyResult,
    normalizeNavyUsage,
    "NavyAI returned an invalid usage response.",
  );
  const nanoUsage = normalizeSection(
    nanoUsageResult,
    normalizeNanoGptUsage,
    "NanoGPT returned an invalid usage response.",
  );
  const nanoBalance = normalizeSection(
    nanoBalanceResult,
    normalizeNanoGptBalance,
    "NanoGPT returned an invalid balance response.",
  );
  const nanoSubscription = normalizeSection(
    nanoSubscriptionResult,
    normalizeNanoGptSubscription,
    "NanoGPT returned an invalid subscription response.",
  );
  const nanoAvailableSections = [
    nanoUsage,
    nanoBalance,
    nanoSubscription,
  ].filter((section) => section.status === "available").length;

  const response: MultiLlmUsageResponse = {
    updatedAt: new Date().toISOString(),
    operationsUrl: publicOperationsUrl(baseUrl),
    navyai,
    nanogpt: {
      status:
        nanoAvailableSections === 3
          ? "available"
          : nanoAvailableSections === 0
            ? "unavailable"
            : "partial",
      usage: nanoUsage,
      balance: nanoBalance,
      subscription: nanoSubscription,
    },
  };

  return usageJson(response);
}
