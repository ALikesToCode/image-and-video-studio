"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { useStudio } from "@/app/contexts/StudioContext";
import { Button } from "@/app/components/ui/button";
import {
    consumeJanitorAiImageImport,
    readJanitorAiImageImport,
} from "@/lib/client/janitorai-import";
import {
    Sparkles,
    Image as ImageIcon,
    Video,
    Music,
    Grid,
    PanelLeftClose,
    PanelLeftOpen,
    type LucideIcon,
} from "lucide-react";
import { SettingsDialog } from "@/app/components/SettingsDialog";
import { InstallAppButton } from "@/app/components/install-app-button";

type Tab = "chat" | "image" | "video" | "audio" | "gallery";

const TAB_META: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "chat", label: "Create", icon: Sparkles },
    { id: "image", label: "Image", icon: ImageIcon },
    { id: "video", label: "Video", icon: Video },
    { id: "audio", label: "Audio", icon: Music },
    { id: "gallery", label: "Library", icon: Grid },
];
const isTab = (value: string | null): value is Tab =>
    value === "chat" ||
    value === "image" ||
    value === "video" ||
    value === "audio" ||
    value === "gallery";

const ChatView = dynamic(() => import("./views/ChatView").then((mod) => mod.ChatView), {
    loading: () => <ViewLoading label="Loading chat" />,
});
const ImageGenView = dynamic(
    () => import("./views/ImageGenView").then((mod) => mod.ImageGenView),
    { loading: () => <ViewLoading label="Loading image studio" /> }
);
const VideoGenView = dynamic(
    () => import("./views/VideoGenView").then((mod) => mod.VideoGenView),
    { loading: () => <ViewLoading label="Loading video studio" /> }
);
const AudioGenView = dynamic(
    () => import("./views/AudioGenView").then((mod) => mod.AudioGenView),
    { loading: () => <ViewLoading label="Loading audio studio" /> }
);
const GalleryView = dynamic(
    () => import("./views/GalleryView").then((mod) => mod.GalleryView),
    { loading: () => <ViewLoading label="Loading gallery" /> }
);

export function Dashboard() {
    const studio = useStudio();
    const {
        handleGenerate,
        hydrated,
        mode,
        model,
        modelSuggestions,
        setMode,
        setPrompt,
    } = studio;
    const [activeTab, setActiveTab] = useState<Tab>("chat");
    const [embedMode, setEmbedMode] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [pendingJanitorAutoGeneratePrompt, setPendingJanitorAutoGeneratePrompt] =
        useState<string | null>(null);
    const [pendingJanitorImageAgentChatPrompt, setPendingJanitorImageAgentChatPrompt] =
        useState<string | null>(null);
    const janitorImportConsumedRef = useRef(false);
    const janitorAutoGenerateStartedRef = useRef(false);
    const activeTabMeta = TAB_META.find((tab) => tab.id === activeTab) ?? TAB_META[0];
    const ActiveTabIcon = activeTabMeta.icon;
    const selectedModelIsReady = modelSuggestions.some(
        (suggestion) => suggestion.id === model
    );

    useEffect(() => {
        if (!hydrated || janitorImportConsumedRef.current) return;
        if (typeof window === "undefined") return;

        const request = readJanitorAiImageImport(window.location);
        if (!request) return;

        janitorImportConsumedRef.current = true;
        consumeJanitorAiImageImport(request, {
            selectImageTab: () => setActiveTab("image"),
            setImageMode: () => setMode("image"),
            setPrompt,
            requestGeneration: setPendingJanitorAutoGeneratePrompt,
            selectImageAgentChat: () => setActiveTab("chat"),
            setImageAgentChatPrompt: setPendingJanitorImageAgentChatPrompt,
            replaceUrl: (url) => {
                window.history.replaceState(window.history.state, "", url);
            },
        });
    }, [hydrated, setMode, setPrompt]);

    useEffect(() => {
        const syncLocationState = () => {
            const params = new URLSearchParams(window.location.search);
            const view = params.get("view");
            if (isTab(view)) {
                setActiveTab(view);
            }
            setEmbedMode(params.get("embed") === "1" || params.get("embed") === "true");
        };
        const handle = window.setTimeout(syncLocationState, 0);
        window.addEventListener("popstate", syncLocationState);
        return () => {
            window.clearTimeout(handle);
            window.removeEventListener("popstate", syncLocationState);
        };
    }, []);

    useEffect(() => {
        if (!pendingJanitorAutoGeneratePrompt) return;
        if (!hydrated || mode !== "image" || !selectedModelIsReady) return;
        if (janitorAutoGenerateStartedRef.current) return;

        janitorAutoGenerateStartedRef.current = true;
        handleGenerate({
            mode: "image",
            prompt: pendingJanitorAutoGeneratePrompt,
        });
    }, [
        handleGenerate,
        hydrated,
        mode,
        pendingJanitorAutoGeneratePrompt,
        selectedModelIsReady,
    ]);

    return (
        <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
            {!embedMode ? (
                <aside
                    className={cn(
                        "relative z-20 hidden shrink-0 flex-col border-r border-border bg-background lg:flex",
                        sidebarOpen ? "w-[17rem]" : "w-[4.5rem]"
                    )}
                    aria-label="Studio navigation"
                >
                    <div
                        className={cn(
                            "flex h-[4.75rem] items-center border-b border-border px-3",
                            sidebarOpen ? "justify-between" : "justify-center"
                        )}
                    >
                        <div className={cn("min-w-0", !sidebarOpen && "hidden")}>
                            <p className="font-serif text-2xl leading-none tracking-tight">
                                Studio
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                                Creative agent
                            </p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            title={sidebarOpen ? "Collapse navigation" : "Expand navigation"}
                            aria-label={
                                sidebarOpen ? "Collapse navigation" : "Expand navigation"
                            }
                            aria-expanded={sidebarOpen}
                        >
                            {sidebarOpen ? (
                                <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
                            ) : (
                                <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
                            )}
                        </Button>
                    </div>

                    <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-5">
                        <NavGroupLabel collapsed={!sidebarOpen}>Start</NavGroupLabel>
                        <NavButton
                            active={activeTab === "chat"}
                            onClick={() => setActiveTab("chat")}
                            icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
                            label="Create anything"
                            collapsed={!sidebarOpen}
                        />

                        <NavGroupLabel collapsed={!sidebarOpen}>Tools</NavGroupLabel>
                        <div className="space-y-1">
                            <NavButton
                                active={activeTab === "image"}
                                onClick={() => setActiveTab("image")}
                                icon={<ImageIcon className="h-5 w-5" aria-hidden="true" />}
                                label="Image"
                                collapsed={!sidebarOpen}
                            />
                            <NavButton
                                active={activeTab === "video"}
                                onClick={() => setActiveTab("video")}
                                icon={<Video className="h-5 w-5" aria-hidden="true" />}
                                label="Video"
                                collapsed={!sidebarOpen}
                            />
                            <NavButton
                                active={activeTab === "audio"}
                                onClick={() => setActiveTab("audio")}
                                icon={<Music className="h-5 w-5" aria-hidden="true" />}
                                label="Audio"
                                collapsed={!sidebarOpen}
                            />
                        </div>

                        <NavGroupLabel collapsed={!sidebarOpen}>Your work</NavGroupLabel>
                        <NavButton
                            active={activeTab === "gallery"}
                            onClick={() => setActiveTab("gallery")}
                            icon={<Grid className="h-5 w-5" aria-hidden="true" />}
                            label="Library"
                            collapsed={!sidebarOpen}
                        />
                    </nav>

                    <div className="border-t border-border p-3">
                        <div
                            className={cn(
                                "flex min-h-11 items-center",
                                sidebarOpen ? "justify-between pl-3" : "justify-center"
                            )}
                        >
                            {sidebarOpen ? (
                                <span className="text-sm text-muted-foreground">
                                    Preferences
                                </span>
                            ) : null}
                            <SettingsDialog />
                        </div>
                    </div>
                </aside>
            ) : null}

            <div className="flex min-w-0 flex-1 flex-col">
                {!embedMode ? (
                    <header className="shrink-0 border-b border-border bg-background px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.45rem)] lg:hidden">
                        <div className="flex min-h-12 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                                <div
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm"
                                    aria-hidden="true"
                                >
                                    <ActiveTabIcon className="h-4 w-4" aria-hidden="true" />
                                </div>
                                <div className="min-w-0">
                                    <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                                        Studio
                                    </p>
                                    <p className="truncate text-sm font-semibold leading-tight">
                                        {activeTabMeta.label}
                                    </p>
                                </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                                <InstallAppButton className="rounded-xl" />
                                <SettingsDialog />
                            </div>
                        </div>
                    </header>
                ) : null}

                <main className="relative min-h-0 flex-1 overflow-hidden bg-background">
                    <div className="absolute inset-0 overflow-y-auto no-scrollbar p-0">
                        <div className={cn("h-full", activeTab === "chat" ? "block" : "hidden")}>
                            <ChatView initialInput={pendingJanitorImageAgentChatPrompt} />
                        </div>
                        {activeTab === "image" && <ImageGenView />}
                        {activeTab === "video" && <VideoGenView />}
                        {activeTab === "audio" && <AudioGenView />}
                        {activeTab === "gallery" && <GalleryView />}
                    </div>
                </main>

                {!embedMode ? (
                    <nav
                        className="shrink-0 border-t border-border bg-background px-2 pb-[calc(env(safe-area-inset-bottom)+0.45rem)] pt-2 shadow-[var(--shadow-raised)] lg:hidden"
                        aria-label="Studio sections"
                    >
                        <div className="grid grid-cols-5 gap-1">
                            {TAB_META.map((tab) => {
                                const Icon = tab.icon;
                                const isActive = activeTab === tab.id;
                                return (
                                    <Button
                                        key={tab.id}
                                        variant={isActive ? "default" : "ghost"}
                                        className={cn(
                                            "h-14 flex-col gap-1 rounded-xl px-1 text-[10px]",
                                            isActive
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                        )}
                                        onClick={() => setActiveTab(tab.id)}
                                        title={tab.label}
                                        aria-current={isActive ? "page" : undefined}
                                    >
                                        <Icon className="h-4 w-4" aria-hidden="true" />
                                        <span className="max-w-full truncate leading-none">
                                            {tab.label}
                                        </span>
                                    </Button>
                                );
                            })}
                        </div>
                    </nav>
                ) : null}
            </div>
        </div>
    );
}

function ViewLoading({ label }: { label: string }) {
    return (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {label}...
        </div>
    );
}

function NavButton({
    active,
    onClick,
    icon,
    label,
    collapsed
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    collapsed: boolean;
}) {
    return (
        <Button
            variant="ghost"
            size={collapsed ? "icon" : "default"}
            className={cn(
                "relative h-11 w-full rounded-lg transition-[background-color,color,box-shadow,transform] duration-150",
                collapsed ? "justify-center px-0" : "justify-start px-3",
                active
                    ? "bg-primary/10 text-primary shadow-sm"
                    : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
            )}
            onClick={onClick}
            title={collapsed ? label : undefined}
            aria-label={collapsed ? label : undefined}
            aria-current={active ? "page" : undefined}
        >
            <span
                className={cn(
                    "absolute left-0 h-5 w-0.5 rounded-r bg-transparent",
                    active && "bg-primary"
                )}
                aria-hidden="true"
            />
            {icon}
            {!collapsed && <span className="ml-2">{label}</span>}
        </Button>
    );
}

function NavGroupLabel({
    children,
    collapsed,
}: {
    children: React.ReactNode;
    collapsed: boolean;
}) {
    return (
        <div
            className={cn(
                "mb-2 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground first:mt-0",
                collapsed && "h-px bg-border p-0 text-transparent"
            )}
            aria-hidden={collapsed}
        >
            {children}
        </div>
    );
}
