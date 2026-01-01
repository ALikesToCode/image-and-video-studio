import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromptInputProps {
    prompt: string;
    setPrompt: (p: string) => void;
    negativePrompt: string;
    setNegativePrompt: (p: string) => void;
    onGenerate: () => void;
    busy: boolean;
    mode: "image" | "video";
}

export function PromptInput({
    prompt,
    setPrompt,
    negativePrompt,
    setNegativePrompt,
    onGenerate,
    busy,
    mode,
}: PromptInputProps) {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            onGenerate();
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Prompt</Label>
                <div className="relative">
                    <Textarea
                        placeholder={
                            mode === "image"
                                ? "Describe the image you want to generate..."
                                : "Describe the video clip you want to create..."
                        }
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="min-h-[120px] resize-none pr-12 text-lg shadow-sm"
                    />
                    <div className="absolute right-3 top-3">
                        <Sparkles className="h-5 w-5 text-muted-foreground opacity-20" />
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Negative Prompt (Optional)</Label>
                <Textarea
                    placeholder="What to exclude..."
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    className="min-h-[40px] h-[40px] resize-none text-sm placeholder:text-xs"
                />
            </div>

            <Button
                size="lg"
                className="w-full bg-gradient-to-r from-primary to-primary/80 transition-all hover:scale-[1.01] hover:shadow-lg"
                onClick={onGenerate}
                disabled={busy || !prompt.trim()}
            >
                {busy ? (
                    <>
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        Generating...
                    </>
                ) : (
                    <>
                        <Wand2 className="mr-2 h-5 w-5" />
                        Generate {mode === "image" ? "Image" : "Video"}
                    </>
                )}
            </Button>
            <div className="text-center text-xs text-muted-foreground">
                Press <kbd className="font-mono">Cmd+Enter</kbd> to generate
            </div>
        </div>
    );
}
