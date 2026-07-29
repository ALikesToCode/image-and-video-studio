"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Gauge,
  RefreshCw,
  Search,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import type { ModelOption } from "@/lib/constants";
import {
  ensureSelectedModelOption,
  filterModelOptions,
  hasModelMetadata,
  isFetchedOnlyModel,
} from "@/lib/model-options";
import type { NavyUsageResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

import {
  formatCount,
  formatModelWindow,
  formatUsageAge,
} from "./chutes-chat-runtime";

export function NavyUsageFooter({
  usage,
  error,
  loading,
  updatedAt,
  onRefresh,
}: {
  usage?: NavyUsageResponse | null;
  error?: string | null;
  loading?: boolean;
  updatedAt?: string | null;
  onRefresh?: () => Promise<void> | void;
}) {
  const usagePercent =
    typeof usage?.usage?.percent_used === "number"
      ? usage.usage.percent_used
      : null;
  const updatedLabel = formatUsageAge(updatedAt);

  return (
    <div className="border-t border-border/60 bg-secondary/45 px-3 py-2 text-[11px] text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 flex-none" />
          <span className="truncate font-medium text-foreground">
            {usage
              ? `${formatCount(usage.usage.tokens_remaining_today)} tokens left`
              : error
                ? "Usage unavailable"
                : "Usage not checked"}
          </span>
        </div>
        {onRefresh ? (
          <button
            type="button"
            onClick={() => void onRefresh()}
            disabled={loading}
            className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-3 w-3", loading && "animate-spin")}
            />
            Check
          </button>
        ) : null}
      </div>
      {usage ? (
        <div className="mt-1 flex items-center justify-between gap-2">
          <span>
            {formatCount(usage.usage.tokens_used_today)} used today
          </span>
          <span>
            {usagePercent !== null
              ? `${usagePercent.toFixed(1)}%`
              : "-"}
          </span>
        </div>
      ) : null}
      {error ? (
        <p className="mt-1 font-medium text-destructive">{error}</p>
      ) : null}
      {updatedLabel ? (
        <p className="mt-1 text-muted-foreground">
          Updated {updatedLabel}
        </p>
      ) : null}
    </div>
  );
}

export function ModelSearchSelect({
  value,
  onValueChange,
  models,
  staticModelIds,
  placeholder,
  ariaLabel,
  title,
  triggerClassName,
  icon,
  compact = false,
  disabled = false,
  footer,
}: {
  value: string;
  onValueChange: (value: string) => void;
  models: ModelOption[];
  staticModelIds?: ReadonlySet<string>;
  placeholder: string;
  ariaLabel: string;
  title: string;
  triggerClassName?: string;
  icon?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [menuStyle, setMenuStyle] =
    useState<CSSProperties | null>(null);
  const options = useMemo(
    () => ensureSelectedModelOption(models, value),
    [models, value],
  );
  const selectedModel = options.find(
    (model) => model.id === value,
  );
  const filteredOptions = useMemo(
    () => filterModelOptions(options, query),
    [options, query],
  );

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () =>
      document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 8;
      const width = Math.min(
        384,
        Math.max(160, window.innerWidth - viewportPadding * 2),
      );
      const maxLeft = Math.max(
        viewportPadding,
        window.innerWidth - width - viewportPadding,
      );
      const left = Math.min(
        Math.max(viewportPadding, rect.right - width),
        maxLeft,
      );
      const maxHeight = Math.min(
        384,
        window.innerHeight - viewportPadding * 2,
      );
      const spaceBelow =
        window.innerHeight - rect.bottom - viewportPadding;
      const openAbove = spaceBelow < 260 && rect.top > spaceBelow;
      const top = openAbove
        ? Math.max(
            viewportPadding,
            rect.top - maxHeight - 4,
          )
        : Math.min(
            rect.bottom + 4,
            window.innerHeight - maxHeight - viewportPadding,
          );
      setMenuStyle({
        position: "fixed",
        top,
        left,
        width,
        maxHeight,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const selectedFetchedOnly = selectedModel
    ? isFetchedOnlyModel(selectedModel, staticModelIds)
    : false;

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex-none",
        !compact && "min-w-0",
      )}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => setOpen((previous) => !previous)}
        className={cn(
          "h-10 min-w-0 border-border bg-background text-sm font-normal text-foreground shadow-sm hover:border-primary/50 hover:bg-primary/10 hover:text-primary",
          compact
            ? "w-10 justify-center px-0"
            : "justify-between px-3 sm:w-[240px]",
          triggerClassName,
        )}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
      >
        {compact ? (
          icon
        ) : (
          <>
            <span className="min-w-0 truncate text-left">
              {selectedModel?.label ?? (value || placeholder)}
            </span>
            <span className="ml-2 flex flex-none items-center gap-1">
              {selectedFetchedOnly ? (
                <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  New
                </span>
              ) : null}
              {typeof selectedModel?.tokenMultiplier ===
              "number" ? (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                  {selectedModel.tokenMultiplier}x
                </span>
              ) : null}
              <ChevronDown
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
            </span>
          </>
        )}
      </Button>
      {open && menuStyle && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              style={menuStyle}
              className="z-50 overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
            >
              <div className="border-b border-border/60 p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    value={query}
                    onChange={(event) =>
                      setQuery(event.target.value)
                    }
                    placeholder="Search models"
                    className="h-9 pl-8 text-sm"
                  />
                </div>
              </div>
              <div
                className="max-h-72 overflow-y-auto p-1"
                role="listbox"
                aria-label={ariaLabel}
              >
                {filteredOptions.length ? (
                  filteredOptions.map((modelOption) => {
                    const selected =
                      modelOption.id === value;
                    const fetchedOnly = isFetchedOnlyModel(
                      modelOption,
                      staticModelIds,
                    );
                    const metadata =
                      hasModelMetadata(modelOption);
                    return (
                      <button
                        key={modelOption.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          onValueChange(modelOption.id);
                          setOpen(false);
                          setQuery("");
                        }}
                        className={cn(
                          "flex min-h-11 w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-primary/10 hover:text-foreground focus-visible:bg-primary/10",
                          selected &&
                            "bg-primary/15 text-foreground",
                        )}
                      >
                        <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center text-primary">
                          {selected ? (
                            <Check className="h-4 w-4" />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="truncate font-medium">
                              {modelOption.label}
                            </span>
                            {fetchedOnly ? (
                              <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                New
                              </span>
                            ) : null}
                            {modelOption.premium ? (
                              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                                Premium
                              </span>
                            ) : null}
                            {typeof modelOption.tokenMultiplier ===
                            "number" ? (
                              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                                {modelOption.tokenMultiplier}x tokens
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                            {modelOption.id}
                          </span>
                          {metadata ? (
                            <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                              {[
                                modelOption.endpoint,
                                modelOption.contextWindow !==
                                undefined
                                  ? `ctx ${formatModelWindow(modelOption.contextWindow)}`
                                  : "",
                                modelOption.maxOutputTokens !==
                                undefined
                                  ? `out ${formatModelWindow(modelOption.maxOutputTokens)}`
                                  : "",
                                modelOption.inputModalities?.length
                                  ? `in ${modelOption.inputModalities.join(",")}`
                                  : "",
                                modelOption.outputModalities?.length
                                  ? `out ${modelOption.outputModalities.join(",")}`
                                  : "",
                                modelOption.metadataStatus,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                    No models match this search.
                  </p>
                )}
              </div>
              {footer}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
