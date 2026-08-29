"use client";

import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

type ModelCatalogAlertProps = {
  message: string;
  compact?: boolean;
  onReviewSetup?: () => void;
};

export function ModelCatalogAlert({
  message,
  compact = false,
  onReviewSetup,
}: ModelCatalogAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex w-full items-start gap-2 rounded-xl border border-destructive/45 bg-destructive/10 text-destructive",
        compact ? "mt-2 px-3 py-2" : "p-3",
      )}
    >
      <CircleAlert
        className="mt-0.5 h-4 w-4 shrink-0"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5">
          Model list unavailable
        </p>
        <p
          className={cn(
            "text-xs leading-5 text-foreground/80",
            compact && "line-clamp-2",
          )}
        >
          {message}
        </p>
      </div>
      {onReviewSetup ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReviewSetup}
          className="min-h-10 shrink-0 border-destructive/40 bg-background px-3 text-xs text-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          Review setup
        </Button>
      ) : null}
    </div>
  );
}
