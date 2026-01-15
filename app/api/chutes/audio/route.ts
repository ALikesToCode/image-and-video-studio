import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { apiKey, prompt, text, model, speed, speaker, maxDuration } = body;

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
                          : Number.parseInt(speaker, 10) || 1,
                  max_duration_ms:
                      typeof maxDuration === "number"
                          ? maxDuration
                          : Number.parseInt(maxDuration, 10) || 10000,
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
            return NextResponse.json({ error: `Chutes API Error: ${errorText}` }, { status: response.status });
        }

        // Return the audio file (stream)
        // We can proxy the blob directly
        const audioBlob = await response.blob();

        // Convert to ArrayBuffer to send via Next.js Response
        const buffer = await audioBlob.arrayBuffer();

        return new NextResponse(buffer, {
            headers: {
                "Content-Type": response.headers.get("content-type") ?? "audio/mpeg",
                "Content-Length": buffer.byteLength.toString(),
            },
        });

    } catch (error) {
        console.error("Audio generation error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
