import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { apiKey, prompt, image, fps, guidance_scale_2 } = body;

        if (!apiKey) {
            return NextResponse.json({ error: "Missing API key" }, { status: 401 });
        }

        if (!prompt || !image) {
            return NextResponse.json({ error: "Prompt and Source Image are required" }, { status: 400 });
        }

        const response = await fetch("https://chutes-wan-2-2-i2v-14b-fast.chutes.ai/generate", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt,
                image,
                fps: fps || 16,
                guidance_scale_2: guidance_scale_2 || 5, // Defaulting if not strictly provided, though user said 1 in example
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json({ error: `Chutes API Error: ${errorText}` }, { status: response.status });
        }

        // The API likely returns a JSON with the video URL or base64? 
        // The user didn't specify the response format.
        // Usually Chutes APIs return { images: [...] } or { video: ... } or raw bytes.
        // Let's assume standard Chutes pattern or just return what we get.
        // If it's a stream of bytes (video file), we might want to convert to blob/base64 on client?
        // Let's proxy the JSON response first.
        const data = await response.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error("Video generation error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
