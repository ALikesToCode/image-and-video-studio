"use client";

import { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  getInstallGuidance,
  shouldShowInstallEntryPoint,
  type InstallGuidance,
} from "@/lib/client/install-guidance";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const isStandaloneDisplay = () => {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
};

export function InstallAppButton({ className }: { className?: string }) {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [guidance, setGuidance] = useState<InstallGuidance>(() =>
    getInstallGuidance("")
  );

  useEffect(() => {
    const hydrationHandle = window.setTimeout(() => {
      setInstalled(isStandaloneDisplay());
      setGuidance(getInstallGuidance(window.navigator.userAgent));
    }, 0);
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      const nextPrompt = event as BeforeInstallPromptEvent;
      setInstallPrompt(nextPrompt);
      setGuidance(getInstallGuidance(window.navigator.userAgent, true));
    };
    const handleInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setDialogOpen(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.clearTimeout(hydrationHandle);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (!shouldShowInstallEntryPoint(installed)) return null;

  const installApp = async () => {
    if (!installPrompt) {
      setDialogOpen(true);
      return;
    }
    const prompt = installPrompt;
    setInstallPrompt(null);
    await prompt.prompt();
    await prompt.userChoice.catch(() => null);
  };

  return (
    <>
      <Button
        type="button"
        variant={installPrompt ? "secondary" : "ghost"}
        size="icon"
        onClick={() => void installApp()}
        className={cn("shrink-0", className)}
        title={guidance.primaryAction}
        aria-label={guidance.primaryAction}
      >
        <Download className="h-5 w-5" />
      </Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:mx-0">
              <Smartphone className="h-6 w-6" />
            </div>
            <DialogTitle>{guidance.title}</DialogTitle>
            <DialogDescription>{guidance.description}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-2 text-sm text-foreground">
            {guidance.steps.map((step, index) => (
              <li key={step} className="flex gap-3 rounded-xl bg-secondary/40 p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
