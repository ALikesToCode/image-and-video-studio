"use client";

/* eslint-disable @next/next/no-img-element */

import { useStudio } from "@/app/contexts/StudioContext";
import { ImgGenSettings } from "../img-gen-settings";
import { PromptInput } from "../prompt-input";
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Download, Trash2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/app/components/ui/button";

export function ImageGenView() {
    const context = useStudio();
    const { mode, setMode, generatedImages, setGeneratedImages } = context;

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
            <div className="mx-auto max-w-[1800px] grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 lg:p-6 min-h-full items-start">
                {/* Settings Column - Collapsible/Sticky */}
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="lg:col-span-3 xl:col-span-3 space-y-4 lg:sticky lg:top-6"
                >
                    <div className="glass-card rounded-2xl p-5 shadow-lg space-y-6">
                        <div className="flex items-center gap-2 pb-4 border-b border-border/50">
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                                <ImageIcon className="h-5 w-5" />
                            </div>
                            <h2 className="font-semibold">Settings</h2>
                        </div>

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
                            modelsLoading={context.modelsLoading}
                            modelsError={context.modelsError}
                            onRefreshModels={context.refreshModels}
                            imageCount={context.imageCount}
                            setImageCount={context.setImageCount}
                            imageAspect={context.imageAspect}
                            setImageAspect={context.setImageAspect}
                            imageSize={context.imageSize}
                            setImageSize={context.setImageSize}
                            navyImageSize={context.navyImageSize}
                            setNavyImageSize={context.setNavyImageSize}
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
                        />
                    </div>
                </motion.div>

                {/* Main Content Column */}
                <div className="lg:col-span-9 xl:col-span-9 space-y-6 lg:min-h-[calc(100vh-3rem)] flex flex-col">
                    {/* Input Area */}
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="glass-card rounded-2xl p-6 shadow-xl relative overflow-hidden group"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        <PromptInput
                            prompt={context.prompt}
                            setPrompt={context.setPrompt}
                            negativePrompt={context.negativePrompt}
                            setNegativePrompt={context.setNegativePrompt}
                            onGenerate={context.handleGenerate}
                            busy={context.hasActiveJobs}
                            mode={context.mode}
                        />

                        {context.jobs.length > 0 && (
                            <div className="absolute top-4 right-4 flex items-center gap-2 text-xs font-medium text-muted-foreground bg-background/50 px-2 py-1 rounded-full border">
                                <span className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                                </span>
                                Processing {context.jobs.length} job(s)
                            </div>
                        )}
                    </motion.div>

                    {/* Output Grid */}
                    <div className="flex-1 min-h-[400px] glass p-6 rounded-2xl border flex flex-col gap-4">
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
                                    <div className="w-24 h-24 rounded-full bg-secondary/30 flex items-center justify-center">
                                        <ImageIcon className="h-10 w-10 text-secondary" />
                                    </div>
                                    <p className="text-lg font-medium">Ready to create masterpieces</p>
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
                                                alt="Generated output"
                                                className="w-full h-full object-contain bg-checkered"
                                            />
                                            {/* Overlay Actions */}
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3 backdrop-blur-[2px]">
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
