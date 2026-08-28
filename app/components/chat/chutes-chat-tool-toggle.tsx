"use client";

import type { ReactNode } from "react";
import { ToggleLeft, ToggleRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

type ChutesChatToolToggleProps = {
  enabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
};

export function ChutesChatToolToggle({
  enabled,
  icon,
  label,
  onClick,
}: ChutesChatToolToggleProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-pressed={enabled}
      onClick={onClick}
      className={cn(
        "min-h-10 gap-1.5 border px-3",
        enabled
          ? "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          : "border-border bg-background text-foreground hover:border-primary/35 hover:bg-primary/10 hover:text-primary",
      )}
    >
      {enabled ? (
        <ToggleRight className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ToggleLeft className="h-4 w-4" aria-hidden="true" />
      )}
      {icon}
      {label}
    </Button>
  );
}
