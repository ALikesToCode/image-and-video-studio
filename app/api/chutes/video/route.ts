import { NextResponse } from "next/server";
import { getUserApiKey, redactSecrets } from "@/lib/api-safety";
import { proxyBoundedMediaResponse } from "@/lib/server/media-response";
import { VIDEO_MIME_TYPES } from "@/lib/studio-validation";
import {
    MAX_UPSTREAM_ERROR_BYTES,
    JsonBodyError,
    jsonBodyErrorDetails,
    readBoundedTextBody,
    readJsonResponse,
    readJsonRequestObject,
} from "@/lib/server/json-body";

const MAX_VIDEO_BYTES = 256 * 1024 * 1024;

export async function POST(req: Request) {
    try {
        const body = await readJsonRequestObject<Record<string, unknown>>(req);
        const { prompt, image, fps, guidance_scale_2, model } = body;
        const apiKey = getUserApiKey(req, body);

        if (!apiKey) {
            return NextResponse.json({ error: "Missing API key" }, { status: 401 });
        }

        if (!prompt || !image) {
            return NextResponse.json({ error: "Prompt and Source Image are required" }, { status: 400 });
        }

        const normalizedModel =
            typeof model === "string" && model.trim().length
                ? model.trim().toLowerCase()
                : "wan-2-2-i2v-14b-fast";

        let url = "https://chutes-wan-2-2-i2v-14b-fast.chutes.ai/generate";
        if (normalizedModel.includes("wan-2-2-i2v-14b-fast")) {
            url = "https://chutes-wan-2-2-i2v-14b-fast.chutes.ai/generate";
        }

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt,
                image,
                fps: typeof fps === "number" ? fps : Number(fps) || 16,
                guidance_scale_2:
                    typeof guidance_scale_2 === "number"
                        ? guidance_scale_2
                        : Number(guidance_scale_2) || 1,
            }),
        });

        if (!response.ok) {
            const errorText = await readBoundedTextBody(
                response,
                MAX_UPSTREAM_ERROR_BYTES
            ).catch(() => "");
            return NextResponse.json(
                { error: redactSecrets(errorText || "Chutes video generation failed.", [apiKey]) },
                { status: response.status }
            );
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            try {
                return NextResponse.json(await readJsonResponse(response));
            } catch {
                return NextResponse.json(
                    { error: "Chutes returned invalid video data." },
                    { status: 502 }
                );
            }
        }

        try {
            return proxyBoundedMediaResponse(response, {
                allowedContentTypes: VIDEO_MIME_TYPES,
                maxBytes: MAX_VIDEO_BYTES,
            });
        } catch {
            return NextResponse.json(
                { error: "Chutes returned invalid video data." },
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
