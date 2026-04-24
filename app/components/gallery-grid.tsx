/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { StoredMedia } from "@/lib/types";
import { Download, Maximize2, Trash2, AudioLines, Video, Copy, Check, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "./ui/select";
import { motion, AnimatePresence } from "framer-motion";
import { ImageViewer } from "./image-viewer";

interface GalleryGridProps {
    items: StoredMedia[];
    onClear: () => void;
    onDelete: (id: string) => Promise<void>;
}

export function GalleryGrid({ items, onClear, onDelete }: GalleryGridProps) {
    const [activeItem, setActiveItem] = useState<StoredMedia | null>(null);
    const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [kindFilter, setKindFilter] = useState<"all" | StoredMedia["kind"]>("all");
    const [sortMode, setSortMode] = useState<"newest" | "oldest" | "provider" | "model">("newest");

    const resolveKind = (
        kind: StoredMedia["kind"] | undefined,
        mimeType?: string
    ): StoredMedia["kind"] => {
        if (kind === "image" || kind === "video" || kind === "audio") {
            return kind;
        }
        const normalized = (mimeType ?? "").toLowerCase();
        if (normalized.startsWith("video/")) return "video";
        if (normalized.startsWith("audio/")) return "audio";
        return "image";
    };

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

    const handleCopyPrompt = async (item: StoredMedia) => {
        if (!item.prompt?.trim()) return;
        try {
            await navigator.clipboard.writeText(item.prompt);
            setCopiedPromptId(item.id);
            window.setTimeout(() => setCopiedPromptId((prev) => (prev === item.id ? null : prev)), 1600);
        } catch {
            // ignore clipboard failures
        }
    };

    const handleExportJson = () => {
        const payload = {
            exportedAt: new Date().toISOString(),
            assets: visibleItems.map((item) => ({
                id: item.id,
                kind: resolveKind(item.kind, item.mimeType),
                provider: item.provider,
                model: item.model,
                prompt: item.prompt,
                createdAt: item.createdAt,
                mimeType: item.mimeType,
                dataUrl: item.dataUrl,
            })),
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "studio-gallery-export.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const closeViewer = (open: boolean) => {
        if (!open) {
            setActiveItem(null);
        }
    };

    const visibleItems = items
        .filter((item) => {
            const kind = resolveKind(item.kind, item.mimeType);
            if (kindFilter !== "all" && kind !== kindFilter) return false;
            const normalizedQuery = query.trim().toLowerCase();
            if (!normalizedQuery) return true;
            return [item.prompt, item.model, item.provider, item.mimeType]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()
                .includes(normalizedQuery);
        })
        .sort((left, right) => {
            if (sortMode === "oldest") {
                return left.createdAt.localeCompare(right.createdAt);
            }
            if (sortMode === "provider") {
                return left.provider.localeCompare(right.provider) || right.createdAt.localeCompare(left.createdAt);
            }
            if (sortMode === "model") {
                return left.model.localeCompare(right.model) || right.createdAt.localeCompare(left.createdAt);
            }
            return right.createdAt.localeCompare(left.createdAt);
        });

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
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h3 className="text-lg font-semibold">Gallery</h3>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Button variant="outline" size="sm" onClick={handleExportJson} className="w-full sm:w-auto">
                        <Download className="mr-2 h-4 w-4" />
                        Export JSON
                    </Button>
                    <Button variant="outline" size="sm" onClick={onClear} className="w-full sm:w-auto">
                        <Trash2 className="mr-2 h-4 w-4" />
                        Clear Gallery
                    </Button>
                </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_160px_160px]">
                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search prompt, model, provider"
                        className="pl-9"
                    />
                </div>
                <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as typeof kindFilter)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All media</SelectItem>
                        <SelectItem value="image">Images</SelectItem>
                        <SelectItem value="video">Videos</SelectItem>
                        <SelectItem value="audio">Audio</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={sortMode} onValueChange={(value) => setSortMode(value as typeof sortMode)}>
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="newest">Newest</SelectItem>
                        <SelectItem value="oldest">Oldest</SelectItem>
                        <SelectItem value="provider">Provider</SelectItem>
                        <SelectItem value="model">Model</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                <AnimatePresence mode="popLayout">
                    {visibleItems.map((item) => {
                        const kind = resolveKind(item.kind, item.mimeType);
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
                                            <>
                                                <img
                                                    src={item.dataUrl}
                                                    alt={item.prompt}
                                                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                                    loading="lazy"
                                                />
                                                {item.model ? (
                                                    <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-2">
                                                        <span className="rounded-full bg-background/85 px-2 py-1 text-[10px] font-semibold text-foreground shadow-sm backdrop-blur">
                                                            {item.model}
                                                        </span>
                                                    </div>
                                                ) : null}
                                            </>
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
                                        <div className="absolute inset-0 bg-black/40 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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
                                            <Button
                                                size="icon"
                                                variant="destructive"
                                                onClick={() => void onDelete(item.id)}
                                                className="h-8 w-8 rounded-full"
                                                title="Delete asset"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                    <div className="p-2 text-xs text-muted-foreground bg-card border-t">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="mr-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest">
                                                {kind === "video" ? (
                                                    <Video className="h-3 w-3" />
                                                ) : kind === "audio" ? (
                                                    <AudioLines className="h-3 w-3" />
                                                ) : null}
                                                {kind}
                                            </span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => void handleCopyPrompt(item)}
                                                className="h-6 w-6"
                                                title="Copy prompt"
                                                disabled={!item.prompt?.trim()}
                                            >
                                                {copiedPromptId === item.id ? (
                                                    <Check className="h-3.5 w-3.5" />
                                                ) : (
                                                    <Copy className="h-3.5 w-3.5" />
                                                )}
                                            </Button>
                                        </div>
                                        <p className="truncate">
                                            {item.prompt}
                                        </p>
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
                kind={activeItem ? resolveKind(activeItem.kind, activeItem.mimeType) : undefined}
                mimeType={activeItem?.mimeType ?? null}
            />
        </div>
    );
}
