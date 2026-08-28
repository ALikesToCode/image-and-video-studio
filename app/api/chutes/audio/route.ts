import { NextResponse } from "next/server";
import { getUserApiKey, redactSecrets } from "@/lib/api-safety";
import { AUDIO_MIME_TYPES } from "@/lib/studio-validation";
import { proxyBoundedMediaResponse } from "@/lib/server/media-response";
import {
    JsonBodyError,
    jsonBodyErrorDetails,
    readJsonRequestObject,
} from "@/lib/server/json-body";

const MAX_AUDIO_BYTES = 64 * 1024 * 1024;

export async function POST(req: Request) {
    try {
        const body = await readJsonRequestObject<Record<string, unknown>>(req);
        const { prompt, text, model, speed, speaker, maxDuration } = body;
        const apiKey = getUserApiKey(req, body);

        if (!apiKey) {
            return NextResponse.json({ error: "Missing API key" }, { status: 401 });
        }

        const resolvedText =
            typeof text === "string" && text.trim().length
                ? text.trim()
                : typeof prompt === "string"
                    ? prompt.trim()
                    : "";

        if (!resolvedText) {
            return NextResponse.json({ error: "Text prompt is required" }, { status: 400 });
        }

        const normalizedModel =
            typeof model === "string" && model.trim().length
                ? model.trim().toLowerCase()
                : "kokoro";
        const isCsm =
            normalizedModel === "csm-1b" || normalizedModel.includes("csm-1b");
        const url = isCsm
            ? "https://chutes-csm-1b.chutes.ai/speak"
            : "https://chutes-kokoro.chutes.ai/speak";

        const payload = isCsm
            ? {
                  text: resolvedText,
                  speaker:
                      typeof speaker === "number"
                          ? speaker
                          : Number.parseInt(String(speaker), 10) || 1,
                  max_duration_ms:
                      typeof maxDuration === "number"
                          ? maxDuration
                          : Number.parseInt(String(maxDuration), 10) || 10000,
              }
            : {
                  text: resolvedText,
                  speed: typeof speed === "number" ? speed : Number(speed) || 1,
              };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { error: redactSecrets(errorText || "Chutes audio generation failed.", [apiKey]) },
                { status: response.status }
            );
        }

        try {
            return proxyBoundedMediaResponse(response, {
                allowedContentTypes: AUDIO_MIME_TYPES,
                maxBytes: MAX_AUDIO_BYTES,
            });
        } catch {
            return NextResponse.json(
                { error: "Chutes returned invalid audio data." },
                { status: 502 }
            );
        }

    } catch (error) {
        if (error instanceof JsonBodyError) {
            const details = jsonBodyErrorDetails(error);
            return NextResponse.json(
                { error: details.error },
                { status: details.status }
            );
        }
        return NextResponse.json(
            { error: redactSecrets(error, []) || "Internal Server Error" },
            { status: 500 }
        );
    }
}
