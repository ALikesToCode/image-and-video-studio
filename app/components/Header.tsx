import { Palette } from "lucide-react";

export function Header() {
    return (
        <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Palette className="h-4 w-4" />
                    <span className="text-sm font-medium uppercase tracking-widest">
                        Local-First Studio
                    </span>
                </div>
                <h1 className="font-serif text-4xl font-medium tracking-tight text-foreground md:text-5xl lg:text-6xl">
                    Image & Video Studio
                </h1>
                <p className="max-w-2xl text-lg text-muted-foreground">
                    Generate polished images, cinematic clips, and speech with Gemini,
                    NavyAI, OpenRouter, or Chutes. Secure, local, and fast.
                </p>
            </div>

            <div className="flex gap-4 rounded-xl border bg-card/50 p-4 text-sm shadow-sm backdrop-blur-sm">
                <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Runtime</span>
                    <span className="font-semibold">Edge-first</span>
                </div>
                <div className="h-full w-px bg-border" />
                <div className="flex flex-col gap-1">
                    <span className="text-muted-foreground">Storage</span>
                    <span className="font-semibold">Local only</span>
                </div>
            </div>
        </header>
    );
}
