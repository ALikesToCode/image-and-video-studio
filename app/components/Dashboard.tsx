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
    MessageSquare,
    Image as ImageIcon,
    Video,
    Music,
    Grid,
    Menu,
    type LucideIcon,
} from "lucide-react";
import { SettingsDialog } from "@/app/components/SettingsDialog";
import { InstallAppButton } from "@/app/components/install-app-button";

type Tab = "chat" | "image" | "video" | "audio" | "gallery";

const TAB_META: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "image", label: "Image", icon: ImageIcon },
    { id: "video", label: "Video", icon: Video },
    { id: "audio", label: "Audio", icon: Music },
    { id: "gallery", label: "Gallery", icon: Grid },
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
            {/* Desktop Sidebar */}
            {!embedMode ? (
            <aside
                className={cn(
                    "relative z-20 hidden flex-col border-r bg-background/95 backdrop-blur transition-all duration-300 ease-in-out lg:flex",
                    sidebarOpen ? "w-64" : "w-[70px]"
                )}
            >
                <div className="flex h-14 items-center justify-between px-4 border-b">
                    <div className={cn("font-bold text-xl tracking-tighter text-gradient flex items-center gap-2", !sidebarOpen && "hidden")}>
                        <span>Studio</span>
                        <span className="text-[10px] font-mono font-normal opacity-50 border rounded px-1">BETA</span>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle Sidebar">
                        <Menu className="h-4 w-4" />
                    </Button>
                </div>

                <nav className="flex-1 space-y-2 p-2 overflow-y-auto">
                    <NavButton
                        active={activeTab === "chat"}
                        onClick={() => setActiveTab("chat")}
                        icon={<MessageSquare className="h-5 w-5" />}
                        label="Chat & Agent"
                        collapsed={!sidebarOpen}
                    />
                    <div className="my-2 border-t border-border/50" />
                    <NavButton
                        active={activeTab === "image"}
                        onClick={() => setActiveTab("image")}
                        icon={<ImageIcon className="h-5 w-5" />}
                        label="Image Generation"
                        collapsed={!sidebarOpen}
                    />
                    <NavButton
                        active={activeTab === "video"}
                        onClick={() => setActiveTab("video")}
                        icon={<Video className="h-5 w-5" />}
                        label="Video Generation"
                        collapsed={!sidebarOpen}
                    />
                    <NavButton
                        active={activeTab === "audio"}
                        onClick={() => setActiveTab("audio")}
                        icon={<Music className="h-5 w-5" />}
                        label="Audio / TTS"
                        collapsed={!sidebarOpen}
                    />
                    <div className="my-2 border-t border-border/50" />
                    <NavButton
                        active={activeTab === "gallery"}
                        onClick={() => setActiveTab("gallery")}
                        icon={<Grid className="h-5 w-5" />}
                        label="Gallery"
                        collapsed={!sidebarOpen}
                    />
                </nav>

                <div className="border-t p-2">
                    <div className={cn("flex items-center", sidebarOpen ? "justify-between px-2" : "justify-center")}>
                        {sidebarOpen && <span className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Settings</span>}
                        <SettingsDialog />
                    </div>
                </div>
            </aside>
            ) : null}

            {/* Content Shell */}
            <div className="flex min-w-0 flex-1 flex-col">
                {/* Mobile Header */}
                {!embedMode ? (
                <header className="glass shrink-0 border-b px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.45rem)] shadow-sm shadow-black/5 lg:hidden">
                    <div className="flex min-h-12 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="rounded-xl bg-primary text-primary-foreground p-2 shadow-sm">
                                <ActiveTabIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    Studio
                                </p>
                                <p className="truncate text-sm font-semibold leading-tight">{activeTabMeta.label}</p>
                            </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <InstallAppButton className="rounded-xl" />
                            <SettingsDialog />
                        </div>
                    </div>
                </header>
                ) : null}

                {/* Main Content */}
                <main className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top,hsla(var(--primary),0.08),transparent_34rem),hsl(var(--background))]">
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

                {/* Mobile Bottom Navigation */}
                {!embedMode ? (
                <nav className="glass shrink-0 border-t px-2 pb-[calc(env(safe-area-inset-bottom)+0.45rem)] pt-2 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] lg:hidden">
                    <div className="grid grid-cols-5 gap-1">
                        {TAB_META.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <Button
                                    key={tab.id}
                                    variant={isActive ? "default" : "ghost"}
                                    className={cn(
                                        "h-[3.35rem] flex-col gap-1 rounded-2xl px-1 text-[10px] transition-all",
                                        isActive
                                            ? "bg-primary text-primary-foreground shadow-sm"
                                            : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
                                    )}
                                    onClick={() => setActiveTab(tab.id)}
                                    title={tab.label}
                                    aria-current={isActive ? "page" : undefined}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span className="max-w-full truncate leading-none">{tab.label}</span>
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
            variant={active ? "secondary" : "ghost"}
            size={collapsed ? "icon" : "default"}
            className={cn(
                "w-full transition-all duration-200",
                collapsed ? "justify-center px-0" : "justify-start px-4",
                active && "bg-secondary/50 shadow-sm"
            )}
            onClick={onClick}
            title={collapsed ? label : undefined}
        >
            {icon}
            {!collapsed && <span className="ml-3">{label}</span>}
        </Button>
    );
}
