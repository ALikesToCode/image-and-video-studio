"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import { Check, ImagePlus, X } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Label } from "@/app/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/app/components/ui/select";
import { cn } from "@/lib/utils";
import type { ReferenceRole, StoredReference } from "@/lib/types";

const ROLE_OPTIONS: Array<{ value: ReferenceRole; label: string }> = [
    { value: "general", label: "General" },
    { value: "character", label: "Character" },
    { value: "object", label: "Object/Product" },
    { value: "style", label: "Style" },
    { value: "source_image", label: "Source" },
    { value: "first_frame", label: "First frame" },
    { value: "last_frame", label: "Last frame" },
];

type ReferenceStripProps = {
    references: StoredReference[];
    selectedReferenceIds: string[];
    onAddReference: (file: File, role?: ReferenceRole) => Promise<void>;
    onToggleReference: (id: string) => void;
    onRemoveReference: (id: string) => Promise<void>;
    onClearSelected: () => void;
    compact?: boolean;
};

export function ReferenceStrip({
    references,
    selectedReferenceIds,
    onAddReference,
    onToggleReference,
    onRemoveReference,
    onClearSelected,
    compact = false,
}: ReferenceStripProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [role, setRole] = useState<ReferenceRole>("general");
    const [dragging, setDragging] = useState(false);
    const selected = new Set(selectedReferenceIds);

    const handleFiles = async (files: FileList | File[]) => {
        const [file] = Array.from(files);
        if (!file) return;
        await onAddReference(file, role);
    };

    return (
        <section className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h3 className="text-sm font-semibold">References</h3>
                    <p className="text-xs text-muted-foreground">
                        {selectedReferenceIds.length
                            ? `${selectedReferenceIds.length} selected for the next job`
                            : "Upload local images for edit, source, or style guidance."}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="w-36">
                        <Label className="sr-only">Reference role</Label>
                        <Select value={role} onValueChange={(value) => setRole(value as ReferenceRole)}>
                            <SelectTrigger className="h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ROLE_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            if (event.target.files) void handleFiles(event.target.files);
                            event.currentTarget.value = "";
                        }}
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
                        <ImagePlus className="h-4 w-4" />
                        Add
                    </Button>
                    {selectedReferenceIds.length ? (
                        <Button type="button" size="sm" variant="ghost" onClick={onClearSelected}>
                            Clear
                        </Button>
                    ) : null}
                </div>
            </div>

            <div
                className={cn(
                    "rounded-lg border border-dashed p-2 transition-colors",
                    dragging ? "border-primary bg-primary/5" : "border-border/50",
                    compact ? "min-h-20" : "min-h-24"
                )}
                onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void handleFiles(event.dataTransfer.files);
                }}
            >
                {references.length ? (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                        {references.map((reference) => {
                            const isSelected = selected.has(reference.id);
                            return (
                                <div key={reference.id} className="relative h-20 w-20 flex-none overflow-hidden rounded-lg border bg-muted">
                                    <button
                                        type="button"
                                        className="h-full w-full"
                                        onClick={() => onToggleReference(reference.id)}
                                        aria-label={`${isSelected ? "Deselect" : "Select"} ${reference.label ?? "reference"}`}
                                    >
                                        <img src={reference.dataUrl} alt={reference.label ?? "Reference"} className="h-full w-full object-cover" />
                                        <span className="absolute bottom-1 left-1 max-w-[4.3rem] truncate rounded bg-background/85 px-1.5 py-0.5 text-[10px] font-medium">
                                            {reference.role.replace("_", " ")}
                                        </span>
                                        {isSelected ? (
                                            <span className="absolute right-1 top-1 rounded-full bg-primary p-1 text-primary-foreground">
                                                <Check className="h-3 w-3" />
                                            </span>
                                        ) : null}
                                    </button>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="secondary"
                                        className="absolute left-1 top-1 h-6 w-6 rounded-full"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void onRemoveReference(reference.id);
                                        }}
                                        title="Remove reference"
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <button
                        type="button"
                        className="flex min-h-20 w-full items-center justify-center gap-2 rounded-md text-sm text-muted-foreground"
                        onClick={() => inputRef.current?.click()}
                    >
                        <ImagePlus className="h-4 w-4" />
                        Drop or add a local reference image
                    </button>
                )}
            </div>
        </section>
    );
}
