"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/app/components/ui/button";
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
import { ChatView } from "./views/ChatView";
import { ImageGenView } from "./views/ImageGenView";
import { VideoGenView } from "./views/VideoGenView";
import { AudioGenView } from "./views/AudioGenView";
import { GalleryView } from "./views/GalleryView";

type Tab = "chat" | "image" | "video" | "audio" | "gallery";

const TAB_META: { id: Tab; label: string; icon: LucideIcon }[] = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "image", label: "Image", icon: ImageIcon },
    { id: "video", label: "Video", icon: Video },
    { id: "audio", label: "Audio", icon: Music },
    { id: "gallery", label: "Gallery", icon: Grid },
];

export function Dashboard() {
    const [activeTab, setActiveTab] = useState<Tab>("chat");
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const activeTabMeta = TAB_META.find((tab) => tab.id === activeTab) ?? TAB_META[0];
    const ActiveTabIcon = activeTabMeta.icon;

    return (
        <div className="flex h-[100dvh] w-full overflow-hidden bg-background text-foreground">
            {/* Desktop Sidebar */}
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

            {/* Content Shell */}
            <div className="flex min-w-0 flex-1 flex-col">
                {/* Mobile Header */}
                <header className="glass border-b px-3 py-2 lg:hidden">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                            <div className="rounded-lg bg-primary/10 p-2 text-primary">
                                <ActiveTabIcon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                                <p className="truncate text-sm font-semibold leading-none">Studio</p>
                                <p className="truncate text-xs text-muted-foreground">{activeTabMeta.label}</p>
                            </div>
                        </div>
                        <SettingsDialog />
                    </div>
                </header>

                {/* Main Content */}
                <main className="relative min-h-0 flex-1 overflow-hidden bg-muted/10">
                    <div className="absolute inset-0 overflow-y-auto no-scrollbar p-0 pb-20 lg:pb-0">
                        <div className={cn("h-full", activeTab === "chat" ? "block" : "hidden")}>
                            <ChatView />
                        </div>
                        {activeTab === "image" && <ImageGenView />}
                        {activeTab === "video" && <VideoGenView />}
                        {activeTab === "audio" && <AudioGenView />}
                        {activeTab === "gallery" && <GalleryView />}
                    </div>
                </main>

                {/* Mobile Bottom Navigation */}
                <nav className="glass border-t px-2 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] lg:hidden">
                    <div className="grid grid-cols-5 gap-1">
                        {TAB_META.map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <Button
                                    key={tab.id}
                                    variant={isActive ? "secondary" : "ghost"}
                                    className={cn(
                                        "h-14 flex-col gap-1 px-1 text-[11px]",
                                        isActive && "bg-secondary/70"
                                    )}
                                    onClick={() => setActiveTab(tab.id)}
                                    title={tab.label}
                                >
                                    <Icon className={cn("h-4 w-4", isActive && "text-primary")} />
                                    <span className="leading-none">{tab.label}</span>
                                </Button>
                            );
                        })}
                    </div>
                </nav>
            </div>
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
