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
import {
    AlertTriangle,
    HardDrive,
    RefreshCw,
    Settings,
    ShieldCheck,
    Trash2,
    WalletCards,
} from "lucide-react";
import { useState, type ChangeEvent } from "react";
import type { Provider } from "@/lib/constants";
import type { KeyStorageMode } from "@/lib/client/key-storage";
import { MultiLlmUsagePanel } from "@/app/components/settings/MultiLlmUsagePanel";

const formatUsd = (value: number | string) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return String(value);
    return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
    }).format(parsed);
};

const formatCount = (value: number | string) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) return String(value);
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(parsed);
};

const subscriptionPercent = (value: number) =>
    Math.min(100, Math.max(0, value * 100));

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
        nanoGptAccount,
        nanoGptAccountError,
        nanoGptAccountLoading,
        nanoGptAccountUpdatedAt,
        refreshNanoGptAccount,
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
                <Button
                    variant="ghost"
                    size="icon"
                    title="Settings"
                    aria-label="Settings"
                >
                    <Settings className="h-5 w-5" />
                </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-[760px]">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Configure browser-held API keys and review provider account status.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm">
                        <div className="mb-2 flex items-center gap-2 font-semibold">
                            <ShieldCheck className="h-4 w-4 text-primary" />
                            Privacy & Storage
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Browser-entered API keys stay in this browser. Requests are proxied through app API routes so provider CORS and downloads work. A deployment may optionally provide its MultiLLM key as a server-side environment secret.
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
                            {(["gemini", "navy", "openrouter", "chutes", "nanogpt", "multillm"] as const).map(
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
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 sm:items-center sm:gap-4">
                        <Label htmlFor="apiKeyMultiLlm" className="sm:text-right">
                            MultiLLM Key
                        </Label>
                        <div className="flex gap-2 sm:col-span-3">
                            <Input
                                id="apiKeyMultiLlm"
                                type="password"
                                value={apiKeys.multillm}
                                onChange={handleKeyChange("multillm")}
                                className="font-mono text-sm"
                                placeholder="Optional when configured server-side"
                                autoComplete="off"
                                spellCheck={false}
                            />
                            <Button type="button" variant="outline" onClick={() => forgetProviderKey("multillm")}>
                                Forget
                            </Button>
                        </div>
                    </div>
                    {provider === "nanogpt" ? (
                        <section
                            aria-labelledby="nanogpt-account-heading"
                            className="rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="flex items-center gap-2 font-semibold" id="nanogpt-account-heading">
                                        <WalletCards className="h-4 w-4 text-primary" aria-hidden="true" />
                                        NanoGPT account
                                    </h3>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Balance and current billing-period usage.
                                    </p>
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void refreshNanoGptAccount()}
                                    disabled={!apiKeys.nanogpt.trim() || nanoGptAccountLoading}
                                    aria-label="Refresh NanoGPT account details"
                                >
                                    <RefreshCw
                                        className={`h-4 w-4 ${nanoGptAccountLoading ? "animate-spin" : ""}`}
                                        aria-hidden="true"
                                    />
                                    Refresh
                                </Button>
                            </div>

                            <div className="mt-4" aria-live="polite">
                                {nanoGptAccountError ? (
                                    <p className="text-xs text-destructive" role="alert">
                                        {nanoGptAccountError}
                                    </p>
                                ) : nanoGptAccount ? (
                                    <div className="space-y-3">
                                        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                            <div className="rounded-lg border border-border/40 bg-background/60 p-2.5">
                                                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">USD balance</dt>
                                                <dd className="mt-1 font-semibold tabular-nums">
                                                    {formatUsd(nanoGptAccount.balance.usdBalance)}
                                                </dd>
                                            </div>
                                            <div className="rounded-lg border border-border/40 bg-background/60 p-2.5">
                                                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">NANO balance</dt>
                                                <dd className="mt-1 font-semibold tabular-nums">
                                                    {formatCount(nanoGptAccount.balance.nanoBalance)}
                                                </dd>
                                            </div>
                                            <div className="rounded-lg border border-border/40 bg-background/60 p-2.5">
                                                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Net spend</dt>
                                                <dd className="mt-1 font-semibold tabular-nums">
                                                    {formatUsd(nanoGptAccount.usage.totals.netCostUsd)}
                                                </dd>
                                            </div>
                                            <div className="rounded-lg border border-border/40 bg-background/60 p-2.5">
                                                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Requests</dt>
                                                <dd className="mt-1 font-semibold tabular-nums">
                                                    {formatCount(nanoGptAccount.usage.totals.requests)}
                                                </dd>
                                            </div>
                                        </dl>

                                        {nanoGptAccount.subscription ? (
                                            <div className="rounded-lg border border-border/40 bg-background/40 p-3">
                                                <div className="flex items-center justify-between gap-3 text-xs">
                                                    <span className="font-medium">Daily subscription usage</span>
                                                    <span className="tabular-nums text-muted-foreground">
                                                        {formatCount(nanoGptAccount.subscription.daily.remaining)} remaining
                                                    </span>
                                                </div>
                                                <div
                                                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary"
                                                    role="progressbar"
                                                    aria-label="NanoGPT daily subscription usage"
                                                    aria-valuemin={0}
                                                    aria-valuemax={100}
                                                    aria-valuenow={subscriptionPercent(
                                                        nanoGptAccount.subscription.daily.percentUsed
                                                    )}
                                                >
                                                    <div
                                                        className="h-full rounded-full bg-primary"
                                                        style={{
                                                            width: `${subscriptionPercent(
                                                                nanoGptAccount.subscription.daily.percentUsed
                                                            )}%`,
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-muted-foreground">
                                                No active subscription usage was returned; balance usage is still available.
                                            </p>
                                        )}

                                        {nanoGptAccount.warnings?.map((warning) => (
                                            <p
                                                key={`${warning.section}:${warning.status}:${warning.code ?? "warning"}`}
                                                className="text-xs text-amber-700 dark:text-amber-300"
                                                role="status"
                                            >
                                                {warning.error}
                                            </p>
                                        ))}
                                        <p className="text-right text-[10px] text-muted-foreground">
                                            Usage {nanoGptAccount.usage.from}–{nanoGptAccount.usage.to} UTC
                                            {nanoGptAccountUpdatedAt
                                                ? ` · Updated ${new Date(nanoGptAccountUpdatedAt).toLocaleTimeString()}`
                                                : ""}
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-xs text-muted-foreground">
                                        {apiKeys.nanogpt.trim()
                                            ? nanoGptAccountLoading
                                                ? "Loading NanoGPT account details…"
                                                : "Refresh to check this account."
                                            : "Add a NanoGPT API key to check balance and usage."}
                                    </p>
                                )}
                            </div>
                        </section>
                    ) : null}
                    {provider === "multillm" ? (
                        <MultiLlmUsagePanel apiKey={apiKeys.multillm} />
                    ) : null}
                </div>
                <DialogFooter>
                    <Button onClick={() => setIsOpen(false)}>Done</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
