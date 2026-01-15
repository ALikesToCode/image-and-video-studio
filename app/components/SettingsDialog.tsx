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
import { useEffect, useState } from "react";
import { Provider } from "@/lib/constants";

export function SettingsDialog() {
    const { apiKey, setApiKey, provider, setProvider } = useStudio();

    const [localProvider, setLocalProvider] = useState<Provider>(provider);
    const [localKey, setLocalKey] = useState("");
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setLocalProvider(provider);
        }
    }, [isOpen, provider]);

    useEffect(() => {
        setLocalKey(apiKey);
    }, [apiKey]);

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
                                        variant={
                                            localProvider === entry ? "default" : "outline"
                                        }
                                        size="sm"
                                        onClick={() => {
                                            setProvider(entry);
                                            setLocalProvider(entry);
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
                        <Label htmlFor="apiKey" className="text-right">
                            API Key
                        </Label>
                        <Input
                            id="apiKey"
                            type="password"
                            value={localKey}
                            onChange={(event) => {
                                setLocalKey(event.target.value);
                                setApiKey(event.target.value);
                            }}
                            className="col-span-3 font-mono text-sm"
                            placeholder="sk-..."
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
