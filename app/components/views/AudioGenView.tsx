"use client";

import { useStudio } from "@/app/contexts/StudioContext";
import { useEffect, useRef } from "react";
import { PromptInput } from "@/app/components/prompt-input";
import { Button } from "@/app/components/ui/button";
import { Loader2, Music, Download } from "lucide-react";
import { Card } from "@/app/components/ui/card";

export function AudioGenView() {
    const context = useStudio();
    const {
        setMode, mode,
        audioUrl,
        hasActiveJobs,
        statusMessage
    } = context;

    const audioRef = useRef<HTMLAudioElement>(null);

    useEffect(() => {
        if (mode !== "tts") setMode("tts");
    }, [mode, setMode]);

    // Auto-play when audioUrl changes? Maybe not for better UX, user can click play.
    useEffect(() => {
        if (audioUrl && audioRef.current) {
            audioRef.current.load();
        }
    }, [audioUrl]);

    return (
        <div className="flex flex-col h-full relative">
            <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col items-center justify-center space-y-8">

                {hasActiveJobs ? (
                    <div className="flex flex-col items-center justify-center space-y-4 animate-pulse">
                        <div className="rounded-full bg-primary/10 p-8">
                            <Loader2 className="h-12 w-12 animate-spin text-primary" />
                        </div>
                        <p className="text-lg font-medium text-muted-foreground">{statusMessage || "Generating audio..."}</p>
                    </div>
                ) : audioUrl ? (
                    <Card className="glass-card p-8 w-full max-w-2xl flex flex-col items-center space-y-6">
                        <div className="rounded-full bg-primary/10 p-6">
                            <Music className="h-12 w-12 text-primary" />
                        </div>
                        <div className="w-full space-y-2 text-center">
                            <h3 className="text-xl font-semibold">Audio Generated</h3>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                                {context.lastOutput?.prompt || "Text-to-Speech Output"}
                            </p>
                        </div>

                        <audio
                            ref={audioRef}
                            controls
                            className="w-full"
                            src={audioUrl}
                        >
                            Your browser does not support the audio element.
                        </audio>

                        <div className="flex gap-2">
                            <Button variant="outline" onClick={() => {
                                const a = document.createElement('a');
                                a.href = audioUrl;
                                a.download = `speech-${Date.now()}.mp3`;
                                document.body.appendChild(a);
                                a.click();
                                document.body.removeChild(a);
                            }}>
                                <Download className="mr-2 h-4 w-4" /> Download
                            </Button>
                        </div>
                    </Card>
                ) : (
                    <div className="text-center space-y-4 text-muted-foreground opacity-50">
                        <Music className="h-24 w-24 mx-auto stroke-1" />
                        <p className="text-lg">Enter text below to generate speech</p>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-4 md:p-6 glass-panel border-t border-white/10 mt-auto z-10 bg-background/50 backdrop-blur-xl">
                <div className="max-w-3xl mx-auto">
                    <PromptInput
                        prompt={context.prompt}
                        setPrompt={context.setPrompt}
                        negativePrompt={context.negativePrompt}
                        setNegativePrompt={context.setNegativePrompt}
                        onGenerate={context.handleGenerate}
                        busy={hasActiveJobs}
                        mode="tts"
                        showNegativePrompt={false}
                    />
                </div>
            </div>
        </div>
    );
}
