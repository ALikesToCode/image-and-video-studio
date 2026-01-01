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
import { Eye, EyeOff, Settings2, Trash2 } from "lucide-react";
import {
    CHUTES_IMAGE_MODELS,
    GEMINI_IMAGE_MODELS,
    GEMINI_VIDEO_MODELS,
    IMAGE_ASPECTS,
    IMAGE_SIZES,
    IMAGEN_SIZES,
    Mode,
    NAVY_IMAGE_MODELS,
    NAVY_VIDEO_MODELS,
    OPENROUTER_IMAGE_MODELS,
    Provider,
    VIDEO_ASPECTS,
    VIDEO_DURATIONS,
    VIDEO_RESOLUTIONS,
} from "@/lib/constants";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

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
    videoAspect: string;
    setVideoAspect: (a: string) => void;
    videoResolution: string;
    setVideoResolution: (r: string) => void;
    videoDuration: string;
    setVideoDuration: (d: string) => void;
    saveToGallery: boolean;
    setSaveToGallery: (s: boolean) => void;
}

export function ImgGenSettings({
    provider,
    setProvider,
    mode,
    setMode,
    apiKey,
    setApiKey,
    model,
    setModel,
    clearKey,
    imageAspect,
    setImageAspect,
    imageSize,
    setImageSize,
    imageCount,
    setImageCount,
    videoAspect,
    setVideoAspect,
    videoResolution,
    setVideoResolution,
    videoDuration,
    setVideoDuration,
    saveToGallery,
    setSaveToGallery,
}: ImgGenSettingsProps) {
    const [showKey, setShowKey] = useState(false);

    const modelSuggestions = useMemo(() => {
        if (provider === "gemini") {
            return mode === "image" ? GEMINI_IMAGE_MODELS : GEMINI_VIDEO_MODELS;
        }
        if (provider === "chutes") {
            return CHUTES_IMAGE_MODELS;
        }
        if (provider === "openrouter") {
            return OPENROUTER_IMAGE_MODELS;
        }
        return mode === "image" ? NAVY_IMAGE_MODELS : NAVY_VIDEO_MODELS;
    }, [provider, mode]);

    const isChutes = provider === "chutes";
    const isOpenRouter = provider === "openrouter";
    const supportsVideo = provider === "gemini" || provider === "navy";
    const isImagenModel = model.startsWith("imagen-");
    const isOpenRouterGemini = isOpenRouter && model.includes("gemini");

    const showImageCount = provider === "navy" || isImagenModel;
    const showImageSize =
        provider === "gemini"
            ? model.includes("gemini-3-pro") || isImagenModel
            : provider === "navy" || (isOpenRouter && isOpenRouterGemini);
    const showImageAspect = provider === "gemini" || isOpenRouterGemini;
    const availableImageSizes = isImagenModel ? IMAGEN_SIZES : IMAGE_SIZES;

    return (
        <Card className="h-fit">
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
                {/* Mode & Provider */}
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label>Mode</Label>
                        <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="image">Image</SelectItem>
                                <SelectItem value="video" disabled={!supportsVideo}>
                                    Video
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
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
                </div>

                {/* API Key */}
                <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <Input
                                type={showKey ? "text" : "password"}
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder={`Paste ${provider.charAt(0).toUpperCase() + provider.slice(1)
                                    } API Key`}
                                className="pr-10"
                            />
                            <Button
                                size="icon"
                                variant="ghost"
                                className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:bg-transparent"
                                onClick={() => setShowKey(!showKey)}
                            >
                                {showKey ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                        {apiKey && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={clearKey}
                                title="Forget Key"
                            >
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* Model */}
                <div className="space-y-2">
                    <Label>Model</Label>
                    <Select value={model} onValueChange={setModel} disabled={isChutes}>
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
                    <p className="text-xs text-muted-foreground">
                        {isChutes ? "Fixed model." : "Select a model."}
                    </p>
                </div>

                {/* Dynamic Options */}
                {mode === "image" && (
                    <div className="grid grid-cols-2 gap-4">
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

                {mode === "video" && (
                    <div className="grid grid-cols-2 gap-4">
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
                    </div>
                )}

                {/* Gallery Save Toggle */}
                <div className="flex items-center gap-2 pt-2">
                    <input
                        type="checkbox"
                        id="saveToGallery"
                        checked={saveToGallery}
                        onChange={(e) => setSaveToGallery(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <Label htmlFor="saveToGallery" className="font-normal cursor-pointer">Save to local gallery</Label>
                </div>
            </CardContent>
        </Card>
    );
}
