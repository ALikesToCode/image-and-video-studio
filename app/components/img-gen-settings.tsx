import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/app/components/ui/select";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { Button } from "@/app/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/app/components/ui/card";
import { Check, ChevronDown, ChevronUp, Layers3, Settings2 } from "lucide-react";
import {
    AUTO_IMAGE_OPTION,
    IMAGE_ASPECTS,
    IMAGE_SIZES,
    IMAGEN_SIZES,
    Mode,
    NAVY_IMAGE_SIZES,
    Provider,
    ModelOption,
    TTS_FORMATS,
    TTS_VOICES,
    VIDEO_ASPECTS,
    VIDEO_DURATIONS,
    VIDEO_RESOLUTIONS,
} from "@/lib/constants";
import { NavyUsageResponse } from "@/lib/types";

interface ImgGenSettingsProps {
    provider: Provider;
    setProvider: (p: Provider) => void;
    mode: Mode;
    setMode: (m: Mode) => void;
    apiKey: string;
    setApiKey: (k: string) => void;
    model: string;
    setModel: (m: string) => void;
    clearKey: () => void;
    imageAspect: string;
    setImageAspect: (a: string) => void;
    imageSize: string;
    setImageSize: (s: string) => void;
    imageCount: number;
    setImageCount: (c: number) => void;
    imagePipelineEnabled: boolean;
    setImagePipelineEnabled: (enabled: boolean) => void;
    imageModelOrder: string[];
    setImageModelOrder: (
        value: string[] | ((prev: string[]) => string[])
    ) => void;
    chutesGuidanceScale: string;
    setChutesGuidanceScale: (v: string) => void;
    chutesWidth: string;
    setChutesWidth: (v: string) => void;
    chutesHeight: string;
    setChutesHeight: (v: string) => void;
    chutesSteps: string;
    setChutesSteps: (v: string) => void;
    chutesResolution: string;
    setChutesResolution: (v: string) => void;
    chutesSeed: string;
    setChutesSeed: (v: string) => void;
    videoAspect: string;
    setVideoAspect: (a: string) => void;
    videoResolution: string;
    setVideoResolution: (r: string) => void;
    videoDuration: string;
    setVideoDuration: (d: string) => void;
    ttsVoice: string;
    setTtsVoice: (v: string) => void;
    ttsFormat: string;
    setTtsFormat: (f: string) => void;
    ttsSpeed: string;
    setTtsSpeed: (s: string) => void;
    saveToGallery: boolean;
    setSaveToGallery: (s: boolean) => void;
    modelSuggestions: ModelOption[];
    supportsVideo: boolean;
    supportsTts: boolean;
    onRefreshModels?: () => void;
    modelsLoading?: boolean;
    modelsError?: string | null;
    navyUsage?: NavyUsageResponse | null;
    navyUsageError?: string | null;
    navyUsageLoading?: boolean;
    navyUsageUpdatedAt?: string | null;
    navyImageSize?: string;
    setNavyImageSize?: (s: string) => void;
    chutesVideoFps?: string;
    setChutesVideoFps?: (v: string) => void;
    chutesVideoGuidanceScale?: string;
    setChutesVideoGuidanceScale?: (v: string) => void;
    onRefreshUsage?: () => void;
    chutesTtsSpeed?: string;
    setChutesTtsSpeed?: (s: string) => void;
    chutesTtsSpeaker?: string;
    setChutesTtsSpeaker?: (s: string) => void;
    chutesTtsMaxDuration?: string;
    setChutesTtsMaxDuration?: (s: string) => void;
}

export function ImgGenSettings({
    provider,
    setProvider,
    mode,
    model,
    setModel,
    imageAspect,
    setImageAspect,
    imageSize,
    setImageSize,
    imageCount,
    setImageCount,
    imagePipelineEnabled,
    setImagePipelineEnabled,
    imageModelOrder,
    setImageModelOrder,
    navyImageSize,
    setNavyImageSize,
    chutesVideoFps,
    setChutesVideoFps,
    chutesVideoGuidanceScale,
    setChutesVideoGuidanceScale,
    chutesGuidanceScale,
    setChutesGuidanceScale,
    chutesWidth,
    setChutesWidth,
    chutesHeight,
    setChutesHeight,
    chutesSteps,
    setChutesSteps,
    chutesResolution,
    setChutesResolution,
    chutesSeed,
    setChutesSeed,
    videoAspect,
    setVideoAspect,
    videoResolution,
    setVideoResolution,
    videoDuration,
    setVideoDuration,
    ttsVoice,
    setTtsVoice,
    ttsFormat,
    setTtsFormat,
    ttsSpeed,
    setTtsSpeed,
    saveToGallery,
    setSaveToGallery,
    modelSuggestions,
    onRefreshModels,
    modelsLoading,
    modelsError,
    navyUsage,
    navyUsageError,
    navyUsageLoading,
    navyUsageUpdatedAt,

    onRefreshUsage,
    chutesTtsSpeed,
    setChutesTtsSpeed,
    chutesTtsSpeaker,
    setChutesTtsSpeaker,
    chutesTtsMaxDuration,
    setChutesTtsMaxDuration,
}: ImgGenSettingsProps) {


    const isOpenRouter = provider === "openrouter";
    const isImagenModel = model.startsWith("imagen-");
    const isOpenRouterGemini = isOpenRouter && model.includes("gemini");
    const isFluxFamilyModel = model.toLowerCase().includes("flux");
    const isChutesHiDream =
        provider === "chutes" && model.toLowerCase().includes("hidream");
    const normalizedModel = model.toLowerCase();
    const isChutesKokoro = provider === "chutes" && normalizedModel === "kokoro";
    const isChutesCsm = provider === "chutes" && normalizedModel === "csm-1b";

    const showImageCount = provider === "navy" || isImagenModel;
    const showImageSize =
        provider === "gemini"
            ? model.includes("gemini-3-pro") || isImagenModel
            : provider === "navy" || (isOpenRouter && isOpenRouterGemini);
    const showImageAspect =
        provider === "gemini" || isOpenRouterGemini || provider === "navy";
    const availableImageSizes = isImagenModel ? IMAGEN_SIZES : IMAGE_SIZES;
    const galleryDisabled = false;
    const usagePercent =
        typeof navyUsage?.usage?.percent_used === "number"
            ? navyUsage.usage.percent_used
            : null;
    const usageUpdatedLabel = navyUsageUpdatedAt
        ? new Date(navyUsageUpdatedAt).toLocaleTimeString()
        : null;
    const availableModelIds = new Set(modelSuggestions.map((suggestion) => suggestion.id));
    const orderedImageModels = imageModelOrder.filter((entry) => availableModelIds.has(entry));
    const selectedModel = modelSuggestions.find((suggestion) => suggestion.id === model);

    const formatCount = (value?: number | null) =>
        typeof value === "number" ? value.toLocaleString() : value === null ? "unknown" : "-";
    const formatFlag = (value?: boolean | null) =>
        typeof value === "boolean" ? (value ? "yes" : "no") : value === null ? "unknown" : "-";
    const selectedInputModalities = selectedModel?.inputModalities;
    const selectedOutputModalities = selectedModel?.outputModalities;
    const hasSelectedModelMetadata = Boolean(
        selectedModel?.endpoint ||
        selectedModel?.requiredPlan ||
        typeof selectedModel?.tokenMultiplier === "number" ||
        selectedModel?.contextWindow !== undefined ||
        selectedModel?.maxOutputTokens !== undefined ||
        selectedModel?.metadataStatus ||
        selectedModel?.metadataSource !== undefined ||
        selectedModel?.modality !== undefined ||
        selectedModel?.tokenizer !== undefined ||
        selectedModel?.supportsVision !== undefined ||
        selectedModel?.supportsTools !== undefined ||
        selectedModel?.supportsFunctionCalling !== undefined ||
        selectedModel?.supportsReasoning !== undefined ||
        selectedModel?.supportsJsonMode !== undefined ||
        selectedModel?.supportsAudioInput !== undefined ||
        selectedModel?.supportsImageOutput !== undefined ||
        selectedModel?.supportsStreaming !== undefined ||
        selectedModel?.maxReferenceImages !== undefined ||
        selectedInputModalities !== undefined ||
        selectedOutputModalities !== undefined
    );
    const formatDuration = (ms?: number) => {
        if (!ms || !Number.isFinite(ms)) return "-";
        const totalSeconds = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        if (hours > 0) return `${hours}h ${minutes}m`;
        if (minutes > 0) return `${minutes}m ${seconds}s`;
        return `${seconds}s`;
    };
    const reorderPipelineModel = (id: string, direction: "up" | "down") => {
        setImageModelOrder((prev) => {
            const next = prev.filter((entry) => availableModelIds.has(entry));
            const index = next.indexOf(id);
            if (index === -1) return next;
            const targetIndex = direction === "up" ? index - 1 : index + 1;
            if (targetIndex < 0 || targetIndex >= next.length) return next;
            const reordered = [...next];
            const [item] = reordered.splice(index, 1);
            reordered.splice(targetIndex, 0, item);
            return reordered;
        });
    };
    const togglePipelineModel = (id: string) => {
        setImageModelOrder((prev) => {
            const next = prev.filter((entry) => availableModelIds.has(entry));
            return next.includes(id)
                ? next.filter((entry) => entry !== id)
                : [...next, id];
        });
    };

    return (
        <Card className="h-fit glass-card border-0">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Settings2 className="h-5 w-5" />
                    Configuration
                </CardTitle>
                <CardDescription>
                    Customize your generation settings.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Provider Selection */}
                <div className="space-y-2">
                    <Label>Provider</Label>
                    <Select
                        value={provider}
                        onValueChange={(v) => setProvider(v as Provider)}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="gemini">Google Gemini</SelectItem>
                            <SelectItem value="navy">NavyAI</SelectItem>
                            <SelectItem value="openrouter">OpenRouter</SelectItem>
                            <SelectItem value="chutes">Chutes</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Model */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Model</Label>
                        {onRefreshModels && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={onRefreshModels}
                                disabled={modelsLoading}
                                className="h-8 px-2 text-xs"
                            >
                                {modelsLoading ? "Refreshing..." : "Refresh models"}
                            </Button>
                        )}
                    </div>
                    <Select value={model} onValueChange={setModel}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                            {modelSuggestions.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                    {m.label}{m.premium ? " (premium)" : ""}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                        {isFluxFamilyModel
                            ? "Flux models work best with natural-language prompts and positive framing."
                            : "Select a model."}
                    </p>
                    {modelsError ? (
                        <p className="text-xs text-destructive">{modelsError}</p>
                    ) : null}
                    {hasSelectedModelMetadata ? (
                        <div className="space-y-1 rounded-lg border border-border/50 bg-secondary/20 p-2 text-[11px] text-muted-foreground">
                            {selectedModel?.endpoint ? <div>Endpoint: {selectedModel.endpoint}</div> : null}
                            {selectedModel?.requiredPlan ? <div>Plan: {selectedModel.requiredPlan}</div> : null}
                            {typeof selectedModel?.tokenMultiplier === "number" ? <div>Token multiplier: {selectedModel.tokenMultiplier}</div> : null}
                            {selectedModel?.contextWindow !== undefined ? <div>Context: {formatCount(selectedModel.contextWindow)}</div> : null}
                            {selectedModel?.maxOutputTokens !== undefined ? <div>Max output: {formatCount(selectedModel.maxOutputTokens)}</div> : null}
                            {selectedInputModalities !== undefined ? (
                                <div>Input: {selectedInputModalities?.length ? selectedInputModalities.join(", ") : "unknown"}</div>
                            ) : null}
                            {selectedOutputModalities !== undefined ? (
                                <div>Output: {selectedOutputModalities?.length ? selectedOutputModalities.join(", ") : "unknown"}</div>
                            ) : null}
                            {selectedModel?.modality !== undefined ? <div>Modality: {selectedModel.modality ?? "unknown"}</div> : null}
                            {selectedModel?.tokenizer !== undefined ? <div>Tokenizer: {selectedModel.tokenizer ?? "unknown"}</div> : null}
                            {selectedModel?.metadataStatus ? <div>Metadata: {selectedModel.metadataStatus}{selectedModel.metadataSource ? ` via ${selectedModel.metadataSource}` : ""}</div> : null}
                            {selectedModel?.maxReferenceImages !== undefined ? <div>Reference images: up to {selectedModel.maxReferenceImages}</div> : null}
                            {selectedModel?.supportsVision !== undefined ? <div>Vision: {formatFlag(selectedModel.supportsVision)}</div> : null}
                            {selectedModel?.supportsTools !== undefined ? <div>Tools: {formatFlag(selectedModel.supportsTools)}</div> : null}
                            {selectedModel?.supportsFunctionCalling !== undefined ? <div>Function calling: {formatFlag(selectedModel.supportsFunctionCalling)}</div> : null}
                            {selectedModel?.supportsReasoning !== undefined ? <div>Reasoning: {formatFlag(selectedModel.supportsReasoning)}</div> : null}
                            {selectedModel?.supportsJsonMode !== undefined ? <div>JSON mode: {formatFlag(selectedModel.supportsJsonMode)}</div> : null}
                            {selectedModel?.supportsAudioInput !== undefined ? <div>Audio input: {formatFlag(selectedModel.supportsAudioInput)}</div> : null}
                            {selectedModel?.supportsImageOutput !== undefined ? <div>Image output: {formatFlag(selectedModel.supportsImageOutput)}</div> : null}
                            {selectedModel?.supportsStreaming !== undefined ? <div>Streaming: {formatFlag(selectedModel.supportsStreaming)}</div> : null}
                        </div>
                    ) : null}
                    {selectedModel?.description ? (
                        <p className="line-clamp-3 text-xs text-muted-foreground">
                            {selectedModel.description}
                        </p>
                    ) : null}
                    {selectedModel?.premium ? (
                        <p className="text-xs text-amber-600">This model may be premium or plan-gated.</p>
                    ) : null}
                    {mode === "image" && isFluxFamilyModel ? (
                        <p className="text-xs text-muted-foreground">This model ignores negative prompts; exclusions are rewritten as positive instructions.</p>
                    ) : null}
                    {mode === "video" && provider === "gemini" && (videoResolution === "1080p" || videoResolution === "4k") ? (
                        <p className="text-xs text-amber-600">This resolution requires an 8-second Veo duration.</p>
                    ) : null}
                </div>

                {mode === "image" && modelSuggestions.length > 1 ? (
                    <div className="space-y-3 rounded-xl border border-border/50 bg-secondary/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <Layers3 className="h-4 w-4 text-primary" />
                                    Ordered model pipeline
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Queue multiple image models, run them in parallel, and keep results in this order.
                                </p>
                            </div>
                            <input
                                type="checkbox"
                                checked={imagePipelineEnabled}
                                onChange={(event) => setImagePipelineEnabled(event.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                        </div>

                        {imagePipelineEnabled ? (
                            <div className="space-y-2">
                                {modelSuggestions.map((suggestion) => {
                                    const index = orderedImageModels.indexOf(suggestion.id);
                                    const selected = index !== -1;
                                    return (
                                        <div
                                            key={suggestion.id}
                                            className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/50 px-2 py-2"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => togglePipelineModel(suggestion.id)}
                                                className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                                                    selected
                                                        ? "border-primary bg-primary text-primary-foreground"
                                                        : "border-border/60 bg-background text-muted-foreground"
                                                }`}
                                                aria-label={`${selected ? "Remove" : "Add"} ${suggestion.label} from pipeline`}
                                            >
                                                {selected ? <Check className="h-4 w-4" /> : <span className="text-xs">+</span>}
                                            </button>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium">{suggestion.label}</div>
                                                <div className="truncate text-[11px] text-muted-foreground">{suggestion.id}</div>
                                            </div>
                                            {selected ? (
                                                <>
                                                    <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                                                        #{index + 1}
                                                    </span>
                                                    <div className="flex items-center gap-1">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7"
                                                            onClick={() => reorderPipelineModel(suggestion.id, "up")}
                                                            disabled={index === 0}
                                                        >
                                                            <ChevronUp className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7"
                                                            onClick={() => reorderPipelineModel(suggestion.id, "down")}
                                                            disabled={index === orderedImageModels.length - 1}
                                                        >
                                                            <ChevronDown className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </>
                                            ) : null}
                                        </div>
                                    );
                                })}
                                <p className="text-[11px] text-muted-foreground">
                                    {orderedImageModels.length
                                        ? `Generating now will queue ${orderedImageModels.length} model${orderedImageModels.length === 1 ? "" : "s"} for this prompt.`
                                        : "Select at least one model to build the pipeline. The current model is used automatically if none are selected."}
                                </p>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                Disabled. Generate with the single selected model only.
                            </p>
                        )}
                    </div>
                ) : null}

                {/* Dynamic Options */}
                {mode === "image" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {provider === "navy" ? (
                            <>
                                <div className="space-y-2">
                                    <Label>Size</Label>
                                    <Select value={navyImageSize} onValueChange={setNavyImageSize}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={AUTO_IMAGE_OPTION}>
                                                Auto (model decides)
                                            </SelectItem>
                                            {NAVY_IMAGE_SIZES.map((size) => (
                                                <SelectItem key={size} value={size}>
                                                    {size}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Aspect Ratio</Label>
                                    <Select value={imageAspect} onValueChange={setImageAspect}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={AUTO_IMAGE_OPTION}>
                                                Auto (model decides)
                                            </SelectItem>
                                            {IMAGE_ASPECTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                        ) : (
                            <>
                                {showImageAspect && (
                                    <div className="space-y-2">
                                        <Label>Aspect Ratio</Label>
                                        <Select value={imageAspect} onValueChange={setImageAspect}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={AUTO_IMAGE_OPTION}>
                                                Auto (model decides)
                                            </SelectItem>
                                            {IMAGE_ASPECTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                )}
                                {showImageSize && (
                                    <div className="space-y-2">
                                        <Label>Size</Label>
                                        <Select value={imageSize} onValueChange={setImageSize}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={AUTO_IMAGE_OPTION}>
                                                Auto (model decides)
                                            </SelectItem>
                                            {availableImageSizes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                )}
                            </>
                        )}
                        {showImageCount && (
                            <div className="space-y-2">
                                <Label>Count</Label>
                                <Select value={imageCount.toString()} onValueChange={(v) => setImageCount(parseInt(v))}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {[1, 2, 3, 4].map(c => <SelectItem key={c} value={c.toString()}>{c}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </div>
                )}

                {mode === "image" && provider === "chutes" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Guidance Scale</Label>
                            <Input
                                type="number"
                                min="0"
                                step="0.1"
                                value={chutesGuidanceScale}
                                onChange={(e) => setChutesGuidanceScale(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Steps</Label>
                            <Input
                                type="number"
                                min="1"
                                step="1"
                                value={chutesSteps}
                                onChange={(e) => setChutesSteps(e.target.value)}
                            />
                        </div>
                        {isChutesHiDream ? (
                            <>
                                <div className="space-y-2">
                                    <Label>Resolution</Label>
                                    <Input
                                        value={chutesResolution}
                                        onChange={(e) => setChutesResolution(e.target.value)}
                                        placeholder="1024x1024"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Seed (Optional)</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={chutesSeed}
                                        onChange={(e) => setChutesSeed(e.target.value)}
                                        placeholder="Random"
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label>Width</Label>
                                    <Input
                                        type="number"
                                        min="64"
                                        step="64"
                                        value={chutesWidth}
                                        onChange={(e) => setChutesWidth(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Height</Label>
                                    <Input
                                        type="number"
                                        min="64"
                                        step="64"
                                        value={chutesHeight}
                                        onChange={(e) => setChutesHeight(e.target.value)}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}

                {mode === "video" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {provider === "chutes" ? (
                            <>
                                <div className="space-y-2">
                                    <Label>FPS</Label>
                                    <Input
                                        type="number"
                                        min="1"
                                        max="60"
                                        step="1"
                                        value={chutesVideoFps}
                                        onChange={(e) => setChutesVideoFps && setChutesVideoFps(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label>Guidance Scale 2</Label>
                                    <Input
                                        type="number"
                                        min="0"
                                        max="20"
                                        step="0.1"
                                        value={chutesVideoGuidanceScale}
                                        onChange={(e) => setChutesVideoGuidanceScale && setChutesVideoGuidanceScale(e.target.value)}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label>Aspect Ratio</Label>
                                    <Select value={videoAspect} onValueChange={setVideoAspect}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {VIDEO_ASPECTS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Resolution</Label>
                                    <Select value={videoResolution} onValueChange={setVideoResolution}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {VIDEO_RESOLUTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Duration (s)</Label>
                                    <Select value={videoDuration} onValueChange={setVideoDuration}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {VIDEO_DURATIONS.map(d => <SelectItem key={d} value={d}>{d}s</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </>
                        )}
                    </div>
                )}

                {mode === "tts" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {provider === "chutes" ? (
                            <>
                                {isChutesCsm ? (
                                    <>
                                        <div className="space-y-2">
                                            <Label>Speaker</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={chutesTtsSpeaker}
                                                onChange={(e) => setChutesTtsSpeaker && setChutesTtsSpeaker(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Max Duration (ms)</Label>
                                            <Input
                                                type="number"
                                                min="1000"
                                                step="500"
                                                value={chutesTtsMaxDuration}
                                                onChange={(e) => setChutesTtsMaxDuration && setChutesTtsMaxDuration(e.target.value)}
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <div className="space-y-2 col-span-2">
                                        <Label>Speed</Label>
                                        <Input
                                            type="number"
                                            min="0.5"
                                            max="2.0"
                                            step="0.1"
                                            value={chutesTtsSpeed}
                                            onChange={(e) => setChutesTtsSpeed && setChutesTtsSpeed(e.target.value)}
                                        />
                                        {isChutesKokoro ? (
                                            <p className="text-[10px] text-muted-foreground">
                                                Kokoro uses speed only.
                                            </p>
                                        ) : null}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="space-y-2">
                                    <Label>Voice</Label>
                                    <Select value={ttsVoice} onValueChange={setTtsVoice}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TTS_VOICES.map((voice) => (
                                                <SelectItem key={voice} value={voice}>
                                                    {voice}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Format</Label>
                                    <Select value={ttsFormat} onValueChange={setTtsFormat}>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TTS_FORMATS.map((format) => (
                                                <SelectItem key={format} value={format}>
                                                    {format}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Speed</Label>
                                    <Input
                                        type="number"
                                        min="0.25"
                                        max="4"
                                        step="0.05"
                                        value={ttsSpeed}
                                        onChange={(e) => setTtsSpeed(e.target.value)}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Gallery Save Toggle */}
                <div className="flex items-center gap-2 pt-2">
                    <input
                        type="checkbox"
                        id="saveToGallery"
                        checked={saveToGallery}
                        onChange={(e) => setSaveToGallery(e.target.checked)}
                        disabled={galleryDisabled}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary disabled:opacity-50"
                    />
                    <Label
                        htmlFor="saveToGallery"
                        className="font-normal cursor-pointer"
                    >
                        Save to local gallery
                    </Label>
                </div>

                {provider === "navy" ? (
                    <div className="rounded-xl border border-border/50 bg-secondary/20 p-4 text-xs">
                        <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="font-semibold uppercase tracking-wider text-muted-foreground">NavyAI Status</span>
                            {onRefreshUsage && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 hover:bg-background/50"
                                    onClick={onRefreshUsage}
                                    disabled={navyUsageLoading}
                                >
                                    {navyUsageLoading ? "..." : "Refresh"}
                                </Button>
                            )}
                        </div>
                        {navyUsageError ? (
                            <p className="mt-2 text-destructive">{navyUsageError}</p>
                        ) : navyUsage ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-2 text-muted-foreground">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wide opacity-70">Plan</div>
                                    <div className="text-foreground font-medium">{navyUsage.plan}</div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wide opacity-70">RPM Limit</div>
                                    <div className="text-foreground font-medium">{formatCount(navyUsage.limits.rpm)}</div>
                                </div>
                                <div className="col-span-2 bg-background/30 rounded-lg p-2 border border-border/30">
                                    <div className="flex justify-between items-end mb-1">
                                        <span className="text-[10px] uppercase tracking-wide opacity-70">Daily Token Usage</span>
                                        <span className="text-foreground font-medium">{usagePercent !== null ? `${usagePercent.toFixed(1)}%` : "-"}</span>
                                    </div>
                                    <div className="w-full bg-background h-1.5 rounded-full overflow-hidden">
                                        <div
                                            className="bg-primary h-full transition-all duration-500"
                                            style={{ width: `${Math.min(100, usagePercent ?? 0)}%` }}
                                        />
                                    </div>
                                    <div className="flex justify-between text-[10px] mt-1 text-muted-foreground">
                                        <span>{formatCount(navyUsage.usage.tokens_used_today)} used</span>
                                        <span>{formatCount(navyUsage.usage.tokens_remaining_today)} left</span>
                                    </div>
                                </div>

                                <div>
                                    <div className="text-[10px] uppercase tracking-wide opacity-70">Resets In</div>
                                    <div className="text-foreground font-medium">
                                        {formatDuration(navyUsage.usage.resets_in_ms)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-wide opacity-70">Rate Limit (1m)</div>
                                    <div className="text-foreground font-medium">
                                        {formatCount(navyUsage.rate_limits.per_minute.remaining)} left
                                    </div>
                                </div>

                                {usageUpdatedLabel ? (
                                    <div className="col-span-2 text-[10px] text-right opacity-50 mt-1">
                                        Updated: {usageUpdatedLabel}
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <p className="mt-2 text-muted-foreground">
                                Add a NavyAI API key to see usage stats.
                            </p>
                        )}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    );
}
