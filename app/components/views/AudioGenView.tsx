"use client";

import { useStudio } from "@/app/contexts/StudioContext";
import { useEffect, useRef } from "react";
import { ImgGenSettings } from "../img-gen-settings";
import { PromptInput } from "@/app/components/prompt-input";
import { Button } from "@/app/components/ui/button";
import { Loader2, Music, Download, AudioLines, Settings2 } from "lucide-react";
import { Card } from "@/app/components/ui/card";
import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";

export function AudioGenView() {
    const context = useStudio();
    const {
        setMode, mode,
        audioUrl,
        hasActiveJobs,
        statusMessage
    } = context;

    const audioRef = useRef<HTMLAudioElement>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);

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
        <div className="flex h-full flex-col lg:flex-row">
            {/* Sidebar Settings */}
            <div className="hidden w-[320px] flex-none border-r bg-background/50 p-6 overflow-y-auto lg:block">
                <ImgGenSettings
                    {...context}
                    onRefreshModels={context.refreshModels}
                    modelsLoading={context.modelsLoading}
                    modelsError={context.modelsError}
                />
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-0 bg-background/50 relative isolate">
                <header className="glass flex flex-none items-center justify-between gap-3 border-b p-3 sm:p-6">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <AudioLines className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold sm:text-lg">Audio / TTS</h2>
                            <p className="truncate text-xs text-muted-foreground lg:hidden">
                                Voice, format, speed, and prompt
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 lg:hidden"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Settings2 className="mr-2 h-4 w-4" />
                        Settings
                    </Button>
                </header>
                <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                    <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-xl">
                        <DialogHeader>
                            <DialogTitle>Audio settings</DialogTitle>
                            <DialogDescription>
                                Configure provider, voice, output format, speed, and storage.
                            </DialogDescription>
                        </DialogHeader>
                        <ImgGenSettings
                            {...context}
                            onRefreshModels={context.refreshModels}
                            modelsLoading={context.modelsLoading}
                            modelsError={context.modelsError}
                        />
                    </DialogContent>
                </Dialog>

                <div className="flex flex-1 flex-col items-center justify-start space-y-5 overflow-y-auto p-3 sm:p-6 md:justify-center md:space-y-8 md:p-8">
                    {hasActiveJobs ? (
                        <div className="flex flex-col items-center justify-center space-y-4 animate-pulse">
                            <div className="rounded-full bg-primary/10 p-8">
                                <Loader2 className="h-12 w-12 animate-spin text-primary" />
                            </div>
                            <p className="text-lg font-medium text-muted-foreground">{statusMessage || "Generating audio..."}</p>
                        </div>
                    ) : audioUrl ? (
                        <Card className="glass-card p-5 sm:p-8 w-full max-w-2xl flex flex-col items-center space-y-5 sm:space-y-6">
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
                <div className="glass-panel z-10 mt-auto border-t border-white/10 bg-background/50 p-3 backdrop-blur-xl md:p-6">
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
        </div>
    );
}
