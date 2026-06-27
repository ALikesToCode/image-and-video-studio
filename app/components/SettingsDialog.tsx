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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/app/components/ui/select";
import { useStudio } from "@/app/contexts/StudioContext";
import { AlertTriangle, HardDrive, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type ChangeEvent } from "react";
import { Provider } from "@/lib/constants";
import type { KeyStorageMode } from "@/lib/client/key-storage";

export function SettingsDialog() {
    const {
        apiKeys,
        setApiKeyForProvider,
        provider,
        setProvider,
        clearGallery,
        storageSnapshot,
        storageError,
        refreshStorageEstimate,
        requestPersistentStorage,
        keyStorageMode,
        setKeyStorageMode,
        legacyProviderKeys,
        migrateLegacyProviderKeys,
        discardLegacyProviderKeys,
        clearAllKeys,
    } = useStudio();

    const [isOpen, setIsOpen] = useState(false);

    const handleKeyChange = (target: Provider) => (event: ChangeEvent<HTMLInputElement>) => {
        setApiKeyForProvider(target, event.target.value);
    };
    const formatBytes = (value?: number) => {
        if (!value) return "0 MB";
        return `${(value / 1024 / 1024).toFixed(1)} MB`;
    };
    const forgetProviderKey = (target: Provider) => {
        setApiKeyForProvider(target, "");
    };

    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button variant="ghost" size="icon" title="Settings">
                    <Settings className="h-5 w-5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Configure your API keys. These are stored locally in your browser.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm">
                        <div className="mb-2 flex items-center gap-2 font-semibold">
                            <ShieldCheck className="h-4 w-4 text-primary" />
                            Privacy & Storage
                        </div>
                        <p className="text-xs text-muted-foreground">
                            API keys stay in this browser. Requests are proxied through app API routes so provider CORS and downloads work, but keys and generated assets are not persisted on the server.
                        </p>
                        <div className="mt-3 space-y-2">
                            <Label>API key storage mode</Label>
                            <Select
                                value={keyStorageMode}
                                onValueChange={(value) => setKeyStorageMode(value as KeyStorageMode)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="session">Session, clears when this browser session ends</SelectItem>
                                    <SelectItem value="manual">Manual, memory only until reload</SelectItem>
                                    <SelectItem value="persistent">Persistent localStorage, opt-in</SelectItem>
                                </SelectContent>
                            </Select>
                            {keyStorageMode === "persistent" ? (
                                <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                                    Persistent mode stores keys in localStorage. Scripts running on this origin can read localStorage, and values persist across browser sessions.
                                </p>
                            ) : null}
                        </div>
                        {legacyProviderKeys.length ? (
                            <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                                <div className="mb-2 flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                                    <AlertTriangle className="h-4 w-4" />
                                    Old persistent API keys found
                                </div>
                                <p className="text-muted-foreground">
                                    Old localStorage keys exist for {legacyProviderKeys.map((entry) => entry.provider).join(", ")}. Migrate them into the selected storage mode or discard them now.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <Button type="button" variant="outline" size="sm" onClick={() => migrateLegacyProviderKeys()}>
                                        Migrate to selected mode
                                    </Button>
                                    <Button type="button" variant="ghost" size="sm" onClick={discardLegacyProviderKeys}>
                                        Discard old keys
                                    </Button>
                                </div>
                            </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={clearAllKeys}>
                                <Trash2 className="h-4 w-4" />
                                Clear all keys
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={clearGallery}>
                                Clear gallery
                            </Button>
                        </div>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm">
                        <div className="mb-2 flex items-center gap-2 font-semibold">
                            <HardDrive className="h-4 w-4 text-primary" />
                            Local browser storage
                        </div>
                        {storageSnapshot ? (
                            <p className="text-xs text-muted-foreground">
                                Using {formatBytes(storageSnapshot.usage)} of {formatBytes(storageSnapshot.quota)}
                                {storageSnapshot.persistent === null
                                    ? "."
                                    : storageSnapshot.persistent
                                        ? ". Persistent storage is granted."
                                        : ". Persistent storage is not granted."}
                            </p>
                        ) : (
                            <p className="text-xs text-muted-foreground">Storage usage has not been checked yet.</p>
                        )}
                        {storageError ? <p className="mt-2 text-xs text-destructive">{storageError}</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => void refreshStorageEstimate()}>
                                Estimate usage
                            </Button>
                            <Button type="button" variant="outline" size="sm" onClick={() => void requestPersistentStorage()}>
                                Request persistence
                            </Button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="provider" className="sm:text-right">
                            Provider
                        </Label>
                        <div className="sm:col-span-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                            {(["gemini", "navy", "openrouter", "chutes", "nanogpt"] as const).map(
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
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="apiKeyGemini" className="sm:text-right">
                            Gemini Key
                        </Label>
                        <div className="flex gap-2 sm:col-span-3">
                            <Input
                                id="apiKeyGemini"
                                type="password"
                                value={apiKeys.gemini}
                                onChange={handleKeyChange("gemini")}
                                className="font-mono text-sm"
                                placeholder="Gemini API key"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <Button type="button" variant="outline" onClick={() => forgetProviderKey("gemini")}>
                                Forget
                            </Button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="apiKeyNavy" className="sm:text-right">
                            NavyAI Key
                        </Label>
                        <div className="flex gap-2 sm:col-span-3">
                            <Input
                                id="apiKeyNavy"
                                type="password"
                                value={apiKeys.navy}
                                onChange={handleKeyChange("navy")}
                                className="font-mono text-sm"
                                placeholder="NavyAI API key"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <Button type="button" variant="outline" onClick={() => forgetProviderKey("navy")}>
                                Forget
                            </Button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="apiKeyOpenRouter" className="sm:text-right">
                            OpenRouter Key
                        </Label>
                        <div className="flex gap-2 sm:col-span-3">
                            <Input
                                id="apiKeyOpenRouter"
                                type="password"
                                value={apiKeys.openrouter}
                                onChange={handleKeyChange("openrouter")}
                                className="font-mono text-sm"
                                placeholder="OpenRouter API key"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <Button type="button" variant="outline" onClick={() => forgetProviderKey("openrouter")}>
                                Forget
                            </Button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="apiKeyChutes" className="sm:text-right">
                            Chutes Key
                        </Label>
                        <div className="flex gap-2 sm:col-span-3">
                            <Input
                                id="apiKeyChutes"
                                type="password"
                                value={apiKeys.chutes}
                                onChange={handleKeyChange("chutes")}
                                className="font-mono text-sm"
                                placeholder="Chutes API key"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <Button type="button" variant="outline" onClick={() => forgetProviderKey("chutes")}>
                                Forget
                            </Button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="apiKeyNanoGpt" className="sm:text-right">
                            NanoGPT Key
                        </Label>
                        <div className="flex gap-2 sm:col-span-3">
                            <Input
                                id="apiKeyNanoGpt"
                                type="password"
                                value={apiKeys.nanogpt}
                                onChange={handleKeyChange("nanogpt")}
                                className="font-mono text-sm"
                                placeholder="NanoGPT API key"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <Button type="button" variant="outline" onClick={() => forgetProviderKey("nanogpt")}>
                                Forget
                            </Button>
                        </div>
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={() => setIsOpen(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
