import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { apiKey, prompt, voice, speed } = body;

        if (!apiKey) {
            return NextResponse.json({ error: "Missing API key" }, { status: 401 });
        }

        if (!prompt) {
            return NextResponse.json({ error: "Text prompt is required" }, { status: 400 });
        }

        // Try OpenAI compatible endpoint on Chutes Kokoro deployment
        // Pattern: https://[slug].chutes.ai/v1/audio/speech
        // Slug guess: chutes-kokoro-82m
        const url = "https://chutes-kokoro-82m.chutes.ai/v1/audio/speech";

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "kokoro",
                input: prompt,
                voice: voice || "af_bella",
                speed: Number(speed) || 1.0,
                response_format: "mp3" // or 'wav'
            }),
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
                "Content-Type": "audio/mpeg",
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
