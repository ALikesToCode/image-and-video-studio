import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { apiKey, prompt, image, fps, guidance_scale_2, model } = body;

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
            const errorText = await response.text();
            return NextResponse.json({ error: `Chutes API Error: ${errorText}` }, { status: response.status });
        }

        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
            const data = await response.json();
            return NextResponse.json(data);
        }

        const buffer = await response.arrayBuffer();
        return new NextResponse(buffer, {
            headers: {
                "Content-Type": contentType || "video/mp4",
                "Content-Length": buffer.byteLength.toString(),
            },
        });

    } catch (error) {
        console.error("Video generation error:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
