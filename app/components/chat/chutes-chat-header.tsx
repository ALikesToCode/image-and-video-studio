"use client";

import type {
  Dispatch,
  SetStateAction,
} from "react";
import {
  AudioLines,
  BrainCircuit,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Gauge,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  Sparkles,
  Video,
} from "lucide-react";

import type {
  ChatProvider,
  ModelOption,
} from "@/lib/constants";
import {
  CHAT_PROVIDER_OPTIONS,
} from "@/lib/chat-providers";
import type { NavyUsageResponse } from "@/lib/types";
import type { ChatMetricsSummary } from "@/lib/chat-metrics";
import { cn } from "@/lib/utils";
import { ImageQualityToggle } from "../image-quality-toggle";
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
import { Textarea } from "../ui/textarea";
import {
  ModelSearchSelect,
  NavyUsageFooter,
} from "./chutes-chat-controls";
import { ChutesChatModelDetails } from "./chutes-chat-model-details";
import { ChutesChatMetrics } from "./chutes-chat-metrics";
import { ChutesChatToolToggle } from "./chutes-chat-tool-toggle";
import { ImagePipelineDialog } from "./image-pipeline-dialog";
import { ModelCatalogAlert } from "./model-catalog-alert";
import { formatCount } from "./chutes-chat-runtime";
import {
  REASONING_EFFORT_OPTIONS,
  isReasoningEffort,
  type ReasoningEffort,
  type ToolSettings,
} from "./chutes-chat-types";

type StaticModelIds = {
  chat: ReadonlySet<string>;
  image: ReadonlySet<string>;
  video: ReadonlySet<string>;
  audio: ReadonlySet<string>;
};

type ChutesChatHeaderProps = {
  provider: ChatProvider;
  setProvider: (provider: ChatProvider) => void;
  providerHeading: string;
  models: ModelOption[];
  model: string;
  setModel: (model: string) => void;
  staticModelIds: StaticModelIds;
  selectedChatModel?: ModelOption;
  inputModalities: string[];
  outputModalities: string[];
  supportsImageAttachments: boolean;
  supportsFileAttachments: boolean;
  supportsAudioInput: boolean;
  supportsVideoInput: boolean;
  headerCollapsed: boolean;
  setHeaderCollapsed: Dispatch<SetStateAction<boolean>>;
  supportsReasoning: boolean;
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: Dispatch<
    SetStateAction<ReasoningEffort>
  >;
  imageModels: ModelOption[];
  toolImageModel: string;
  setToolImageModel: (model: string) => void;
  imagePipelineEnabled: boolean;
  setImagePipelineEnabled: (enabled: boolean) => void;
  imageRetryAttempts: number;
  setImageRetryAttempts: (attempts: number) => void;
  preferMaximumImageQuality: boolean;
  setPreferMaximumImageQuality: (enabled: boolean) => void;
  metrics: ChatMetricsSummary;
  imageGenerationCallCeiling: number;
  orderedToolImageModels: string[];
  onTogglePipelineModel: (model: string) => void;
  onReorderPipelineModel: (
    model: string,
    direction: "up" | "down",
  ) => void;
  videoModels: ModelOption[];
  toolVideoModel: string;
  setToolVideoModel: Dispatch<SetStateAction<string>>;
  audioModels: ModelOption[];
  toolAudioModel: string;
  setToolAudioModel: Dispatch<SetStateAction<string>>;
  toolSettings: ToolSettings;
  setToolSettings: Dispatch<SetStateAction<ToolSettings>>;
  onRefreshModels?: () => void;
  modelsLoading?: boolean;
  modelsError?: string | null;
  navyUsage?: NavyUsageResponse | null;
  navyUsageError?: string | null;
  navyUsageLoading?: boolean;
  navyUsageUpdatedAt?: string | null;
  onRefreshUsage?: () => Promise<void> | void;
  customSystemPrompt: string;
  setCustomSystemPrompt: Dispatch<SetStateAction<string>>;
  embedDialogOpen: boolean;
  setEmbedDialogOpen: Dispatch<SetStateAction<boolean>>;
  chatEmbedUrl: string;
  fullscreenChatEmbedUrl: string;
  studioEmbedUrl: string;
  embedMarkdown: string;
  embedCopied: boolean;
  onCopyEmbed: () => void | Promise<void>;
  fullscreen: boolean;
  setFullscreen: Dispatch<SetStateAction<boolean>>;
};

export function ChutesChatHeader({
  provider,
  setProvider,
  providerHeading,
  models,
  model,
  setModel,
  staticModelIds,
  selectedChatModel,
  inputModalities,
  outputModalities,
  supportsImageAttachments,
  supportsFileAttachments,
  supportsAudioInput,
  supportsVideoInput,
  headerCollapsed,
  setHeaderCollapsed,
  supportsReasoning,
  reasoningEffort,
  setReasoningEffort,
  imageModels,
  toolImageModel,
  setToolImageModel,
  imagePipelineEnabled,
  setImagePipelineEnabled,
  imageRetryAttempts,
  setImageRetryAttempts,
  preferMaximumImageQuality,
  setPreferMaximumImageQuality,
  metrics,
  imageGenerationCallCeiling,
  orderedToolImageModels,
  onTogglePipelineModel,
  onReorderPipelineModel,
  videoModels,
  toolVideoModel,
  setToolVideoModel,
  audioModels,
  toolAudioModel,
  setToolAudioModel,
  toolSettings,
  setToolSettings,
  onRefreshModels,
  modelsLoading,
  modelsError,
  navyUsage,
  navyUsageError,
  navyUsageLoading,
  navyUsageUpdatedAt,
  onRefreshUsage,
  customSystemPrompt,
  setCustomSystemPrompt,
  embedDialogOpen,
  setEmbedDialogOpen,
  chatEmbedUrl,
  fullscreenChatEmbedUrl,
  studioEmbedUrl,
  embedMarkdown,
  embedCopied,
  onCopyEmbed,
  fullscreen,
  setFullscreen,
}: ChutesChatHeaderProps) {
  const usageFooter =
    provider === "navy" ? (
      <NavyUsageFooter
        usage={navyUsage}
        error={navyUsageError}
        loading={navyUsageLoading}
        updatedAt={navyUsageUpdatedAt}
        onRefresh={onRefreshUsage}
      />
    ) : null;

  return (
    <header className="sticky top-0 z-10 flex-none border-b border-border bg-background p-2.5 sm:p-4">
      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl items-center justify-between gap-2 sm:gap-3",
          headerCollapsed
            ? "flex-nowrap"
            : "flex-wrap",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-3",
            headerCollapsed ? "shrink-0" : "flex-1",
          )}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-sm"
            aria-hidden="true"
          >
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg leading-none text-foreground sm:text-xl">
              <span className="sr-only">
                {providerHeading}.{" "}
              </span>
              Create anything
            </h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              Ask once. The agent chooses the right tool.
            </p>
          </div>
        </div>

        {headerCollapsed ? (
          <div className="hidden min-w-0 flex-1 justify-end xl:flex">
            <ChutesChatMetrics
              metrics={metrics}
              preferMaximumImageQuality={preferMaximumImageQuality}
              setPreferMaximumImageQuality={setPreferMaximumImageQuality}
              imageGenerationCallCeiling={imageGenerationCallCeiling}
            />
          </div>
        ) : null}

        <div
          className={cn(
            "items-center gap-2",
            headerCollapsed
              ? "flex"
              : "grid w-full grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)_auto] xl:flex xl:w-auto",
          )}
        >
          <div
            className={cn(
              "min-w-0",
              headerCollapsed && "hidden",
            )}
          >
              <Select
                value={provider}
                onValueChange={(value) =>
                  setProvider(value as ChatProvider)
                }
              >
                <SelectTrigger
                  className="h-11 min-w-0 bg-background text-foreground xl:w-[140px]"
                  aria-label="Provider"
                >
                  <SelectValue placeholder="Provider" />
                </SelectTrigger>
                <SelectContent>
                  {CHAT_PROVIDER_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.id}
                      value={option.id}
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
          </div>
          <div
            className={cn(
              "min-w-0",
              headerCollapsed && "hidden",
            )}
          >
              <ModelSearchSelect
                value={model}
                onValueChange={setModel}
                models={models}
                staticModelIds={staticModelIds.chat}
                placeholder="Select a model"
                title="Chat Model"
                ariaLabel="Chat Model"
                favoritesScope={`${provider}:chat`}
                triggerClassName="w-full xl:w-[240px]"
              />
          </div>

          <Button
            variant={
              headerCollapsed ? "outline" : "secondary"
            }
            onClick={() =>
              setHeaderCollapsed((value) => !value)
            }
            className="h-11 min-w-11 px-3 hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
            title={
              headerCollapsed
                ? "Show setup"
                : "Hide setup"
            }
            aria-label={
              headerCollapsed
                ? "Show setup"
                : "Hide setup"
            }
            aria-expanded={!headerCollapsed}
            aria-controls="creator-setup"
          >
            <SlidersHorizontal
              className="h-4 w-4"
              aria-hidden="true"
            />
            <span className="hidden sm:inline">
              Setup
            </span>
          </Button>
        </div>
      </div>

      {headerCollapsed && modelsError ? (
        <div className="mx-auto w-full max-w-7xl">
          <ModelCatalogAlert
            message={modelsError}
            compact
            onReviewSetup={() => setHeaderCollapsed(false)}
          />
        </div>
      ) : null}

      <div
        id="creator-setup"
        className={cn(
          "mx-auto mt-3 w-full max-w-7xl space-y-3",
          headerCollapsed && "hidden",
        )}
      >
          {modelsError ? <ModelCatalogAlert message={modelsError} /> : null}

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary p-2.5">
            {supportsReasoning ? (
              <Select
                value={reasoningEffort}
                onValueChange={(value) =>
                  setReasoningEffort(
                    isReasoningEffort(value)
                      ? value
                      : "high",
                  )
                }
              >
                <SelectTrigger
                  className="h-10 w-[132px] bg-background text-foreground"
                  title="Reasoning effort"
                  aria-label="Reasoning effort"
                >
                  <BrainCircuit
                    className="h-4 w-4 text-primary"
                    aria-hidden="true"
                  />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REASONING_EFFORT_OPTIONS.map(
                    (option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                      >
                        {option.label}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            ) : null}

            <ModelSearchSelect
              value={toolImageModel}
              onValueChange={setToolImageModel}
              models={imageModels}
              staticModelIds={staticModelIds.image}
              placeholder="Image model"
              title="Image Tool Model"
              ariaLabel="Image Tool Model"
                favoritesScope={`${provider}:image`}
              disabled={
                !toolSettings.image ||
                !imageModels.length
              }
              icon={
                <ImageIcon
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              }
              compact
              footer={usageFooter}
            />

            <ImageQualityToggle
              enabled={preferMaximumImageQuality}
              onChange={setPreferMaximumImageQuality}
              compact
            />

            <ImagePipelineDialog
              disabled={!toolSettings.image || !imageModels.length}
              imageModels={imageModels}
              imagePipelineEnabled={imagePipelineEnabled}
              setImagePipelineEnabled={setImagePipelineEnabled}
              imageRetryAttempts={imageRetryAttempts}
              setImageRetryAttempts={setImageRetryAttempts}
              orderedToolImageModels={orderedToolImageModels}
              onTogglePipelineModel={onTogglePipelineModel}
              onReorderPipelineModel={onReorderPipelineModel}
              maxGenerationCalls={imageGenerationCallCeiling}
            />

            <ModelSearchSelect
              value={toolVideoModel}
              onValueChange={setToolVideoModel}
              models={videoModels}
              staticModelIds={staticModelIds.video}
              placeholder="Video model"
              title="Video Tool Model"
              ariaLabel="Video Tool Model"
                favoritesScope={`${provider}:video`}
              disabled={
                !toolSettings.video ||
                !videoModels.length
              }
              icon={
                <Video
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              }
              compact
              footer={usageFooter}
            />
            <ModelSearchSelect
              value={toolAudioModel}
              onValueChange={setToolAudioModel}
              models={audioModels}
              staticModelIds={staticModelIds.audio}
              placeholder="Audio model"
              title="Audio Tool Model"
              ariaLabel="Audio Tool Model"
                favoritesScope={`${provider}:tts`}
              disabled={
                !toolSettings.audio ||
                !audioModels.length
              }
              icon={
                <AudioLines
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              }
              compact
            />

            {provider === "navy" &&
            (toolSettings.image ||
              toolSettings.video) ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  void onRefreshUsage?.()
                }
                disabled={
                  navyUsageLoading ||
                  !onRefreshUsage
                }
                className="h-10 border border-border bg-background px-3 text-xs hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
                aria-label="Check NavyAI image and video usage"
              >
                <Gauge
                  className="h-4 w-4"
                  aria-hidden="true"
                />
                {navyUsage
                  ? `${formatCount(navyUsage.usage.tokens_remaining_today)} left`
                  : navyUsageError
                    ? "Usage error"
                    : "Usage"}
              </Button>
            ) : null}

            {onRefreshModels ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onRefreshModels}
                disabled={modelsLoading}
                className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
                title="Refresh models"
                aria-label="Refresh models"
              >
                <Sparkles
                  className={cn(
                    "h-4 w-4",
                    modelsLoading && "animate-spin",
                  )}
                  aria-hidden="true"
                />
              </Button>
            ) : null}

            <ChutesChatModelDetails
              model={model}
              selectedModel={selectedChatModel}
              inputModalities={inputModalities}
              outputModalities={outputModalities}
              supportsImageAttachments={
                supportsImageAttachments
              }
              supportsFileAttachments={
                supportsFileAttachments
              }
              supportsAudioInput={supportsAudioInput}
              supportsVideoInput={supportsVideoInput}
            />

            <Dialog
              open={embedDialogOpen}
              onOpenChange={setEmbedDialogOpen}
            >
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
                  title="Embed chat"
                  aria-label="Embed chat"
                >
                  <Code2
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    Embed Studio chat
                  </DialogTitle>
                  <DialogDescription>
                    Responsive iframe snippets for chat
                    and generation views.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Chat embed", chatEmbedUrl],
                      [
                        "Fullscreen chat",
                        fullscreenChatEmbedUrl,
                      ],
                    ].map(([label, url]) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-border bg-secondary p-3 text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="flex items-center gap-2 font-medium">
                          {label}
                          <ExternalLink
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                        </span>
                        <span className="mt-1 block break-all text-[11px] text-muted-foreground">
                          {url}
                        </span>
                      </a>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border bg-background p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        HTML
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void onCopyEmbed()
                        }
                        className="min-h-10 px-3 text-xs hover:bg-primary/10 hover:text-primary"
                      >
                        {embedCopied ? (
                          <>
                            <Check
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy
                              className="h-3 w-3"
                              aria-hidden="true"
                            />
                            Copy
                          </>
                        )}
                      </Button>
                    </div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-secondary p-3 text-xs text-foreground">
                      {embedMarkdown}
                    </pre>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">
                    Generation view example:{" "}
                    {studioEmbedUrl}
                  </p>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setFullscreen((value) => !value)
              }
              className="h-10 w-10 hover:bg-primary/10 hover:text-primary"
              title={
                fullscreen
                  ? "Exit fullscreen"
                  : "Fullscreen chat"
              }
              aria-label={
                fullscreen
                  ? "Exit fullscreen"
                  : "Fullscreen chat"
              }
            >
              {fullscreen ? (
                <Minimize2
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              ) : (
                <Maximize2
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
            <div className="rounded-xl border border-border bg-secondary p-3">
              <div className="mb-2">
                <p className="text-xs font-semibold text-foreground">
                  Media tools
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Choose what the agent can create.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ChutesChatToolToggle
                  enabled={toolSettings.image}
                  icon={
                    <ImageIcon
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                  }
                  label="Image"
                  onClick={() =>
                    setToolSettings((value) => ({
                      ...value,
                      image: !value.image,
                    }))
                  }
                />
                <ChutesChatToolToggle
                  enabled={toolSettings.video}
                  icon={
                    <Video
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                  }
                  label="Video"
                  onClick={() =>
                    setToolSettings((value) => ({
                      ...value,
                      video: !value.video,
                    }))
                  }
                />
                <ChutesChatToolToggle
                  enabled={toolSettings.audio}
                  icon={
                    <AudioLines
                      className="h-3.5 w-3.5"
                      aria-hidden="true"
                    />
                  }
                  label="Audio"
                  onClick={() =>
                    setToolSettings((value) => ({
                      ...value,
                      audio: !value.audio,
                    }))
                  }
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary p-3">
              <div className="flex items-center justify-between gap-2 pb-2">
                <label
                  htmlFor="chat-system-prompt"
                  className="text-xs font-semibold text-foreground"
                >
                  System prompt
                </label>
                {customSystemPrompt.trim() ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCustomSystemPrompt("")
                    }
                    className="min-h-10 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
              <Textarea
                id="chat-system-prompt"
                value={customSystemPrompt}
                onChange={(event) =>
                  setCustomSystemPrompt(
                    event.target.value,
                  )
                }
                placeholder="Optional instructions for every response."
                className="min-h-[76px] resize-y bg-background text-sm text-foreground placeholder:text-muted-foreground"
              />
            </div>
          </div>
      </div>
    </header>
  );
}
