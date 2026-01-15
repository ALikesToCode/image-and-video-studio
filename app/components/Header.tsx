import { Palette, Zap, HardDrive } from "lucide-react";
import { ModeToggle } from "./mode-toggle";

export function Header() {
    return (
        <header className="sticky top-0 z-50 w-full border-b border-border/40 glass">
            <div className="container flex h-16 items-center justify-between py-4">
                <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center rounded-lg bg-primary/10 p-2 text-primary">
                        <Palette className="h-5 w-5" />
                    </div>
                    <div className="hidden space-y-0.5 md:block">
                        <h1 className="font-serif text-xl font-bold tracking-tight text-gradient md:text-2xl">
                            Image & Video Studio
                        </h1>
                    </div>
                </div>

                <div className="flex items-center gap-2 md:gap-4">
                    <div className="hidden items-center gap-4 rounded-full border bg-background/50 px-4 py-1.5 text-xs font-medium shadow-sm md:flex">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Zap className="h-3.5 w-3.5 text-amber-500" />
                            <span>Edge Runtime</span>
                        </div>
                        <div className="h-3 w-px bg-border" />
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                            <HardDrive className="h-3.5 w-3.5 text-blue-500" />
                            <span>Local Storage</span>
                        </div>
                    </div>

                    <ModeToggle />
                </div>
            </div>
        </header>
    );
}
