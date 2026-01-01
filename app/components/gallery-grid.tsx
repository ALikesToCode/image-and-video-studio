import { StoredImage } from "@/lib/types";
import { Download, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { motion, AnimatePresence } from "framer-motion";

interface GalleryGridProps {
    images: StoredImage[];
    onClear: () => void;
}

export function GalleryGrid({ images, onClear }: GalleryGridProps) {
    const handleDownload = (dataUrl: string, id: string) => {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = `generation-${id}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (images.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-muted-foreground">
                <p>No saved generations yet.</p>
                <p className="text-sm">Turn on "Save to local gallery" to keep them here.</p>
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
                    {images.map((img) => (
                        <motion.div
                            key={img.id}
                            layout
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.2 }}
                        >
                            <Card className="overflow-hidden group relative border-0 shadow-md">
                                <div className="aspect-square relative">
                                    <img
                                        src={img.dataUrl}
                                        alt={img.prompt}
                                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                        loading="lazy"
                                    />
                                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                        <Button
                                            size="icon"
                                            variant="secondary"
                                            onClick={() => handleDownload(img.dataUrl, img.id)}
                                            className="h-8 w-8 rounded-full"
                                        >
                                            <Download className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                                <div className="p-2 text-xs text-muted-foreground truncate bg-card border-t">
                                    {img.prompt}
                                </div>
                            </Card>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}
