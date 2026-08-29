"use client";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Layers3,
} from "lucide-react";

import type { ModelOption } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type ImagePipelineDialogProps = {
  disabled: boolean;
  imageModels: ModelOption[];
  imagePipelineEnabled: boolean;
  setImagePipelineEnabled: (enabled: boolean) => void;
  imageRetryAttempts: number;
  setImageRetryAttempts: (attempts: number) => void;
  orderedToolImageModels: string[];
  onTogglePipelineModel: (model: string) => void;
  onReorderPipelineModel: (
    model: string,
    direction: "up" | "down",
  ) => void;
  maxGenerationCalls: number;
};

export function ImagePipelineDialog({
  disabled,
  imageModels,
  imagePipelineEnabled,
  setImagePipelineEnabled,
  imageRetryAttempts,
  setImageRetryAttempts,
  orderedToolImageModels,
  onTogglePipelineModel,
  onReorderPipelineModel,
  maxGenerationCalls,
}: ImagePipelineDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 border border-border bg-background hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          title="Image generation cost controls"
          aria-label="Image generation cost controls"
          disabled={disabled}
        >
          <Layers3 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="left-1/2 right-auto flex w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Image generation controls</DialogTitle>
          <DialogDescription>
            Choose how many models and recovery attempts one prompt may use.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <label className="flex items-start justify-between gap-3 rounded-xl border border-border bg-secondary p-3">
            <span>
              <span className="block text-sm font-medium text-foreground">
                Compare multiple models
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Each selected model gets its own generation request.
              </span>
            </span>
            <input
              type="checkbox"
              checked={imagePipelineEnabled}
              onChange={(event) =>
                setImagePipelineEnabled(event.target.checked)
              }
              className="mt-1 h-5 w-5 rounded border-border text-primary focus:ring-ring"
            />
          </label>

          <div className="space-y-2">
            <label
              htmlFor="chat-image-retries"
              className="text-sm font-medium text-foreground"
            >
              Maximum attempts per model
            </label>
            <Select
              value={imageRetryAttempts.toString()}
              onValueChange={(value) =>
                setImageRetryAttempts(Number.parseInt(value, 10))
              }
            >
              <SelectTrigger id="chat-image-retries" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4].map((attempts) => (
                  <SelectItem key={attempts} value={attempts.toString()}>
                    {attempts}
                    {attempts === 1
                      ? " · lowest cost"
                      : attempts === 2
                        ? " · recommended"
                        : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-muted-foreground">
              Only a policy rejection with a meaningfully rewritten prompt can
              retry. Authentication, validation, timeout, and provider failures
              stop after one request.
            </p>
          </div>

          <div className="rounded-xl border border-primary/30 bg-primary/10 p-3 text-foreground">
            <p className="text-sm font-semibold">
              Up to {maxGenerationCalls} image request
              {maxGenerationCalls === 1 ? "" : "s"} per prompt
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground/75">
              This is a ceiling, not an estimate. Every selected model may
              create a billable render; recovery attempts run only after a
              repaired policy prompt.
            </p>
          </div>

          <div className="space-y-2">
            {imageModels.map((suggestion) => {
              const index = orderedToolImageModels.indexOf(suggestion.id);
              const selected = index !== -1;
              return (
                <div
                  key={suggestion.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-background p-2 text-foreground"
                >
                  <button
                    type="button"
                    onClick={() => onTogglePipelineModel(suggestion.id)}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary bg-primary text-primary-foreground hover:bg-primary/85"
                        : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary",
                    )}
                    aria-label={`${selected ? "Remove" : "Add"} ${suggestion.label} from pipeline`}
                  >
                    {selected ? (
                      <Check className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <span aria-hidden="true">+</span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {suggestion.label}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {suggestion.id}
                    </div>
                  </div>
                  {selected ? (
                    <>
                      <span className="rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                        #{index + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
                        onClick={() =>
                          onReorderPipelineModel(suggestion.id, "up")
                        }
                        disabled={index === 0}
                        aria-label={`Move ${suggestion.label} up`}
                      >
                        <ChevronUp className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
                        onClick={() =>
                          onReorderPipelineModel(suggestion.id, "down")
                        }
                        disabled={
                          index === orderedToolImageModels.length - 1
                        }
                        aria-label={`Move ${suggestion.label} down`}
                      >
                        <ChevronDown
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </Button>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
