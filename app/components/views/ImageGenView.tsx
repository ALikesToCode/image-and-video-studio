"use client";

/* eslint-disable @next/next/no-img-element */

import { useStudio } from "@/app/contexts/StudioContext";
import { ImgGenSettings } from "../img-gen-settings";
import { PromptInput } from "../prompt-input";
import { ReferenceStrip } from "../reference-strip";
import { SettingsDialog } from "../SettingsDialog";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    AlertTriangle,
    Sparkles,
    Download,
    Trash2,
    Image as ImageIcon,
    Clock3,
    Loader2,
    Settings2,
} from "lucide-react";
import { Button } from "@/app/components/ui/button";
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

export function ImageGenView() {
    const context = useStudio();
    const { mode, setMode, generatedImages, setGeneratedImages } = context;
    const [settingsOpen, setSettingsOpen] = useState(false);
    const selectedModel = context.modelSuggestions.find(
        (entry) => entry.id === context.model
    );
    const acceptsReferences = modelAcceptsImageReferences(selectedModel);
    const referenceLimit = getModelReferenceLimit(selectedModel);

    // Force mode to image when entering this view
    useEffect(() => {
        if (mode !== "image") setMode("image");
    }, [mode, setMode]);

    const handleDownload = (dataUrl: string, id: string) => {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `generated-${id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleClear = () => {
        setGeneratedImages([]);
    };

    return (
        <div className="h-full w-full overflow-y-auto bg-background/50">
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

                        {context.activeJobCount > 0 && (
                            <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center gap-2 text-[10px] sm:text-xs font-medium text-muted-foreground bg-background/50 px-2 py-1 rounded-full border">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                </span>
                                Processing {context.activeJobCount} job(s)
                            </div>
                        )}

                        {context.recentJobs.length > 0 ? (
                            <div className="mt-4 space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
                                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                    <Clock3 className="h-3.5 w-3.5" />
                                    Queue Activity
                                </div>
                                <div className="space-y-2">
                                    {context.recentJobs.map((job) => (
                                        <div
                                            key={job.id}
                                            className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-xs"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate font-medium text-foreground">
                                                    {job.model}
                                                </div>
                                                <div className="truncate text-muted-foreground">
                                                    {job.progress || job.status}
                                                </div>
                                            </div>
                                            <div
                                                className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                                                    job.status === "running"
                                                        ? "bg-primary/10 text-primary"
                                                        : job.status === "queued"
                                                            ? "bg-secondary text-secondary-foreground"
                                                            : job.status === "success"
                                                                ? "bg-emerald-500/10 text-emerald-600"
                                                                : "bg-destructive/10 text-destructive"
                                                }`}
                                            >
                                                {job.status === "running" ? (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                        Running
                                                    </span>
                                                ) : (
                                                    job.status
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </motion.div>

                    {/* Output Grid */}
                    <div className="glass flex min-h-[240px] flex-1 flex-col gap-4 rounded-xl border p-4 sm:min-h-[400px] sm:p-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-muted-foreground">
                                <Sparkles className="h-4 w-4" />
                                <span className="font-medium text-sm">Generated Results</span>
                            </div>
                            {generatedImages.length > 0 && (
                                <Button variant="ghost" size="sm" onClick={handleClear} className="h-8 gap-2 text-muted-foreground hover:text-destructive">
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
                                    className="flex-1 flex flex-col items-center justify-center text-muted-foreground/50 gap-4"
                                >
                                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary/30 sm:h-24 sm:w-24">
                                        <ImageIcon className="h-8 w-8 text-secondary sm:h-10 sm:w-10" />
                                    </div>
                                    <p className="text-base font-medium sm:text-lg">Ready to create masterpieces</p>
                                    <p className="text-sm">Enter a prompt above and hit Generate</p>
                                </motion.div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                    {generatedImages.map((img) => (
                                        <motion.div
                                            layout
                                            initial={{ opacity: 0, scale: 0.8 }}
                                            animate={{ opacity: 1, scale: 1 }}
                                            exit={{ opacity: 0, scale: 0.8 }}
                                            key={img.id}
                                            className="group relative aspect-square rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all border bg-background/50"
                                        >
                                            <img
                                                src={img.dataUrl}
                                                alt={img.prompt || "Generated output"}
                                                className="w-full h-full object-contain bg-checkered"
                                            />
                                            <div className="absolute left-2 top-2 flex flex-wrap gap-2">
                                                {img.model ? (
                                                    <span className="rounded-full bg-background/80 px-2 py-1 text-[10px] font-semibold text-foreground shadow-sm backdrop-blur">
                                                        {img.model}
                                                    </span>
                                                ) : null}
                                                {typeof img.batchOrder === "number" ? (
                                                    <span className="rounded-full bg-primary/85 px-2 py-1 text-[10px] font-semibold text-primary-foreground shadow-sm">
                                                        #{img.batchOrder + 1}
                                                    </span>
                                                ) : null}
                                            </div>
                                            {/* Overlay Actions */}
                                            <div className="absolute inset-0 bg-black/60 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-[2px]">
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="h-10 w-10 rounded-full"
                                                    onClick={() => handleDownload(img.dataUrl, img.id)}
                                                    title="Download"
                                                >
                                                    <Download className="h-5 w-5" />
                                                </Button>
                                                <Button
                                                    size="icon"
                                                    variant="secondary"
                                                    className="h-10 w-10 rounded-full"
                                                    onClick={() => window.open(img.dataUrl, '_blank')}
                                                    title="Open Fullscreen"
                                                >
                                                    <ImageIcon className="h-5 w-5" />
                                                </Button>
                                            </div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}
