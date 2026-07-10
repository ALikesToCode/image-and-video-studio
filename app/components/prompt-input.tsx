import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import { Textarea } from "@/app/components/ui/textarea";
import { Plus, Sparkles, Wand2 } from "lucide-react";
import { resolveGenerationSubmitState } from "@/lib/generation-ux";

interface PromptInputProps {
    prompt: string;
    setPrompt: (p: string) => void;
    negativePrompt: string;
    setNegativePrompt: (p: string) => void;
    onGenerate: () => void;
    busy: boolean;
    mode: "image" | "video" | "tts";
    showNegativePrompt?: boolean;
}

export function PromptInput({
    prompt,
    setPrompt,
    negativePrompt,
    setNegativePrompt,
    onGenerate,
    busy,
    mode,
    showNegativePrompt = true,
}: PromptInputProps) {
    const submitState = resolveGenerationSubmitState({ prompt, busy, mode });
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
            e.preventDefault();
            onGenerate();
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="studio-generation-prompt">Prompt</Label>
                <div className="relative">
                    <Textarea
                        id="studio-generation-prompt"
                        placeholder={
                            mode === "image"
                                ? "Describe the image you want to generate..."
                                : mode === "video"
                                    ? "Describe the video clip you want to create..."
                                    : "Type the text you want spoken..."
                        }
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="min-h-[96px] resize-none border-border/50 bg-background/50 pr-12 text-base font-light shadow-inner transition-colors focus:border-primary/50 focus:ring-primary/20 sm:min-h-[120px] sm:text-lg"
                    />
                    <div className="absolute right-3 top-3">
                        <Sparkles className="h-5 w-5 text-muted-foreground opacity-20" />
                    </div>
                </div>
            </div>

            {showNegativePrompt ? (
                <div className="space-y-2">
                    <Label htmlFor="studio-negative-prompt" className="text-xs text-muted-foreground">
                        Negative Prompt (Optional)
                    </Label>
                    <Textarea
                        id="studio-negative-prompt"
                        placeholder="What to exclude..."
                        value={negativePrompt}
                        onChange={(e) => setNegativePrompt(e.target.value)}
                        className="min-h-[40px] h-[40px] resize-none text-sm placeholder:text-xs"
                    />
                </div>
            ) : null}

            <Button
                size="lg"
                className="min-h-11 w-full bg-gradient-to-r from-primary to-primary/80 px-4 transition-colors hover:from-primary/90 hover:to-primary/70"
                onClick={onGenerate}
                disabled={submitState.disabled}
            >
                {busy ? (
                    <>
                        <Plus className="mr-2 h-5 w-5" />
                        {submitState.label}
                    </>
                ) : (
                    <>
                        <Wand2 className="mr-2 h-5 w-5" />
                        {submitState.label}
                    </>
                )}
            </Button>
            <div aria-live="polite" className="text-center text-xs text-muted-foreground">
                {busy ? (
                    submitState.hint
                ) : (
                    <>
                        <span className="hidden sm:inline">
                            Press <kbd className="font-mono">Cmd/Ctrl+Enter</kbd> to generate
                        </span>
                        <span className="sm:hidden">Tap Generate to start</span>
                    </>
                )}
            </div>
        </div>
    );
}
