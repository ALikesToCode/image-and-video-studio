/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { StoredMedia } from "@/lib/types";
import { Download, Maximize2, Trash2, AudioLines, Video } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { ImageViewer } from "./image-viewer";

interface GalleryGridProps {
    items: StoredMedia[];
    onClear: () => void;
}

export function GalleryGrid({ items, onClear }: GalleryGridProps) {
    const [activeItem, setActiveItem] = useState<StoredMedia | null>(null);

    const extensionFromMime = (mimeType?: string, kind?: StoredMedia["kind"]) => {
        if (mimeType) {
            if (mimeType.includes("png")) return "png";
            if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
            if (mimeType.includes("webp")) return "webp";
            if (mimeType.includes("gif")) return "gif";
            if (mimeType.includes("mp4")) return "mp4";
            if (mimeType.includes("webm")) return "webm";
            if (mimeType.includes("mpeg")) return "mp3";
            if (mimeType.includes("opus")) return "opus";
            if (mimeType.includes("aac")) return "aac";
            if (mimeType.includes("flac")) return "flac";
            if (mimeType.includes("wav")) return "wav";
        }
        if (kind === "video") return "mp4";
        if (kind === "audio") return "mp3";
        return "png";
    };

    const handleDownload = (item: StoredMedia) => {
        const link = document.createElement("a");
        link.href = item.dataUrl;
        link.download = `generation-${item.id}.${extensionFromMime(
            item.mimeType,
            item.kind ?? "image"
        )}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const closeViewer = (open: boolean) => {
        if (!open) {
            setActiveItem(null);
        }
    };

    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-muted-foreground">
                <p>No saved generations yet.</p>
                <p className="text-sm">Turn on &quot;Save to local gallery&quot; to keep them here.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Gallery</h3>
                <Button variant="outline" size="sm" onClick={onClear}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Clear Gallery
                </Button>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
                <AnimatePresence mode="popLayout">
                    {items.map((item) => {
                        const kind = item.kind ?? "image";
                        return (
                            <motion.div
                                key={item.id}
                                layout
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                transition={{ duration: 0.2 }}
                            >
                                <Card className="overflow-hidden group relative glass-card border-none shadow-sm hover:shadow-lg transition-all">
                                    <div className="aspect-square relative">
                                        {kind === "image" ? (
                                            <img
                                                src={item.dataUrl}
                                                alt={item.prompt}
                                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                loading="lazy"
                                            />
                                        ) : kind === "video" ? (
                                            <video
                                                src={item.dataUrl}
                                                className="h-full w-full object-cover"
                                                muted
                                                playsInline
                                                preload="metadata"
                                            />
                                        ) : (
                                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/40 text-muted-foreground">
                                                <AudioLines className="h-6 w-6" />
                                                <span className="text-xs uppercase tracking-widest">Audio</span>
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                            <Button
                                                size="icon"
                                                variant="secondary"
                                                onClick={() => setActiveItem(item)}
                                                className="h-8 w-8 rounded-full"
                                            >
                                                <Maximize2 className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="secondary"
                                                onClick={() => handleDownload(item)}
                                                className="h-8 w-8 rounded-full"
                                            >
                                                <Download className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="p-2 text-xs text-muted-foreground truncate bg-card border-t">
                                        <span className="mr-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                            {kind === "video" ? (
                                                <Video className="h-3 w-3" />
                                            ) : kind === "audio" ? (
                                                <AudioLines className="h-3 w-3" />
                                            ) : null}
                                            {kind}
                                        </span>
                                        {item.prompt}
                                    </div>
                                </Card>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
            <ImageViewer
                open={!!activeItem}
                onOpenChange={closeViewer}
                imageUrl={activeItem?.dataUrl ?? null}
                prompt={activeItem?.prompt ?? ""}
                model={activeItem?.model ?? ""}
                provider={activeItem?.provider ?? ""}
                kind={activeItem?.kind}
                mimeType={activeItem?.mimeType ?? null}
            />
        </div>
    );
}
