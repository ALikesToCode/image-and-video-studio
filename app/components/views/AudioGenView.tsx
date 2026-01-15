"use client";

import { useStudio } from "@/app/contexts/StudioContext";
import { useEffect } from "react";

export function AudioGenView() {
    const { setMode, mode } = useStudio();

    useEffect(() => {
        if (mode !== "tts") setMode("tts");
    }, [mode, setMode]);

    return (
        <div className="p-12 flex items-center justify-center h-full text-muted-foreground">
            Audio Generation View (Coming Soon - Reusing Image Logic)
        </div>
    );
}
