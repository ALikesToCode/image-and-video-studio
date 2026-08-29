"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ModelOption,
  type Provider,
} from "@/lib/constants";
import {
  chatProviderDisplayName,
  chatProviderHeading,
} from "@/lib/chat-providers";
import { cn } from "@/lib/utils";
import { ensureSelectedModelOption } from "@/lib/model-options";
import { buildChatGenerationSystemPrompt } from "@/lib/chat-generation-prompt";
import { summarizeChatMetrics } from "@/lib/chat-metrics";
import {
  deleteStudioState,
  isStudioStateAvailable,
} from "@/lib/studio-state-db";
import {
  type ChatAttachmentAsset,
  type ChatMediaAsset,
} from "@/lib/chat-media-persistence";
import {
  type ChatMediaPreview,
  buildChatMediaPreview,
} from "@/lib/chat-media-tool-requests";
import {
  type ChatTurnIntent,
  resolveChatTurnIntent,
} from "@/lib/chat-turn-policy";
import { isDeepSeekV4Model } from "@/lib/chat-completion";
import { resolveRequestedImageModels } from "@/lib/chat-image-pipeline";
import { ImageViewer } from "./image-viewer";
import { mediaExtensionFromMimeType } from "@/lib/media-files";
import {
  chatModelToolSupport,
  type AIChatToolName,
} from "@/lib/ai-sdk-chat";
import { ChutesChatComposer } from "./chat/chutes-chat-composer";
import { ChutesChatConversation } from "./chat/chutes-chat-conversation";
import { ChutesChatHeader } from "./chat/chutes-chat-header";
import { resolveImageGenerationCallCeiling } from "@/lib/generation-cost";
import { runChatAudioTool } from "./chat/chutes-chat-audio-tool";
import {
  runChatImageTool,
  type ImageToolProgress,
} from "./chat/chutes-chat-image-tool";
import { createChatStreamClient } from "./chat/chutes-chat-stream";
import { runChatTools } from "./chat/chutes-chat-tool-runner";
import { runChatVideoTool } from "./chat/chutes-chat-video-tool";
import { useChutesChatPersistence } from "./chat/use-chutes-chat-persistence";
import { useChutesChatRunner } from "./chat/use-chutes-chat-runner";
import { useChutesChatAttachments } from "./chat/use-chutes-chat-attachments";
import {
  STATIC_MODEL_IDS,
} from "./chat/chutes-chat-state";
import {
  isImageToolProvider,
  modelSupportsReasoning,
  normalizeModalityList,
} from "./chat/chutes-chat-runtime";
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD,
  type ChatMessage,
  type ChutesChatProps,
  type ToolCall,
} from "./chat/chutes-chat-types";

export { sanitizeChatMessages } from "./chat/chutes-chat-state";

export function ChutesChat({
  apiKey,
  allowServerApiKey = false,
  provider,
  setProvider,
  models,
  model,
  setModel,
  imageModels,
  imageApiKeys,
  videoModels,
  videoApiKeys,
  audioModels,
  toolImageModel,
  setToolImageModel,
  imagePipelineEnabled,
  setImagePipelineEnabled,
  imageModelOrder,
  setImageModelOrder,
  imageRetryAttempts,
  setImageRetryAttempts,
  preferMaximumImageQuality,
  setPreferMaximumImageQuality,
  onRefreshModels,
  modelsLoading,
  modelsError,
  navyUsage,
  navyUsageError,
  navyUsageLoading,
  navyUsageUpdatedAt,
  onRefreshUsage,
  saveToGallery = false,
  videoImage,
  videoAspect,
  videoDuration,
  ttsVoice,
  ttsFormat,
  ttsSpeed,
  initialInput,
  onSaveImages,
}: ChutesChatProps) {
  const [input, setInput] = useState("");
  const [turnIntent, setTurnIntent] = useState<ChatTurnIntent>("auto");
  const latestGeneratedImageRef = useRef<string | null>(videoImage ?? null);
  const [fullscreen, setFullscreen] = useState(false);
  const [activeMediaPreview, setActiveMediaPreview] = useState<ChatMediaPreview | null>(null);
  const [embedDialogOpen, setEmbedDialogOpen] = useState(false);
  const [embedOrigin, setEmbedOrigin] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [copiedPromptMessageId, setCopiedPromptMessageId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const consumedInitialInputRef = useRef<string | null>(null);
  const providerLabel = chatProviderDisplayName(provider);
  const providerHeading = chatProviderHeading(provider);
  const hasApiAccess = Boolean(apiKey.trim()) || allowServerApiKey;
  const staticModelIds = STATIC_MODEL_IDS[provider];
  const [headerCollapsed, setHeaderCollapsed] = useState(true);
  const selectedChatModel = useMemo(
    () => ensureSelectedModelOption(models, model).find((entry) => entry.id === model),
    [models, model],
  );
  const inputModalities = useMemo(
    () => normalizeModalityList(selectedChatModel?.inputModalities),
    [selectedChatModel]
  );
  const outputModalities = useMemo(
    () => normalizeModalityList(selectedChatModel?.outputModalities),
    [selectedChatModel]
  );
  const supportsImageAttachments =
    selectedChatModel?.supportsVision === true || inputModalities.includes("image");
  const supportsFileAttachments =
    inputModalities.includes("file") ||
    inputModalities.includes("document") ||
    inputModalities.includes("pdf");
  const supportsAudioInput =
    selectedChatModel?.supportsAudioInput === true || inputModalities.includes("audio");
  const supportsVideoInput = inputModalities.includes("video");
  const attachmentAccept = [
    supportsImageAttachments ? "image/png,image/jpeg,image/webp,image/gif" : "",
    supportsFileAttachments
      ? "application/pdf,.pdf,text/plain,text/markdown,.txt,.md,.markdown,.csv,.json,.log"
      : "",
  ]
    .filter(Boolean)
    .join(",");
  const attachmentUploadDisabled = !supportsImageAttachments && !supportsFileAttachments;
  const {
    pendingAttachments,
    setPendingAttachments,
    attachmentLoading,
    attachmentError,
    setAttachmentError,
    addAttachmentFiles,
    removePendingAttachment,
  } = useChutesChatAttachments({
    supportsImageAttachments,
    supportsFileAttachments,
  });
  const isDeepSeekV4ChatModel =
    (provider === "navy" ||
      provider === "nanogpt" ||
      provider === "multillm") &&
    isDeepSeekV4Model(model);
  const chatModelSupportsReasoning = modelSupportsReasoning(provider, model, selectedChatModel);
  const chatModelToolCapability = chatModelToolSupport(selectedChatModel);
  const {
    messages,
    messagesRef,
    commitMessages,
    customSystemPrompt,
    setCustomSystemPrompt,
    toolVideoModel,
    setToolVideoModel,
    toolAudioModel,
    setToolAudioModel,
    toolSettings,
    setToolSettings,
    reasoningEffort,
    setReasoningEffort,
    storageKey,
  } = useChutesChatPersistence({
    provider,
    model,
    videoModels,
    audioModels,
    supportsReasoning: chatModelSupportsReasoning,
  });
  useEffect(() => {
    if (videoImage) latestGeneratedImageRef.current = videoImage;
  }, [videoImage]);
  const availableImageModelIds = useMemo(
    () => new Set(imageModels.map((item) => item.id)),
    [imageModels]
  );
  const imageProviderByModelId = useMemo(() => {
    const entries = new Map<string, Provider>();
    for (const item of imageModels) {
      entries.set(
        item.id,
        isImageToolProvider(item.provider) ? item.provider : provider
      );
    }
    return entries;
  }, [imageModels, provider]);
  const imageApiKeyForProvider = useCallback(
    (targetProvider: Provider) =>
      (imageApiKeys?.[targetProvider] ?? (targetProvider === provider ? apiKey : "")).trim(),
    [apiKey, imageApiKeys, provider]
  );
  const videoModelById = useMemo(
    () => new Map(videoModels.map((item) => [item.id, item])),
    [videoModels]
  );
  const videoProviderByModelId = useMemo(() => {
    const entries = new Map<string, Provider>();
    for (const item of videoModels) {
      entries.set(
        item.id,
        isImageToolProvider(item.provider) ? item.provider : provider
      );
    }
    return entries;
  }, [videoModels, provider]);
  const videoApiKeyForProvider = useCallback(
    (targetProvider: Provider) =>
      (videoApiKeys?.[targetProvider] ?? (targetProvider === provider ? apiKey : "")).trim(),
    [apiKey, provider, videoApiKeys]
  );
  const orderedToolImageModels = useMemo(
    () => imageModelOrder.filter((entry) => availableImageModelIds.has(entry)),
    [availableImageModelIds, imageModelOrder]
  );
  const activeToolImageModels = useMemo(
    () =>
      resolveRequestedImageModels({
        requestedModel: "",
        defaultModel: toolImageModel,
        imagePipelineEnabled,
        imageModelOrder,
        availableModels: imageModels.map((item) => item.id),
      }),
    [imageModels, imageModelOrder, imagePipelineEnabled, toolImageModel]
  );
  const imageGenerationCallCeiling = resolveImageGenerationCallCeiling({
    imageToolEnabled: toolSettings.image,
    activeModelCount: activeToolImageModels.length,
    maxAttemptsPerModel: imageRetryAttempts,
  });
  const refreshNavyUsageAfterMediaTool = () => {
    if (provider !== "navy" || !onRefreshUsage) return;
    void Promise.resolve(onRefreshUsage()).catch(() => {
      // The generation result is more important than a best-effort usage refresh.
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handle = window.setTimeout(() => {
      setEmbedOrigin(window.location.origin);
      const params = new URLSearchParams(
        window.location.search,
      );
      if (params.get("fullscreen") === "1") {
        setFullscreen(true);
      }
    }, 0);
    return () => window.clearTimeout(handle);
  }, []);

  useEffect(() => {
    const nextInput = initialInput?.trim() ?? "";
    if (!nextInput || consumedInitialInputRef.current === initialInput) return;
    consumedInitialInputRef.current = initialInput ?? null;
    const handle = window.setTimeout(() => {
      setInput(initialInput ?? "");
      setChatError(null);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [initialInput]);
  const reorderPipelineModel = (id: string, direction: "up" | "down") => {
    setImageModelOrder((prev) => {
      const next = prev.filter((entry) => availableImageModelIds.has(entry));
      const index = next.indexOf(id);
      if (index === -1) return next;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return next;
      const reordered = [...next];
      const [item] = reordered.splice(index, 1);
      reordered.splice(targetIndex, 0, item);
      return reordered;
    });
  };
  const togglePipelineModel = (id: string) => {
    setImageModelOrder((prev) => {
      const next = prev.filter((entry) => availableImageModelIds.has(entry));
      return next.includes(id)
        ? next.filter((entry) => entry !== id)
        : [...next, id];
    });
  };

   // Track if user is near bottom; if they scroll up during streaming we stop forcing scroll.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateAutoScroll = () => {
      const distanceFromBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      shouldAutoScrollRef.current =
        distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD;
    };

    updateAutoScroll();
    element.addEventListener("scroll", updateAutoScroll, { passive: true });
    return () => element.removeEventListener("scroll", updateAutoScroll);
  }, []);

  const toolAvailability = useMemo(
    () => ({
      image: toolSettings.image && imageModels.length > 0,
      video: toolSettings.video && videoModels.length > 0,
      audio: toolSettings.audio && audioModels.length > 0,
    }),
    [audioModels.length, imageModels.length, toolSettings, videoModels.length]
  );
  const currentTurnDecision = useMemo(
    () => resolveChatTurnIntent(input, toolAvailability, turnIntent),
    [input, toolAvailability, turnIntent]
  );
  const enabledChatTools = useMemo<AIChatToolName[]>(() => {
    if (chatModelToolCapability === false) return [];
    const enabled: AIChatToolName[] = [];
    if (toolSettings.image && imageModels.length) enabled.push("generate_image");
    if (toolSettings.video && videoModels.length) enabled.push("generate_video");
    if (toolSettings.audio && audioModels.length) enabled.push("generate_audio");
    return enabled;
  }, [audioModels.length, chatModelToolCapability, imageModels.length, toolSettings, videoModels.length]);
  const systemPrompt = useMemo(() => {
    const orderedImageModels = activeToolImageModels
      .map((id) => imageModels.find((entry) => entry.id === id))
      .filter((entry): entry is ModelOption => Boolean(entry));
    const selectedImageModel =
      imageModels.find((entry) => entry.id === toolImageModel) ??
      orderedImageModels[0];
    const imageFallbackModels = orderedImageModels.filter(
      (entry) => entry !== selectedImageModel
    );
    const selectedVideoModel = videoModelById.get(toolVideoModel);
    const selectedAudioModel = audioModels.find(
      (entry) => entry.id === toolAudioModel
    );

    return buildChatGenerationSystemPrompt({
      customPrompt: customSystemPrompt,
      chatModel: model,
      imageModel:
        toolSettings.image && imageModels.length
          ? selectedImageModel
          : undefined,
      imageFallbackModels,
      videoModel:
        toolSettings.video && videoModels.length
          ? selectedVideoModel
          : undefined,
      audioModel:
        toolSettings.audio && audioModels.length
          ? selectedAudioModel
          : undefined,
    });
  }, [
    activeToolImageModels,
    audioModels,
    customSystemPrompt,
    imageModels,
    model,
    toolAudioModel,
    toolImageModel,
    toolSettings,
    toolVideoModel,
    videoModelById,
    videoModels.length,
  ]);

  const {
    callChatStreaming,
    recoverImagePromptAfterPolicyFailure,
    requestImagePromptHelp,
  } = createChatStreamClient({
    apiKey,
    provider,
    model,
    systemPrompt,
    enabledTools: enabledChatTools,
    reasoningEffort,
    supportsReasoning: chatModelSupportsReasoning,
    isDeepSeekV4Model: isDeepSeekV4ChatModel,
    modelMaxOutputTokens: selectedChatModel?.maxOutputTokens,
  });

  const runGenerateImage = (
    args: Record<string, unknown>,
    context?: {
      assistantContent: string;
      userPrompt: string;
    },
    onModelProgress?: (update: ImageToolProgress) => void,
    signal?: AbortSignal,
  ) =>
    runChatImageTool({
      args,
      context,
      onModelProgress,
      signal,
      provider,
      allowServerApiKey,
      imageModels,
      imageProviderByModelId,
      imageApiKeyForProvider,
      toolImageModel,
      imagePipelineEnabled,
      imageModelOrder,
      imageRetryAttempts,
      preferMaximumImageQuality,
      recoverPrompt: recoverImagePromptAfterPolicyFailure,
      requestPromptHelp: requestImagePromptHelp,
    });

  const runGenerateVideo = (
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) =>
    runChatVideoTool({
      args,
      signal,
      provider,
      allowServerApiKey,
      toolVideoModel,
      videoModelById,
      videoProviderByModelId,
      videoApiKeyForProvider,
      latestGeneratedImage:
        latestGeneratedImageRef.current,
      videoImage,
      videoAspect,
      videoDuration,
    });

  const runGenerateAudio = (
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) =>
    runChatAudioTool({
      args,
      signal,
      apiKey,
      allowServerApiKey,
      provider,
      toolAudioModel,
    });

   const copyEmbedMarkdown = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedPromptMessageId("embed-markdown");
      window.setTimeout(
        () => setCopiedPromptMessageId((prev) => (prev === "embed-markdown" ? null : prev)),
        1500
      );
    } catch {
      setAttachmentError("Unable to copy embed markdown.");
    }
  };

  const copyPromptText = async (messageId: string, promptText: string) => {
    if (!promptText.trim()) return;
    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPromptMessageId(messageId);
      window.setTimeout(
        () => setCopiedPromptMessageId((prev) => (prev === messageId ? null : prev)),
        1500
      );
    } catch {
      // ignore clipboard failures
    }
  };

  const openMediaPreview = useCallback(
    (item: ChatMediaAsset, prompt: string) => {
      setActiveMediaPreview(
        buildChatMediaPreview({
          item,
          prompt,
          provider: providerLabel,
        })
      );
    },
    [providerLabel]
  );

  const openAttachmentPreview = useCallback(
    (attachment: ChatAttachmentAsset, prompt: string) => {
      if (attachment.kind !== "image" || !attachment.dataUrl) return;
      openMediaPreview(
        {
          id: attachment.id,
          kind: "image",
          dataUrl: attachment.dataUrl,
          mimeType: attachment.mimeType,
        },
        prompt
      );
    },
    [openMediaPreview]
  );

  const closeMediaPreview = useCallback((open: boolean) => {
    if (!open) {
      setActiveMediaPreview(null);
    }
  }, []);

  const downloadChatMedia = useCallback((item: ChatMediaAsset) => {
    const link = document.createElement("a");
    link.href = item.dataUrl;
    link.download = `generation-${item.id}.${mediaExtensionFromMimeType(
      item.mimeType,
      item.kind
    )}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleToolCalls = (
    toolCalls: ToolCall[],
    onProgress?: (message: ChatMessage) => void,
    context?: {
      assistantContent: string;
      userPrompt: string;
    },
    signal?: AbortSignal,
  ) =>
    runChatTools(
      {
        provider,
        toolSettings,
        imageModels,
        videoModels,
        audioModels,
        onGeneratedImage: (dataUrl) => {
          latestGeneratedImageRef.current = dataUrl;
        },
        saveToGallery,
        onSaveImages,
        refreshMediaUsage:
          refreshNavyUsageAfterMediaTool,
        runImage: runGenerateImage,
        runVideo: runGenerateVideo,
        runAudio: runGenerateAudio,
      },
      toolCalls,
      onProgress,
      context,
      signal,
    );

  const {
    busy,
    queuedTurns,
    submitMessage,
    handleKeyDown,
    stopChat,
    clearQueue,
  } = useChutesChatRunner({
    provider,
    providerLabel,
    hasApiAccess,
    model,
    input,
    setInput,
    setTurnIntent,
    currentTurnDecision,
    pendingAttachments,
    setPendingAttachments,
    setAttachmentError,
    setChatError,
    messagesRef,
    commitMessages,
    toolAvailability,
    toolImageModel,
    imagePipelineEnabled,
    toolVideoModel,
    toolAudioModel,
    videoImage,
    videoAspect,
    videoDuration,
    ttsVoice,
    ttsFormat,
    ttsSpeed,
    callChatStreaming,
    handleToolCalls,
  });

  const chatMetrics = useMemo(
    () =>
      summarizeChatMetrics({
        messages,
        busy,
        queuedTurns: queuedTurns.length,
        providerTokensRemaining:
          provider === "navy"
            ? navyUsage?.usage.tokens_remaining_today
            : null,
        contextWindow: selectedChatModel?.contextWindow,
      }),
    [
      busy,
      messages,
      navyUsage?.usage.tokens_remaining_today,
      provider,
      queuedTurns.length,
      selectedChatModel?.contextWindow,
    ],
  );

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !shouldAutoScrollRef.current) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [busy, messages]);

  const clearChat = () => {
    commitMessages([]);
    clearQueue();
    setChatError(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
    if (isStudioStateAvailable()) {
      void deleteStudioState(storageKey);
    }
  };

  const selectCreatorIntent = (intent: ChatTurnIntent) => {
    setTurnIntent(intent);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const embedBaseUrl = embedOrigin || "https://your-domain.example";
  const chatEmbedUrl = `${embedBaseUrl}/?view=chat&embed=1`;
  const fullscreenChatEmbedUrl = `${chatEmbedUrl}&fullscreen=1`;
  const studioEmbedUrl = `${embedBaseUrl}/?view=image&embed=1`;
  const embedMarkdown = [
    '<iframe',
    `  src="${chatEmbedUrl}"`,
    '  title="Studio chat"',
    '  loading="lazy"',
    '  allow="clipboard-read; clipboard-write; fullscreen"',
    '  style="width:100%; min-height:720px; border:0; border-radius:12px;"',
    "></iframe>",
  ].join("\n");

  return (
    <>
      <div
        className={cn(
          "isolate flex flex-col bg-background",
          fullscreen
            ? "fixed inset-0 z-50 h-[100dvh] w-screen"
            : "h-full",
        )}
      >
        <ChutesChatHeader
          provider={provider}
          setProvider={setProvider}
          providerHeading={providerHeading}
          models={models}
          model={model}
          setModel={setModel}
          staticModelIds={staticModelIds}
          selectedChatModel={selectedChatModel}
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
          headerCollapsed={headerCollapsed}
          setHeaderCollapsed={setHeaderCollapsed}
          supportsReasoning={
            chatModelSupportsReasoning
          }
          reasoningEffort={reasoningEffort}
          setReasoningEffort={setReasoningEffort}
          imageModels={imageModels}
          toolImageModel={toolImageModel}
          setToolImageModel={setToolImageModel}
          imagePipelineEnabled={
            imagePipelineEnabled
          }
          setImagePipelineEnabled={
            setImagePipelineEnabled
          }
          imageRetryAttempts={imageRetryAttempts}
          setImageRetryAttempts={
            setImageRetryAttempts
          }
          preferMaximumImageQuality={preferMaximumImageQuality}
          setPreferMaximumImageQuality={setPreferMaximumImageQuality}
          metrics={chatMetrics}
          imageGenerationCallCeiling={imageGenerationCallCeiling}
          orderedToolImageModels={
            orderedToolImageModels
          }
          onTogglePipelineModel={
            togglePipelineModel
          }
          onReorderPipelineModel={
            reorderPipelineModel
          }
          videoModels={videoModels}
          toolVideoModel={toolVideoModel}
          setToolVideoModel={setToolVideoModel}
          audioModels={audioModels}
          toolAudioModel={toolAudioModel}
          setToolAudioModel={setToolAudioModel}
          toolSettings={toolSettings}
          setToolSettings={setToolSettings}
          onRefreshModels={onRefreshModels}
          modelsLoading={modelsLoading}
          modelsError={modelsError}
          navyUsage={navyUsage}
          navyUsageError={navyUsageError}
          navyUsageLoading={navyUsageLoading}
          navyUsageUpdatedAt={navyUsageUpdatedAt}
          onRefreshUsage={onRefreshUsage}
          customSystemPrompt={customSystemPrompt}
          setCustomSystemPrompt={
            setCustomSystemPrompt
          }
          embedDialogOpen={embedDialogOpen}
          setEmbedDialogOpen={setEmbedDialogOpen}
          chatEmbedUrl={chatEmbedUrl}
          fullscreenChatEmbedUrl={
            fullscreenChatEmbedUrl
          }
          studioEmbedUrl={studioEmbedUrl}
          embedMarkdown={embedMarkdown}
          embedCopied={
            copiedPromptMessageId ===
            "embed-markdown"
          }
          onCopyEmbed={() =>
            copyEmbedMarkdown(embedMarkdown)
          }
          fullscreen={fullscreen}
          setFullscreen={setFullscreen}
        />

        <ChutesChatConversation
          scrollRef={scrollRef}
          messages={messages}
          busy={busy}
          toolAvailability={toolAvailability}
          copiedPromptMessageId={
            copiedPromptMessageId
          }
          onSelectIntent={selectCreatorIntent}
          onCopyPrompt={copyPromptText}
          onOpenAttachment={
            openAttachmentPreview
          }
          onOpenMedia={openMediaPreview}
          onDownloadMedia={downloadChatMedia}
        />

        <ChutesChatComposer
          messageCount={messages.length}
          onClearChat={clearChat}
          fileInputRef={fileInputRef}
          composerRef={composerRef}
          attachmentAccept={attachmentAccept}
          pendingAttachments={pendingAttachments}
          attachmentLoading={attachmentLoading}
          attachmentUploadDisabled={
            attachmentUploadDisabled
          }
          onAddAttachmentFiles={(files) => {
            void addAttachmentFiles(files);
          }}
          onRemoveAttachment={
            removePendingAttachment
          }
          currentTurnDecision={currentTurnDecision}
          turnIntent={turnIntent}
          setTurnIntent={setTurnIntent}
          toolAvailability={toolAvailability}
          input={input}
          setInput={setInput}
          onKeyDown={handleKeyDown}
          busy={busy}
          hasApiAccess={hasApiAccess}
          onStop={stopChat}
          onSubmit={() => {
            void submitMessage();
          }}
          selectedChatModel={selectedChatModel}
          chatModelToolCapability={
            chatModelToolCapability
          }
          queuedTurns={queuedTurns}
          chatError={chatError}
          attachmentError={attachmentError}
        />
      </div>

      <ImageViewer
        open={Boolean(activeMediaPreview)}
        onOpenChange={closeMediaPreview}
        imageUrl={
          activeMediaPreview?.imageUrl ?? null
        }
        prompt={activeMediaPreview?.prompt ?? ""}
        model={activeMediaPreview?.model ?? ""}
        provider={
          activeMediaPreview?.provider ?? ""
        }
        kind={activeMediaPreview?.kind}
        mimeType={
          activeMediaPreview?.mimeType ?? null
        }
      />
    </>
  );
}
