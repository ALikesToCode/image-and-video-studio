"use client";

import { useStudio } from "@/app/contexts/StudioContext";
import { GalleryGrid } from "../gallery-grid";

export function GalleryView() {
    const { savedMedia, clearGallery } = useStudio();

    return (
        <div className="h-full w-full p-6 lg:p-12 overflow-y-auto space-y-8">
            <div className="flex items-center gap-4">
                <h2 className="text-3xl font-serif text-gradient font-bold tracking-tight">Gallery</h2>
                <div className="h-px flex-1 bg-border/60" />
            </div>
            <GalleryGrid items={savedMedia} onClear={clearGallery} />
        </div>
    );
}
