"use client";

/* eslint-disable @next/next/no-img-element */

import { GenerationQueue } from "../generation-queue";
import { useStudio } from "@/app/contexts/StudioContext";
import { ImgGenSettings } from "../img-gen-settings";
import { PromptInput } from "../prompt-input";
import { ReferenceStrip } from "../reference-strip";
import { SettingsDialog } from "../SettingsDialog";
import { ImageViewer } from "../image-viewer";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    AlertTriangle,
    Sparkles,
    Download,
    Trash2,
    Image as ImageIcon,
    Loader2,
    Settings2,
    Maximize2,
    RotateCcw,
    ImagePlus,
    SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { ImageQualityToggle } from "@/app/components/image-quality-toggle";
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
} from "@/lib/model-media-capabilities";
import { mediaExtensionFromMimeType } from "@/lib/media-files";
import {
    describeImageQualityRequest,
    resolveMaximumImageQualityRequest,
} from "@/lib/image-quality";
import type { GeneratedImage } from "@/lib/types";

const IMAGE_PROMPT_STARTERS = [
    "Editorial portrait of a botanist in a glass greenhouse at sunrise, natural skin texture, soft rim light, 85mm lens, restrained green and amber palette",
    "Premium product photograph of a sculptural ceramic speaker on travertine, warm studio light, crisp material detail, clean cream background",
    "Minimalist travel poster for a moonlit mountain railway, bold geometric shapes, deep indigo and coral palette, screen-print texture, no text",
];

const PROVIDER_LABELS = {
    gemini: "Google Gemini",
    navy: "NavyAI",
    chutes: "Chutes",
    openrouter: "OpenRouter",
    nanogpt: "NanoGPT",
    multillm: "MultiLLM Proxy",
} as const;

export function ImageGenView() {
    const context = useStudio();
    const { mode, setMode, generatedImages, setGeneratedImages } = context;
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [activeImage, setActiveImage] = useState<GeneratedImage | null>(null);
    const [referenceLoadingId, setReferenceLoadingId] = useState<string | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const selectedModel = context.modelSuggestions.find(
        (entry) => entry.id === context.model
    );
    const acceptsReferences = modelAcceptsImageReferences(selectedModel);
    const referenceLimit = getModelReferenceLimit(selectedModel);
    const scrollToComposer = () => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        scrollContainerRef.current?.scrollTo({
            top: 0,
            behavior: reduceMotion ? "auto" : "smooth",
        });
    };

    // Force mode to image when entering this view
    useEffect(() => {
        if (mode !== "image") setMode("image");
    }, [mode, setMode]);

    const handleDownload = (image: GeneratedImage) => {
        const link = document.createElement("a");
        link.href = image.dataUrl;
        link.download = `generated-${image.id}.${mediaExtensionFromMimeType(image.mimeType, "image")}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleClear = () => {
        setGeneratedImages([]);
        setClearConfirmOpen(false);
    };

    const reusePrompt = (image: GeneratedImage) => {
        if (!image.prompt?.trim()) return;
        context.setPrompt(image.prompt);
        scrollToComposer();
    };

    const addAsReference = async (image: GeneratedImage) => {
        setReferenceLoadingId(image.id);
        try {
            const response = await fetch(image.dataUrl);
            const blob = await response.blob();
            const mimeType = image.mimeType || blob.type || "image/png";
            const extension = mediaExtensionFromMimeType(mimeType, "image");
            await context.addReferenceFile(
                new File([blob], `generated-${image.id}.${extension}`, { type: mimeType })
            );
            scrollToComposer();
        } catch (error) {
            context.setErrorMessage(
                error instanceof Error ? error.message : "Unable to add the image as a reference."
            );
        } finally {
            setReferenceLoadingId(null);
        }
    };

    const dynamicSize = Object.entries(context.modelParameterValues).find(
        ([key, value]) =>
            /resolution|size|aspect/i.test(key) &&
            (typeof value === "string" || typeof value === "number")
    )?.[1];
    const maximumQualityRequest = resolveMaximumImageQualityRequest({
        enabled: context.preferMaximumImageQuality,
        provider: context.provider,
        model: context.model,
        modelOption: selectedModel,
        request: {
            aspectRatio: context.imageAspect,
            imageSize:
                context.provider === "gemini" || context.provider === "openrouter"
                    ? context.imageSize
                    : undefined,
            size:
                context.provider === "navy" || context.provider === "multillm"
                    ? context.navyImageSize
                    : undefined,
            quality: context.navyImageQuality,
            resolution:
                context.provider === "chutes" || context.provider === "nanogpt"
                    ? context.chutesResolution
                    : undefined,
            width: Number(context.chutesWidth) || undefined,
            height: Number(context.chutesHeight) || undefined,
            parameters: context.modelParameterValues,
        },
    });
    const recipeSize = (() => {
        if (context.preferMaximumImageQuality) {
            return describeImageQualityRequest(maximumQualityRequest);
        }
        if (context.provider === "navy") {
            const size = context.navyImageSize.trim();
            return size && size.toLowerCase() !== "auto" ? size : "Model default";
        }
        if (context.provider === "chutes") {
            if (context.chutesResolution && context.chutesResolution !== "auto") {
                return context.chutesResolution;
            }
            if (context.chutesWidth && context.chutesHeight) {
                return `${context.chutesWidth}×${context.chutesHeight}`;
            }
        }
        if (dynamicSize !== undefined && String(dynamicSize).toLowerCase() !== "auto") {
            return String(dynamicSize);
        }
        if (context.imageSize && context.imageSize !== "auto") return context.imageSize;
        return context.imageAspect && context.imageAspect !== "auto"
            ? context.imageAspect
            : "Model default";
    })();
    const outputCount = selectedModel?.fixedOutputImages ?? context.imageCount;

    return (
        <div ref={scrollContainerRef} className="h-full w-full overflow-y-auto bg-background/50">
            <div className="mx-auto grid min-h-full max-w-[1800px] grid-cols-1 items-start gap-3 p-3 sm:gap-6 sm:p-4 lg:grid-cols-12 lg:p-6">
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/75 p-2 shadow-sm backdrop-blur lg:hidden">
                    <div className="flex min-w-0 items-center gap-2">
                        <div className="rounded-lg bg-primary/10 p-2 text-primary">
                            <ImageIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">Image Generation</p>
                            <p className="truncate text-xs text-muted-foreground">{context.provider}</p>
                        </div>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => setSettingsOpen(true)}
                    >
                        <Settings2 className="h-4 w-4" />
                        Settings
                    </Button>
                </div>
                <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                    <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-xl">
                        <DialogHeader>
                            <DialogTitle>Image settings</DialogTitle>
                            <DialogDescription>
                                Configure provider, model, size, references, and pipeline options.
                            </DialogDescription>
                        </DialogHeader>
                        <ImgGenSettings
                            provider={context.provider}
                            setProvider={context.setProvider}
                            mode={context.mode}
                            setMode={context.setMode}
                            apiKey={context.apiKey}
                            setApiKey={context.setApiKey}
                            clearKey={context.clearKey}
                            supportsVideo={context.supportsVideo}
                            supportsTts={context.supportsTts}
                            model={context.model}
                            setModel={context.setModel}
                            modelSuggestions={context.modelSuggestions}
                            modelParameterValues={context.modelParameterValues}
                            setModelParameterValue={context.setModelParameterValue}
                            modelsLoading={context.modelsLoading}
                            modelsError={context.modelsError}
                            onRefreshModels={context.refreshModels}
                            imageCount={context.imageCount}
                            setImageCount={context.setImageCount}
                            imagePipelineEnabled={context.imagePipelineEnabled}
                            setImagePipelineEnabled={context.setImagePipelineEnabled}
                            imageModelOrder={context.imageModelOrder}
                            setImageModelOrder={context.setImageModelOrder}
                            imageRetryAttempts={context.imageRetryAttempts}
                            setImageRetryAttempts={context.setImageRetryAttempts}
                            imageAspect={context.imageAspect}
                            setImageAspect={context.setImageAspect}
                            imageSize={context.imageSize}
                            setImageSize={context.setImageSize}
                            navyImageSize={context.navyImageSize}
                            setNavyImageSize={context.setNavyImageSize}
                            navyImageQuality={context.navyImageQuality}
                            setNavyImageQuality={context.setNavyImageQuality}
                            chutesGuidanceScale={context.chutesGuidanceScale}
                            setChutesGuidanceScale={context.setChutesGuidanceScale}
                            chutesWidth={context.chutesWidth}
                            setChutesWidth={context.setChutesWidth}
                            chutesHeight={context.chutesHeight}
                            setChutesHeight={context.setChutesHeight}
                            chutesSteps={context.chutesSteps}
                            setChutesSteps={context.setChutesSteps}
                            chutesResolution={context.chutesResolution}
                            setChutesResolution={context.setChutesResolution}
                            chutesSeed={context.chutesSeed}
                            setChutesSeed={context.setChutesSeed}
                            videoAspect={context.videoAspect}
                            setVideoAspect={context.setVideoAspect}
                            videoResolution={context.videoResolution}
                            setVideoResolution={context.setVideoResolution}
                            videoDuration={context.videoDuration}
                            setVideoDuration={context.setVideoDuration}
                            ttsVoice={context.ttsVoice}
                            setTtsVoice={context.setTtsVoice}
                            ttsFormat={context.ttsFormat}
                            setTtsFormat={context.setTtsFormat}
                            ttsSpeed={context.ttsSpeed}
                            setTtsSpeed={context.setTtsSpeed}
                            saveToGallery={context.saveToGallery}
                            setSaveToGallery={context.setSaveToGallery}
                            navyUsage={context.navyUsage}
                            navyUsageError={context.navyUsageError}
                            navyUsageLoading={context.navyUsageLoading}
                            navyUsageUpdatedAt={context.navyUsageUpdatedAt}
                            onRefreshUsage={context.refreshNavyUsage}
                            navyModelHealth={context.navyModelHealth}
                            navyModelHealthError={context.navyModelHealthError}
                            navyModelHealthLoading={context.navyModelHealthLoading}
                            navyModelHealthUpdatedAt={context.navyModelHealthUpdatedAt}
                            refreshNavyModelHealth={context.refreshNavyModelHealth}
                        />
                    </DialogContent>
                </Dialog>
                {/* Settings Column - Collapsible/Sticky */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="hidden space-y-4 lg:sticky lg:top-6 lg:col-span-3 lg:block xl:col-span-3"
                >
                    <ImgGenSettings
                            provider={context.provider}
                            setProvider={context.setProvider}
                            mode={context.mode}
                            setMode={context.setMode}
                            apiKey={context.apiKey}
                            setApiKey={context.setApiKey}
                            clearKey={context.clearKey}
                            supportsVideo={context.supportsVideo}
                            supportsTts={context.supportsTts}
                            model={context.model}
                            setModel={context.setModel}
                            modelSuggestions={context.modelSuggestions}
                            modelParameterValues={context.modelParameterValues}
                            setModelParameterValue={context.setModelParameterValue}
                            modelsLoading={context.modelsLoading}
                            modelsError={context.modelsError}
                            onRefreshModels={context.refreshModels}
                            imageCount={context.imageCount}
                            setImageCount={context.setImageCount}
                            imagePipelineEnabled={context.imagePipelineEnabled}
                            setImagePipelineEnabled={context.setImagePipelineEnabled}
                            imageModelOrder={context.imageModelOrder}
                            setImageModelOrder={context.setImageModelOrder}
                            imageRetryAttempts={context.imageRetryAttempts}
                            setImageRetryAttempts={context.setImageRetryAttempts}
                            imageAspect={context.imageAspect}
                            setImageAspect={context.setImageAspect}
                            imageSize={context.imageSize}
                            setImageSize={context.setImageSize}
                            navyImageSize={context.navyImageSize}
                            setNavyImageSize={context.setNavyImageSize}
                            navyImageQuality={context.navyImageQuality}
                            setNavyImageQuality={context.setNavyImageQuality}
                            chutesGuidanceScale={context.chutesGuidanceScale}
                            setChutesGuidanceScale={context.setChutesGuidanceScale}
                            chutesWidth={context.chutesWidth}
                            setChutesWidth={context.setChutesWidth}
                            chutesHeight={context.chutesHeight}
                            setChutesHeight={context.setChutesHeight}
                            chutesSteps={context.chutesSteps}
                            setChutesSteps={context.setChutesSteps}
                            chutesResolution={context.chutesResolution}
                            setChutesResolution={context.setChutesResolution}
                            chutesSeed={context.chutesSeed}
                            setChutesSeed={context.setChutesSeed}
                            videoAspect={context.videoAspect}
                            setVideoAspect={context.setVideoAspect}
                            videoResolution={context.videoResolution}
                            setVideoResolution={context.setVideoResolution}
                            videoDuration={context.videoDuration}
                            setVideoDuration={context.setVideoDuration}
                            ttsVoice={context.ttsVoice}
                            setTtsVoice={context.setTtsVoice}
                            ttsFormat={context.ttsFormat}
                            setTtsFormat={context.setTtsFormat}
                            ttsSpeed={context.ttsSpeed}
                            setTtsSpeed={context.setTtsSpeed}
                            saveToGallery={context.saveToGallery}
                            setSaveToGallery={context.setSaveToGallery}
                            navyUsage={context.navyUsage}
                            navyUsageError={context.navyUsageError}
                            navyUsageLoading={context.navyUsageLoading}
                            navyUsageUpdatedAt={context.navyUsageUpdatedAt}
                            onRefreshUsage={context.refreshNavyUsage}
                            navyModelHealth={context.navyModelHealth}
                            navyModelHealthError={context.navyModelHealthError}
                            navyModelHealthLoading={context.navyModelHealthLoading}
                            navyModelHealthUpdatedAt={context.navyModelHealthUpdatedAt}
                            refreshNavyModelHealth={context.refreshNavyModelHealth}
                        />
                </motion.div>

                {/* Main Content Column */}
                <div className="flex min-h-0 flex-col space-y-4 lg:col-span-9 lg:min-h-[calc(100vh-3rem)] xl:col-span-9 sm:space-y-6">
                    {/* Input Area */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass-card group relative overflow-hidden rounded-xl p-4 shadow-xl sm:p-6"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        <div className="relative mb-4">
                            {acceptsReferences ? (
                                <>
                                    <ReferenceStrip
                                        references={context.references}
                                        selectedReferenceIds={context.selectedReferenceIds}
                                        onAddReference={context.addReferenceFile}
                                        onToggleReference={context.toggleReferenceSelection}
                                        onRemoveReference={context.removeReference}
                                        onClearSelected={context.clearSelectedReferences}
                                        compact
                                    />
                                    {typeof referenceLimit === "number" && referenceLimit > 0 ? (
                                        <p className="mt-2 text-xs text-muted-foreground">
                                            {selectedModel?.label ?? "This model"} accepts up to {referenceLimit} reference image{referenceLimit === 1 ? "" : "s"}; extra selections are not sent.
                                        </p>
                                    ) : null}
                                </>
                            ) : (
                                <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 text-xs text-muted-foreground">
                                    {selectedModel?.label ?? "This model"} is text-to-image only. Saved references remain in your library but are not sent.
                                </div>
                            )}
                        </div>
                        <div
                            aria-label="Generation recipe"
                            className="relative mb-4 rounded-xl border border-border/60 bg-background/55 p-3"
                        >
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    <SlidersHorizontal className="h-3.5 w-3.5" />
                                    Generation recipe
                                </div>
                                <div className="flex items-center gap-2">
                                    <ImageQualityToggle
                                        enabled={context.preferMaximumImageQuality}
                                        onChange={context.setPreferMaximumImageQuality}
                                        compact
                                    />
                                    {context.activeJobCount > 0 ? (
                                        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            {context.activeJobCount} active
                                        </span>
                                    ) : null}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 text-[11px]">
                                <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                                    {PROVIDER_LABELS[context.provider]}
                                </span>
                                <span
                                    className="max-w-full truncate rounded-full border border-border/60 bg-background/80 px-2.5 py-1 font-medium"
                                    title={selectedModel?.label ?? context.model}
                                >
                                    {selectedModel?.label ?? context.model}
                                </span>
                                <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                                    {recipeSize}
                                </span>
                                <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                                    {outputCount} output{outputCount === 1 ? "" : "s"}
                                    {context.imagePipelineEnabled ? " per model" : ""}
                                </span>
                                <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                                    {context.imagePipelineEnabled
                                        ? `Compare ${Math.max(1, context.imageModelOrder.length)} models`
                                        : "Single model"}
                                </span>
                                <span className="rounded-full border border-border/60 bg-background/80 px-2.5 py-1">
                                    {context.selectedReferenceIds.length} reference{context.selectedReferenceIds.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            {context.activeJobCount > 0 && context.statusMessage ? (
                                <p aria-live="polite" className="mt-2 text-xs text-muted-foreground">
                                    {context.statusMessage}
                                </p>
                            ) : null}
                        </div>
                        <PromptInput
                            prompt={context.prompt}
                            setPrompt={context.setPrompt}
                            negativePrompt={context.negativePrompt}
                            setNegativePrompt={context.setNegativePrompt}
                            onGenerate={context.handleGenerate}
                            busy={context.hasActiveJobs}
                            mode={context.mode}
                            showNegativePrompt={!context.model.toLowerCase().includes("flux")}
                        />

                        {context.errorMessage ? (
                            <div
                                role="alert"
                                className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                            >
                                <div className="flex min-w-0 items-start gap-2">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                    <p className="min-w-0">
                                        {context.errorMessage === "API Key required"
                                            ? "Add a provider API key in Settings before generating."
                                            : context.errorMessage}
                                    </p>
                                </div>
                                {context.errorMessage === "API Key required" ? (
                                    <div className="shrink-0 rounded-lg border border-destructive/20 bg-background/70">
                                        <SettingsDialog />
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        <GenerationQueue />
                    </motion.div>

                    {/* Output Grid */}
                    <div className="glass flex min-h-[240px] flex-1 flex-col gap-4 rounded-xl border p-4 sm:min-h-[400px] sm:p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Sparkles className="h-4 w-4" />
                                <span className="font-medium text-sm">Generated Results</span>
                            </div>
                            {generatedImages.length > 0 && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setClearConfirmOpen(true)}
                                    className="min-h-10 gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    Clear Session
                                </Button>
                            )}
                        </div>

                        <AnimatePresence mode="popLayout">
                            {generatedImages.length === 0 ? (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="flex flex-1 flex-col items-center justify-center gap-4 py-8 text-center"
                                >
                                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:h-20 sm:w-20">
                                        <ImageIcon className="h-8 w-8 sm:h-9 sm:w-9" />
                                    </div>
                                    <div>
                                        <p className="text-base font-semibold text-foreground sm:text-lg">
                                            Start with a clear visual direction
                                        </p>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            Choose a starter, edit it above, then generate with the visible recipe.
                                        </p>
                                    </div>
                                    <div className="grid w-full max-w-3xl grid-cols-1 gap-2 md:grid-cols-3">
                                        {IMAGE_PROMPT_STARTERS.map((starter, index) => (
                                            <button
                                                key={starter}
                                                type="button"
                                                onClick={() => {
                                                    context.setPrompt(starter);
                                                    scrollToComposer();
                                                }}
                                                className="min-h-11 rounded-xl border border-border bg-background p-3 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            >
                                                <span className="mb-1 block font-semibold text-foreground">
                                                    {index === 0 ? "Editorial portrait" : index === 1 ? "Product studio" : "Graphic poster"}
                                                </span>
                                                <span className="line-clamp-3">{starter}</span>
                                            </button>
                                        ))}
                                    </div>
                                </motion.div>
                            ) : (
                                <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
                                    {generatedImages.map((img) => (
                                        <motion.article
                                            layout
                                            initial={{ opacity: 0, y: 12 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: 8 }}
                                            key={img.id}
                                            className="overflow-hidden rounded-xl border border-border/60 bg-background/70 shadow-sm"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setActiveImage(img)}
                                                className="block w-full bg-checkered focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                                aria-label={`Preview ${img.prompt || "generated image"}`}
                                            >
                                                <img
                                                    src={img.dataUrl}
                                                    alt={img.prompt || "Generated image"}
                                                    className="h-auto max-h-[34rem] w-full object-contain"
                                                />
                                            </button>
                                            <div className="space-y-3 p-3">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {img.model ? (
                                                        <span className="max-w-full truncate rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-secondary-foreground">
                                                            {img.model}
                                                        </span>
                                                    ) : null}
                                                    {typeof img.batchOrder === "number" ? (
                                                        <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                                                            Output #{img.batchOrder + 1}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <p className="line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground">
                                                    {img.prompt || "Prompt details are unavailable for this output."}
                                                </p>
                                                <div className="grid grid-cols-2 gap-2">
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-11 justify-start"
                                                        onClick={() => setActiveImage(img)}
                                                    >
                                                        <Maximize2 className="mr-2 h-4 w-4" />
                                                        Preview
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-11 justify-start"
                                                        onClick={() => handleDownload(img)}
                                                    >
                                                        <Download className="mr-2 h-4 w-4" />
                                                        Download
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-11 justify-start"
                                                        onClick={() => reusePrompt(img)}
                                                        disabled={!img.prompt?.trim()}
                                                    >
                                                        <RotateCcw className="mr-2 h-4 w-4" />
                                                        Reuse prompt
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-11 justify-start"
                                                        onClick={() => void addAsReference(img)}
                                                        disabled={!acceptsReferences || referenceLoadingId === img.id}
                                                        title={
                                                            acceptsReferences
                                                                ? "Add this output to the selected references"
                                                                : "The selected model does not accept reference images"
                                                        }
                                                    >
                                                        {referenceLoadingId === img.id ? (
                                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <ImagePlus className="mr-2 h-4 w-4" />
                                                        )}
                                                        Use as reference
                                                    </Button>
                                                </div>
                                            </div>
                                        </motion.article>
                                    ))}
                                </div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
            <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Clear generated results?</DialogTitle>
                        <DialogDescription>
                            This removes {generatedImages.length} result{generatedImages.length === 1 ? "" : "s"} from this session. Images already saved to the gallery stay there.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <Button variant="outline" className="h-11" onClick={() => setClearConfirmOpen(false)}>
                            Keep results
                        </Button>
                        <Button variant="destructive" className="h-11" onClick={handleClear}>
                            Clear results
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            <ImageViewer
                open={!!activeImage}
                onOpenChange={(open) => {
                    if (!open) setActiveImage(null);
                }}
                imageUrl={activeImage?.dataUrl ?? null}
                prompt={activeImage?.prompt ?? ""}
                model={activeImage?.model ?? context.model}
                provider={activeImage?.provider ?? context.provider}
                kind="image"
                mimeType={activeImage?.mimeType ?? null}
            />
        </div>
    );
}
