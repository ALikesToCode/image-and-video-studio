/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";
import { Button } from "@/app/components/ui/button";
import { Copy, Check, Download, AudioLines, Video } from "lucide-react";

type ImageViewerProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    imageUrl: string | null;
    prompt: string;
    model: string;
    provider?: string;
    kind?: "image" | "video" | "audio";
    mimeType?: string | null;
};

export function ImageViewer({
    open,
    onOpenChange,
    imageUrl,
    prompt,
    model,
    provider,
    kind = "image",
    mimeType,
}: ImageViewerProps) {
    const [copied, setCopied] = useState(false);

    const resolvedKind = useMemo(() => {
        if (kind === "image" || kind === "video" || kind === "audio") {
            return kind;
        }
        const normalized = (mimeType ?? "").toLowerCase();
        if (normalized.startsWith("video/")) return "video";
        if (normalized.startsWith("audio/")) return "audio";
        return "image";
    }, [kind, mimeType]);

    useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1400);
        return () => window.clearTimeout(timer);
    }, [copied]);

    const copyPrompt = async () => {
        if (!prompt?.trim()) return;
        try {
            await navigator.clipboard.writeText(prompt);
            setCopied(true);
        } catch {
            // ignore clipboard failures
        }
    };

    const extensionFromMime = (value?: string | null, mediaKind?: "image" | "video" | "audio") => {
        const normalized = (value ?? "").toLowerCase();
        if (normalized.includes("png")) return "png";
        if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
        if (normalized.includes("webp")) return "webp";
        if (normalized.includes("gif")) return "gif";
        if (normalized.includes("webm")) return "webm";
        if (normalized.includes("mp4")) return "mp4";
        if (normalized.includes("mpeg")) return "mp3";
        if (normalized.includes("opus")) return "opus";
        if (normalized.includes("aac")) return "aac";
        if (normalized.includes("flac")) return "flac";
        if (normalized.includes("wav")) return "wav";
        if (mediaKind === "video") return "mp4";
        if (mediaKind === "audio") return "mp3";
        return "png";
    };

    const downloadMedia = () => {
        if (!imageUrl) return;
        const link = document.createElement("a");
        link.href = imageUrl;
        link.download = `generation.${extensionFromMime(mimeType, resolvedKind)}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!imageUrl) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[calc(100dvh-1rem)] max-w-none gap-0 p-0 h-[calc(100dvh-1rem)] overflow-hidden sm:h-[92dvh] sm:max-h-[92dvh] sm:w-[96vw]">
                <DialogHeader className="sr-only">
                    <DialogTitle>
                        {resolvedKind === "video"
                            ? "Video preview"
                            : resolvedKind === "audio"
                                ? "Audio preview"
                                : "Image preview"}
                    </DialogTitle>
                    <DialogDescription>
                        Full screen {resolvedKind === "audio" ? "audio" : resolvedKind} preview.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex h-full min-h-0 flex-col lg:flex-row">
                    <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-black p-2 sm:p-3">
                        {resolvedKind === "video" ? (
                            <video
                                src={imageUrl}
                                controls
                                className="h-full w-full object-contain rounded-md"
                            />
                        ) : resolvedKind === "audio" ? (
                            <div className="w-full max-w-xl rounded-xl border border-border/50 bg-background/70 p-6">
                                <div className="mb-4 flex items-center gap-2 text-muted-foreground">
                                    <AudioLines className="h-4 w-4" />
                                    <span className="text-sm uppercase tracking-widest">Audio Preview</span>
                                </div>
                                <audio src={imageUrl} controls className="w-full" />
                            </div>
                        ) : (
                            <img
                                src={imageUrl}
                                alt={prompt || "Generated image"}
                                className="h-full w-full object-contain"
                            />
                        )}
                    </div>
                    <div className="max-h-[40dvh] w-full flex-none overflow-y-auto border-t border-border/50 bg-background/80 p-4 backdrop-blur-xl sm:p-6 lg:h-full lg:max-h-none lg:w-[360px] lg:border-l lg:border-t-0">
                        <div className="space-y-4">
                            <div>
                                <div className="flex items-center justify-between gap-2">
                                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                                        Prompt
                                    </p>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => void copyPrompt()}
                                        className="h-7 px-2 text-xs"
                                        disabled={!prompt?.trim()}
                                    >
                                        {copied ? (
                                            <>
                                                <Check className="mr-1 h-3.5 w-3.5" />
                                                Copied
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="mr-1 h-3.5 w-3.5" />
                                                Copy
                                            </>
                                        )}
                                    </Button>
                                </div>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                                    {prompt || "No prompt available."}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                                    Type
                                </p>
                                <p className="mt-2 text-sm text-foreground inline-flex items-center gap-2">
                                    {resolvedKind === "video" ? <Video className="h-4 w-4" /> : null}
                                    {resolvedKind === "audio" ? <AudioLines className="h-4 w-4" /> : null}
                                    {resolvedKind}
                                </p>
                            </div>
                            <div>
                                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                                    Model
                                </p>
                                <p className="mt-2 font-mono text-sm text-foreground">
                                    {model || "Unknown"}
                                </p>
                            </div>
                            {mimeType ? (
                                <div>
                                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                                        Format
                                    </p>
                                    <p className="mt-2 text-sm text-foreground">{mimeType}</p>
                                </div>
                            ) : null}
                            {provider ? (
                                <div>
                                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                                        Provider
                                    </p>
                                    <p className="mt-2 text-sm text-foreground">
                                        {provider}
                                    </p>
                                </div>
                            ) : null}
                            <div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={downloadMedia}
                                    className="w-full"
                                >
                                    <Download className="mr-2 h-4 w-4" />
                                    Download
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
