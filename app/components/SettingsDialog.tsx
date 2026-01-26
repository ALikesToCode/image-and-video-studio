"use client";

import { Button } from "@/app/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useStudio } from "@/app/contexts/StudioContext";
import { Settings } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { Provider } from "@/lib/constants";

export function SettingsDialog() {
    const { apiKeys, setApiKeyForProvider, provider, setProvider } = useStudio();

    const [isOpen, setIsOpen] = useState(false);

    const handleKeyChange = (target: Provider) => (event: ChangeEvent<HTMLInputElement>) => {
        setApiKeyForProvider(target, event.target.value);
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" title="Settings">
                    <Settings className="h-5 w-5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Configure your API keys. These are stored locally in your browser.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="provider" className="text-right">
                            Provider
                        </Label>
                        <div className="col-span-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                            {(["gemini", "navy", "openrouter", "chutes"] as const).map(
                                (entry) => (
                                    <Button
                                        key={entry}
                                        variant={provider === entry ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => {
                                            setProvider(entry);
                                        }}
                                        className="capitalize"
                                    >
                                        {entry}
                                    </Button>
                                )
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="apiKeyGemini" className="text-right">
                            Gemini Key
                        </Label>
                        <Input
                            id="apiKeyGemini"
                            type="password"
                            value={apiKeys.gemini}
                            onChange={handleKeyChange("gemini")}
                            className="col-span-3 font-mono text-sm"
                            placeholder="Gemini API key"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="apiKeyNavy" className="text-right">
                            NavyAI Key
                        </Label>
                        <Input
                            id="apiKeyNavy"
                            type="password"
                            value={apiKeys.navy}
                            onChange={handleKeyChange("navy")}
                            className="col-span-3 font-mono text-sm"
                            placeholder="NavyAI API key"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="apiKeyOpenRouter" className="text-right">
                            OpenRouter Key
                        </Label>
                        <Input
                            id="apiKeyOpenRouter"
                            type="password"
                            value={apiKeys.openrouter}
                            onChange={handleKeyChange("openrouter")}
                            className="col-span-3 font-mono text-sm"
                            placeholder="OpenRouter API key"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="apiKeyChutes" className="text-right">
                            Chutes Key
                        </Label>
                        <Input
                            id="apiKeyChutes"
                            type="password"
                            value={apiKeys.chutes}
                            onChange={handleKeyChange("chutes")}
                            className="col-span-3 font-mono text-sm"
                            placeholder="Chutes API key"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={() => setIsOpen(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
