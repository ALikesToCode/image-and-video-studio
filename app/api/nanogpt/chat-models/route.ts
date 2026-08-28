import { getProviderApiKey, providerErrorDetails } from "@/lib/api-safety";
import {
  normalizeNanoGptChatMeta,
  normalizeNanoGptChatModels,
} from "@/lib/nanogpt-chat";
import { readJsonResponse } from "@/lib/server/json-body";

const CATALOG_URL = "https://nano-gpt.com/api/v1/models";
const PUBLIC_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=3600";
const PRIVATE_CACHE_CONTROL = "private, no-store";

const responseHeaders = (authenticated: boolean) => ({
  "Cache-Control": authenticated ? PRIVATE_CACHE_CONTROL : PUBLIC_CACHE_CONTROL,
  Vary: "Authorization, x-user-api-key",
});

export async function GET(req: Request) {
  const apiKey = getProviderApiKey("nanogpt", req);
  const authenticated = Boolean(apiKey);
  const sort = authenticated ? "favorites" : "mostused";
  const url = new URL(CATALOG_URL);
  url.searchParams.set("detailed", "true");
  url.searchParams.set("sort", sort);

  const headers = new Headers({ Accept: "application/json" });
  if (apiKey) headers.set("Authorization", `Bearer ${apiKey}`);

  let response: Response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    return Response.json(
      providerErrorDetails(
        error,
        "Unable to fetch NanoGPT text model catalog.",
        { knownSecrets: apiKey ? [apiKey] : [] },
      ),
      { status: 502, headers: responseHeaders(authenticated) },
    );
  }

  let payload: unknown;
  try {
    payload = await readJsonResponse(response, 8 * 1024 * 1024);
  } catch {
    if (!response.ok) {
      return Response.json(
        providerErrorDetails(
          null,
          "Unable to fetch NanoGPT text model catalog.",
          {
            knownSecrets: apiKey ? [apiKey] : [],
            response,
          },
        ),
        {
          status: response.status,
          headers: responseHeaders(authenticated),
        },
      );
    }
    return Response.json(
      { error: "Unable to parse NanoGPT text model catalog." },
      { status: 502, headers: responseHeaders(authenticated) },
    );
  }

  if (!response.ok) {
    return Response.json(
      providerErrorDetails(
        payload,
        "Unable to fetch NanoGPT text model catalog.",
        {
          knownSecrets: apiKey ? [apiKey] : [],
          response,
        },
      ),
      {
        status: response.status,
        headers: responseHeaders(authenticated),
      },
    );
  }

  const meta = normalizeNanoGptChatMeta(payload);
  return Response.json(
    {
      models: normalizeNanoGptChatModels(payload),
      sort,
      authenticated,
      ...(meta ? { meta } : {}),
    },
    { headers: responseHeaders(authenticated) },
  );
}
