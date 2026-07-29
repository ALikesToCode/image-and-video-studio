"use client";

/* eslint-disable @next/next/no-img-element */
import React, { useEffect, useRef, useState } from "react";
import { useStudio } from "@/app/contexts/StudioContext";
import { ImgGenSettings } from "../img-gen-settings";
import { PromptInput } from "../prompt-input";
import { ReferenceStrip } from "../reference-strip";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Sparkles, Download, Video as VideoIcon, Upload, X, Settings2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { cn } from "@/lib/utils";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";
import {
    getModelReferenceLimit,
    modelAcceptsImageReferences,
    modelAcceptsSourceImage,
    validateModelImageInputs,
} from "@/lib/model-media-capabilities";

export function VideoGenView() {
    const context = useStudio();
    const {
        videoUrl,
        statusMessage,
        videoImage,
        setVideoImage,
        mode,
        setMode,
    } = context;

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const selectedModel = context.modelSuggestions.find(
        (entry) => entry.id === context.model
    );
    const acceptsSourceImage = modelAcceptsSourceImage(selectedModel);
    const requiresSourceImage =
        selectedModel?.supports?.imageToVideo === true &&
        selectedModel.supports.textToVideo === false;
    const acceptsReferences = modelAcceptsImageReferences(selectedModel);
    const referenceLimit = getModelReferenceLimit(selectedModel);

    useEffect(() => {
        if (mode !== "video") setMode("video");
    }, [mode, setMode]);

    const activeVideoJob = [...context.runningJobs, ...context.queuedJobs].find(
        (job) => job.mode === "video"
    );
    const isRunning = Boolean(activeVideoJob);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    const handleFile = (file: File) => {
        const validationError = validateModelImageInputs(
            selectedModel,
            [{ name: file.name, mimeType: file.type, size: file.size }],
            "source image"
        );
        if (validationError) {
            context.setErrorMessage(validationError);
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const result = e.target?.result as string;
            setVideoImage(result);
            context.setErrorMessage(null);
        };
        reader.onerror = () => context.setErrorMessage("Unable to read the source image.");
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
        <div className="flex h-full flex-col lg:flex-row">
            {/* Sidebar Settings - Pass all props from context */}
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
                {/* Header (Mobile Settings Toggle could go here) */}
                <header className="glass flex flex-none items-center justify-between gap-3 border-b p-3 sm:p-6">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="p-2 rounded-xl bg-primary/10 text-primary">
                            <VideoIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold sm:text-lg">Video Generation</h2>
                            <p className="truncate text-xs text-muted-foreground lg:hidden">
                                Source image, prompt, and render settings
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
                            <DialogTitle>Video settings</DialogTitle>
                            <DialogDescription>
                                Choose provider, video model, aspect ratio, duration, and storage options.
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

                <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-5 sm:space-y-8">
                    {context.errorMessage ? (
                        <div
                            role="alert"
                            className="mx-auto flex max-w-3xl items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                        >
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <p>{context.errorMessage}</p>
                        </div>
                    ) : null}
                    {context.provider === "nanogpt" && context.hiddenNanoGptStandaloneVideoModelCount > 0 ? (
                        <div className="mx-auto flex max-w-3xl items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <p>
                                {context.hiddenNanoGptStandaloneVideoModelCount} NanoGPT model{context.hiddenNanoGptStandaloneVideoModelCount === 1 ? " is" : "s are"} hidden because they require source video or audio input. This studio currently lists text-to-video and image-to-video workflows only.
                            </p>
                        </div>
                    ) : null}
                    <div className="mx-auto max-w-3xl">
                        {acceptsReferences ? (
                            <>
                                <ReferenceStrip
                                    references={context.references}
                                    selectedReferenceIds={context.selectedReferenceIds}
                                    onAddReference={context.addReferenceFile}
                                    onToggleReference={context.toggleReferenceSelection}
                                    onRemoveReference={context.removeReference}
                                    onClearSelected={context.clearSelectedReferences}
                                />
                                {typeof referenceLimit === "number" && referenceLimit > 0 ? (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        Up to {referenceLimit} selected reference image{referenceLimit === 1 ? " is" : "s are"} sent to {selectedModel?.label ?? "this model"}.
                                    </p>
                                ) : null}
                            </>
                        ) : (
                            <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 text-xs text-muted-foreground">
                                {selectedModel?.label ?? "This model"} does not accept reference images.
                            </div>
                        )}
                    </div>

                    {/* Source Image Uploader */}
                    {acceptsSourceImage ? (
                        <div className="mx-auto max-w-3xl space-y-3 sm:space-y-4">
                            <h3 className="text-sm font-medium text-muted-foreground">
                                Source Image {requiresSourceImage ? "(required)" : "(optional)"}
                            </h3>
                            <div
                                className={cn(
                                    "relative overflow-hidden rounded-2xl border-2 border-dashed transition-[background-color,border-color] duration-200",
                                    isDragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/45 hover:bg-primary/5",
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
                                        <div className="absolute inset-0 bg-black/50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                                                Change
                                            </Button>
                                            <Button variant="destructive" size="sm" onClick={(e) => { e.stopPropagation(); setVideoImage(null); }}>
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-2 p-5 text-center sm:p-8">
                                        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-4">
                                            <Upload className="h-6 w-6 text-muted-foreground" />
                                        </div>
                                        <p className="text-sm font-medium">Click or drag image to upload</p>
                                        <p className="text-xs text-muted-foreground">
                                            {requiresSourceImage
                                                ? "This model cannot generate without an image."
                                                : "Used for image-to-video when supported."}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="mx-auto max-w-3xl rounded-xl border border-border/60 bg-secondary/20 p-3 text-sm text-muted-foreground">
                            {selectedModel?.label ?? "This model"} is text-to-video only. The saved source image is retained locally and will not be sent.
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
                                    className="flex min-h-[220px] flex-col items-center justify-center space-y-4 text-center text-muted-foreground sm:min-h-[300px]"
                                >
                                    <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center">
                                        <Sparkles className="h-8 w-8 opacity-50" />
                                    </div>
                                    <p>
                                        {acceptsSourceImage
                                            ? "Optionally add a source image, then generate a video."
                                            : "Describe the video you want to generate."}
                                    </p>
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
                                    <p className="text-sm text-muted-foreground max-w-xs">
                                        {activeVideoJob?.progress || statusMessage}
                                    </p>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                {/* Footer Input */}
                <div className="glass flex-none border-t p-3 sm:p-6">
                    <div className="max-w-3xl mx-auto w-full">
                        <PromptInput
                            prompt={context.prompt}
                            setPrompt={context.setPrompt}
                            negativePrompt={context.negativePrompt}
                            setNegativePrompt={context.setNegativePrompt}
                            onGenerate={context.handleGenerate}
                            busy={isRunning}
                            mode={context.mode}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
