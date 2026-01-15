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
import { Settings2 } from "lucide-react";
import {
    IMAGE_ASPECTS,
    IMAGE_SIZES,
    IMAGEN_SIZES,
    Mode,
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
    const isChutesHiDream =
        provider === "chutes" && model.toLowerCase().includes("hidream");

    const showImageCount = provider === "navy" || isImagenModel;
    const showImageSize =
        provider === "gemini"
            ? model.includes("gemini-3-pro") || isImagenModel
            : provider === "navy" || (isOpenRouter && isOpenRouterGemini);
    const showImageAspect = provider === "gemini" || isOpenRouterGemini;
    const availableImageSizes = isImagenModel ? IMAGEN_SIZES : IMAGE_SIZES;
    const galleryDisabled = false;
    const usagePercent =
        typeof navyUsage?.usage?.percent_used === "number"
            ? navyUsage.usage.percent_used
            : null;
    const usageUpdatedLabel = navyUsageUpdatedAt
        ? new Date(navyUsageUpdatedAt).toLocaleTimeString()
        : null;

    const formatCount = (value?: number) =>
        typeof value === "number" ? value.toLocaleString() : "-";
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
                                    {m.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Select a model.</p>
                    {modelsError ? (
                        <p className="text-xs text-destructive">{modelsError}</p>
                    ) : null}
                </div>

                {/* Dynamic Options */}
                {mode === "image" && (
                    <div className="grid grid-cols-2 gap-4">
                        {provider === "navy" ? (
                            <div className="space-y-2">
                                <Label>Size</Label>
                                <Select value={navyImageSize} onValueChange={setNavyImageSize}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {/* Assuming Navy uses standard sizes or we need to fetch them. defaulting to 1024x1024 */}
                                        <SelectItem value="1024x1024">1024x1024</SelectItem>
                                        <SelectItem value="512x512">512x512</SelectItem>
                                        <SelectItem value="768x768">768x768</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
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
                    <div className="grid grid-cols-2 gap-4">
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
                    <div className="grid grid-cols-2 gap-4">
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
                    <div className="grid grid-cols-2 gap-4">
                        {provider === "chutes" ? (
                            <>
                                <div className="space-y-2 col-span-2">
                                    <Label>Speaker (Voice)</Label>
                                    <Input
                                        placeholder="e.g. af_bella, af_sarah"
                                        value={chutesTtsSpeaker}
                                        onChange={(e) => setChutesTtsSpeaker && setChutesTtsSpeaker(e.target.value)}
                                    />
                                    <p className="text-[10px] text-muted-foreground">
                                        Kokoro voices: af_bella, af_sarah, am_adam, am_michael, etc.
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label>Speed</Label>
                                    <Input
                                        type="number"
                                        min="0.5"
                                        max="2.0"
                                        step="0.1"
                                        value={chutesTtsSpeed}
                                        onChange={(e) => setChutesTtsSpeed && setChutesTtsSpeed(e.target.value)}
                                    />
                                </div>
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
                            <div className="grid grid-cols-2 gap-y-3 gap-x-2 text-muted-foreground">
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
