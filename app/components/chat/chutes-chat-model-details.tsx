"use client";

import { Info } from "lucide-react";

import type { ModelOption } from "@/lib/constants";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { formatModelWindow } from "./chutes-chat-runtime";

type ChutesChatModelDetailsProps = {
  model: string;
  selectedModel?: ModelOption;
  inputModalities: string[];
  outputModalities: string[];
  supportsImageAttachments: boolean;
  supportsFileAttachments: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
};

export function ChutesChatModelDetails({
  model,
  selectedModel,
  inputModalities,
  outputModalities,
  supportsImageAttachments,
  supportsFileAttachments,
  supportsAudioInput,
  supportsVideoInput,
}: ChutesChatModelDetailsProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
          title="Model input details"
          aria-label="Model input details"
        >
          <Info
            className="h-4 w-4"
            aria-hidden="true"
          />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Model capabilities</DialogTitle>
          <DialogDescription>
            Upload controls follow this model&apos;s
            advertised metadata.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-border bg-secondary p-3">
            <p className="font-semibold text-foreground">
              {selectedModel?.label ?? model}
            </p>
            <p className="mt-1 break-all text-xs text-muted-foreground">
              {model}
            </p>
            {selectedModel?.description ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {selectedModel.description}
              </p>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-background p-3">
              Inputs:{" "}
              {inputModalities.join(", ") || "unknown"}
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              Outputs:{" "}
              {outputModalities.join(", ") || "unknown"}
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              Image upload:{" "}
              {supportsImageAttachments
                ? "available"
                : "not advertised"}
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              PDF/text upload:{" "}
              {supportsFileAttachments
                ? "available"
                : "not advertised"}
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              Audio input:{" "}
              {supportsAudioInput
                ? "advertised"
                : "not advertised"}
            </div>
            <div className="rounded-lg border border-border bg-background p-3">
              Video input:{" "}
              {supportsVideoInput
                ? "advertised"
                : "not advertised"}
            </div>
            {selectedModel?.contextWindow !== undefined ? (
              <div className="rounded-lg border border-border bg-background p-3">
                Context:{" "}
                {formatModelWindow(
                  selectedModel.contextWindow,
                )}{" "}
                tokens
              </div>
            ) : null}
            {selectedModel?.maxOutputTokens !==
            undefined ? (
              <div className="rounded-lg border border-border bg-background p-3">
                Max output:{" "}
                {formatModelWindow(
                  selectedModel.maxOutputTokens,
                )}{" "}
                tokens
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
