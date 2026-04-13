export const runtime = "edge";

import { groupNavyModelsByCapability } from "@/lib/studio-generation";

export async function GET(req: Request) {
  const apiKey = req.headers.get("x-user-api-key");

  const response = await fetch("https://api.navy/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return Response.json(
      { error: "Unable to parse models response." },
      { status: 502 }
    );
  }
  if (!response.ok) {
    const root =
      data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const error =
      root.error && typeof root.error === "object"
        ? (root.error as Record<string, unknown>).message
        : root.error;
    return Response.json(
      {
        error: typeof error === "string" ? error : "Unable to fetch models.",
      },
      { status: response.status }
    );
  }

  return Response.json(groupNavyModelsByCapability(data));
}
