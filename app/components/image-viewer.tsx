"use client";

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/app/components/ui/dialog";

type ImageViewerProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    imageUrl: string | null;
    prompt: string;
    model: string;
    provider?: string;
};

export function ImageViewer({
    open,
    onOpenChange,
    imageUrl,
    prompt,
    model,
    provider,
}: ImageViewerProps) {
    if (!imageUrl) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-none w-[96vw] h-[92vh] p-0 overflow-hidden">
                <DialogHeader className="sr-only">
                    <DialogTitle>Image preview</DialogTitle>
                    <DialogDescription>Full screen image preview.</DialogDescription>
                </DialogHeader>
                <div className="flex h-full flex-col lg:flex-row">
                    <div className="flex-1 bg-black/90 flex items-center justify-center p-4">
                        <img
                            src={imageUrl}
                            alt={prompt || "Generated image"}
                            className="max-h-full max-w-full object-contain"
                        />
                    </div>
                    <div className="w-full lg:w-[360px] border-t lg:border-t-0 lg:border-l bg-card p-6 overflow-y-auto">
                        <div className="space-y-4">
                            <div>
                                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                                    Prompt
                                </p>
                                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                                    {prompt || "No prompt available."}
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
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
