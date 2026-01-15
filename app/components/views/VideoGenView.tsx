"use client";
import React, { useRef, useState } from "react";
import { useStudio } from "@/app/contexts/StudioContext";
import { ImgGenSettings } from "../img-gen-settings";
import { PromptInput } from "../prompt-input";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Download, Trash2, Video as VideoIcon, Upload, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";

export function VideoGenView() {
    const context = useStudio();
    const {
        videoUrl,
        lastOutput,
        jobs,
        statusMessage,
        videoImage,
        setVideoImage,
        provider
    } = context;

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const isRunning = jobs.some((job) => job.status === "running" || job.status === "queued");

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    const handleFile = (file: File) => {
        if (!file.type.startsWith("image/")) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            setVideoImage(result);
        };
        reader.readAsDataURL(file);
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const onDragLeave = () => {
        setIsDragging(false);
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    };

    return (
        <div className="flex h-full">
            {/* Sidebar Settings - Pass all props from context */}
            <div className="w-[340px] flex-none border-r bg-background/50 p-6 overflow-y-auto hidden xl:block">
                <ImgGenSettings {...context} />
            </div>

            {/* Main Content */}
            <div className="flex-1 flex flex-col min-h-0 bg-background/50 relative isolate">
                {/* Header (Mobile Settings Toggle could go here) */}
                <header className="flex-none p-6 border-b glass flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <VideoIcon className="h-5 w-5" />
                        </div>
                        <h2 className="font-semibold text-lg">Video Generation</h2>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    {/* Source Image Uploader (Required for Chutes) */}
                    {provider === "chutes" && (
                        <div className="max-w-3xl mx-auto space-y-4">
                            <h3 className="text-sm font-medium text-muted-foreground">Source Image</h3>
                            <div
                                className={cn(
                                    "relative rounded-2xl border-2 border-dashed transition-all duration-300 overflow-hidden",
                                    isDragging ? "border-primary bg-primary/5" : "border-border/50 hover:border-border",
                                    !videoImage ? "aspect-[16/9] flex items-center justify-center cursor-pointer bg-muted/20" : "aspect-auto"
                                )}
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                onClick={() => !videoImage && fileInputRef.current?.click()}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                />

                                {videoImage ? (
                                    <div className="relative group">
                                        <img src={videoImage} alt="Source" className="w-full h-auto max-h-[400px] object-contain mx-auto" />
                                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                                                Change
                                            </Button>
                                            <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); setVideoImage(null); }}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center space-y-2 p-8">
                                        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                                            <Upload className="h-6 w-6 text-muted-foreground" />
                                        </div>
                                        <p className="text-sm font-medium">Click or drag image to upload</p>
                                        <p className="text-xs text-muted-foreground">Required for Image-to-Video</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}


                    {/* Results Area */}
                    <AnimatePresence mode="wait">
                        {videoUrl ? (
                            <motion.div
                                key="result"
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="max-w-3xl mx-auto space-y-4"
                            >
                                <div className="rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/10 relative group bg-black">
                                    <video
                                        src={videoUrl}
                                        controls
                                        loop
                                        autoPlay
                                        className="w-full h-auto max-h-[600px]"
                                    />
                                </div>

                                <div className="flex gap-2 justify-end">
                                    <Button variant="outline" size="sm" onClick={() => window.open(videoUrl, '_blank')}>
                                        <Download className="h-4 w-4 mr-2" />
                                        Download
                                    </Button>
                                    {/* Clear video logic if needed, currently state persists */}
                                </div>
                            </motion.div>
                        ) : (
                            !isRunning && (
                                <motion.div
                                    key="empty"
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    className="flex flex-col items-center justify-center min-h-[300px] text-center space-y-4 text-muted-foreground"
                                >
                                    <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center">
                                        <Sparkles className="h-8 w-8 opacity-50" />
                                    </div>
                                    <p>Select a source image and generate a video.</p>
                                </motion.div>
                            )
                        )}

                        {/* Loading State */}
                        {isRunning && (
                            <motion.div
                                key="loading"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10"
                            >
                                <div className="text-center space-y-4">
                                    <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
                                    <p className="text-lg font-medium animate-pulse">Generating Video...</p>
                                    <p className="text-sm text-muted-foreground max-w-xs">{statusMessage}</p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer Input */}
                <div className="flex-none p-6 glass border-t">
                    <div className="max-w-3xl mx-auto w-full">
                        <PromptInput
                            prompt={context.prompt}
                            setPrompt={context.setPrompt}
                            negativePrompt={context.negativePrompt}
                            setNegativePrompt={context.setNegativePrompt}
                            onGenerate={context.handleGenerate}
                            busy={context.jobs.length > 0}
                            mode={context.mode}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
