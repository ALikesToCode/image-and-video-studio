"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  ChatProvider,
  ModelOption,
} from "@/lib/constants";
import {
  collectUnsafeChatMediaAssets,
  stripHeavyMediaFromMessagesForStorage,
} from "@/lib/chat-tooling";
import { mergeUnsafeMediaBackup } from "@/lib/media-backup";
import {
  deleteStudioState,
  getStudioState,
  isStudioStateAvailable,
  putStudioState,
} from "@/lib/studio-state-db";

import {
  getChatStorageKey,
  getReasoningPreferencesStorageKey,
  getSystemPromptStorageKey,
  getToolAudioModelStorageKey,
  getToolSettingsStorageKey,
  getToolVideoModelStorageKey,
  sanitizeChatMessages,
  sanitizeReasoningPreferences,
  sanitizeToolSettings,
} from "./chutes-chat-state";
import {
  readLocalStorage,
  writeLocalStorage,
} from "./chutes-chat-runtime";
import {
  DEFAULT_TOOL_SETTINGS,
  MAX_CHAT_MESSAGES,
  type ChatMessage,
  type ReasoningEffort,
  type ToolSettings,
} from "./chutes-chat-types";

type UseChutesChatPersistenceOptions = {
  provider: ChatProvider;
  model: string;
  videoModels: ModelOption[];
  audioModels: ModelOption[];
  supportsReasoning: boolean;
};

export const useChutesChatPersistence = ({
  provider,
  model,
  videoModels,
  audioModels,
  supportsReasoning,
}: UseChutesChatPersistenceOptions) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [customSystemPrompt, setCustomSystemPrompt] =
    useState("");
  const [systemPromptHydrated, setSystemPromptHydrated] =
    useState(false);
  const [toolVideoModel, setToolVideoModel] = useState(
    videoModels[0]?.id ?? "",
  );
  const [toolAudioModel, setToolAudioModel] = useState(
    audioModels[0]?.id ?? "",
  );
  const [toolSettings, setToolSettings] =
    useState<ToolSettings>({
      ...DEFAULT_TOOL_SETTINGS,
    });
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>("high");
  const [toolSettingsHydrated, setToolSettingsHydrated] =
    useState(false);
  const [
    reasoningPreferencesHydrated,
    setReasoningPreferencesHydrated,
  ] = useState(false);
  const reasoningPreferenceModelRef = useRef("");

  const storageKey = useMemo(
    () => getChatStorageKey(provider),
    [provider],
  );
  const systemPromptStorageKey = useMemo(
    () => getSystemPromptStorageKey(provider),
    [provider],
  );
  const toolSettingsStorageKey = useMemo(
    () => getToolSettingsStorageKey(provider),
    [provider],
  );
  const toolVideoModelStorageKey = useMemo(
    () => getToolVideoModelStorageKey(provider),
    [provider],
  );
  const toolAudioModelStorageKey = useMemo(
    () => getToolAudioModelStorageKey(provider),
    [provider],
  );
  const reasoningPreferencesStorageKey = useMemo(
    () => getReasoningPreferencesStorageKey(provider),
    [provider],
  );

  const commitMessages = useCallback(
    (nextMessages: ChatMessage[]) => {
      const boundedMessages =
        nextMessages.length > MAX_CHAT_MESSAGES
          ? nextMessages.slice(-MAX_CHAT_MESSAGES)
          : nextMessages;
      messagesRef.current = boundedMessages;
      setMessages(boundedMessages);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      if (typeof window === "undefined") return;
      let storedMessages: ChatMessage[] = [];
      const backupKey = `${storageKey}_unsafe_media_backup_v1`;

      if (isStudioStateAvailable()) {
        try {
          const fromDb =
            await getStudioState<ChatMessage[]>(storageKey);
          const unsafeMedia =
            collectUnsafeChatMediaAssets(fromDb);
          storedMessages = sanitizeChatMessages(fromDb);
          if (unsafeMedia.length) {
            try {
              const existingBackup =
                await getStudioState(backupKey);
              await putStudioState(
                backupKey,
                mergeUnsafeMediaBackup(
                  existingBackup,
                  unsafeMedia,
                ),
              );
              await putStudioState(
                storageKey,
                storedMessages,
              );
            } catch {
              // Unsafe entries remain blocked in memory.
            }
          }
        } catch {
          storedMessages = [];
        }
      }

      const fromLocalStorage = readLocalStorage<
        ChatMessage[]
      >(storageKey, []);
      const localUnsafeMedia =
        collectUnsafeChatMediaAssets(fromLocalStorage);
      const localMessages = sanitizeChatMessages(
        fromLocalStorage,
      );
      if (localUnsafeMedia.length) {
        try {
          const existingBackup = readLocalStorage(
            backupKey,
            null,
          );
          writeLocalStorage(
            backupKey,
            JSON.stringify(
              mergeUnsafeMediaBackup(
                existingBackup,
                localUnsafeMedia,
              ),
            ),
          );
          writeLocalStorage(
            storageKey,
            JSON.stringify(localMessages),
          );
        } catch {
          // Unsafe entries remain blocked in memory.
        }
      }

      if (!storedMessages.length) {
        storedMessages = localMessages;
      }
      if (!cancelled) {
        commitMessages(storedMessages);
      }
    };

    const resetHandle = window.setTimeout(() => {
      if (!cancelled) commitMessages([]);
    }, 0);
    void loadMessages();
    return () => {
      cancelled = true;
      window.clearTimeout(resetHandle);
    };
  }, [commitMessages, storageKey]);

  useEffect(() => {
    let cancelled = false;
    const loadSystemPrompt = async () => {
      if (typeof window === "undefined") return;
      let storedPrompt = "";

      if (isStudioStateAvailable()) {
        try {
          const fromDb = await getStudioState<string>(
            systemPromptStorageKey,
          );
          if (typeof fromDb === "string") {
            storedPrompt = fromDb;
          }
        } catch {
          storedPrompt = "";
        }
      }
      if (!storedPrompt) {
        const fromStorage = readLocalStorage<string>(
          systemPromptStorageKey,
          "",
        );
        if (typeof fromStorage === "string") {
          storedPrompt = fromStorage;
        }
      }
      if (!cancelled) {
        setCustomSystemPrompt(storedPrompt);
        setSystemPromptHydrated(true);
      }
    };

    const resetHandle = window.setTimeout(() => {
      if (cancelled) return;
      setSystemPromptHydrated(false);
      setCustomSystemPrompt("");
    }, 0);
    void loadSystemPrompt();
    return () => {
      cancelled = true;
      window.clearTimeout(resetHandle);
    };
  }, [systemPromptStorageKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !systemPromptHydrated
    ) {
      return;
    }
    const persist = async () => {
      const hasValue =
        customSystemPrompt.trim().length > 0;
      if (isStudioStateAvailable()) {
        try {
          if (hasValue) {
            await putStudioState(
              systemPromptStorageKey,
              customSystemPrompt,
            );
          } else {
            await deleteStudioState(
              systemPromptStorageKey,
            );
          }
        } catch {
          // localStorage remains the fallback.
        }
      }
      try {
        if (hasValue) {
          writeLocalStorage(
            systemPromptStorageKey,
            JSON.stringify(customSystemPrompt),
          );
        } else {
          window.localStorage.removeItem(
            systemPromptStorageKey,
          );
        }
      } catch {
        // Keep the in-memory value when storage is blocked.
      }
    };
    const handle = window.setTimeout(() => {
      void persist();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [
    customSystemPrompt,
    systemPromptHydrated,
    systemPromptStorageKey,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextToolSettings = sanitizeToolSettings(
      readLocalStorage<unknown>(
        toolSettingsStorageKey,
        DEFAULT_TOOL_SETTINGS,
      ),
    );
    const storedToolVideoModel = readLocalStorage<string>(
      toolVideoModelStorageKey,
      "",
    );
    const storedToolAudioModel = readLocalStorage<string>(
      toolAudioModelStorageKey,
      "",
    );

    const handle = window.setTimeout(() => {
      setToolSettings(nextToolSettings);
      setToolVideoModel(
        storedToolVideoModel ||
          videoModels[0]?.id ||
          "",
      );
      setToolAudioModel(
        storedToolAudioModel ||
          audioModels[0]?.id ||
          "",
      );
      setToolSettingsHydrated(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [
    audioModels,
    provider,
    toolAudioModelStorageKey,
    toolSettingsStorageKey,
    toolVideoModelStorageKey,
    videoModels,
  ]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !toolSettingsHydrated
    ) {
      return;
    }
    writeLocalStorage(
      toolSettingsStorageKey,
      JSON.stringify(toolSettings),
    );
  }, [
    toolSettings,
    toolSettingsHydrated,
    toolSettingsStorageKey,
  ]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !toolSettingsHydrated
    ) {
      return;
    }
    if (toolVideoModel) {
      writeLocalStorage(
        toolVideoModelStorageKey,
        JSON.stringify(toolVideoModel),
      );
    } else {
      window.localStorage.removeItem(
        toolVideoModelStorageKey,
      );
    }
  }, [
    toolSettingsHydrated,
    toolVideoModel,
    toolVideoModelStorageKey,
  ]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !toolSettingsHydrated
    ) {
      return;
    }
    if (toolAudioModel) {
      writeLocalStorage(
        toolAudioModelStorageKey,
        JSON.stringify(toolAudioModel),
      );
    } else {
      window.localStorage.removeItem(
        toolAudioModelStorageKey,
      );
    }
  }, [
    toolAudioModel,
    toolAudioModelStorageKey,
    toolSettingsHydrated,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    reasoningPreferenceModelRef.current = "";
    const handle = window.setTimeout(() => {
      const preferences = sanitizeReasoningPreferences(
        readLocalStorage<unknown>(
          reasoningPreferencesStorageKey,
          {},
        ),
      );
      setReasoningEffort(preferences[model] ?? "high");
      reasoningPreferenceModelRef.current = model;
      setReasoningPreferencesHydrated(true);
    }, 0);
    return () => window.clearTimeout(handle);
  }, [model, reasoningPreferencesStorageKey]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !reasoningPreferencesHydrated ||
      !model ||
      !supportsReasoning ||
      reasoningPreferenceModelRef.current !== model
    ) {
      return;
    }
    const handle = window.setTimeout(() => {
      const preferences = sanitizeReasoningPreferences(
        readLocalStorage<unknown>(
          reasoningPreferencesStorageKey,
          {},
        ),
      );
      preferences[model] = reasoningEffort;
      writeLocalStorage(
        reasoningPreferencesStorageKey,
        JSON.stringify(preferences),
      );
    }, 150);
    return () => window.clearTimeout(handle);
  }, [
    model,
    reasoningEffort,
    reasoningPreferencesHydrated,
    reasoningPreferencesStorageKey,
    supportsReasoning,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trimmed = stripHeavyMediaFromMessagesForStorage(
      messages.filter((message) => !message.transient),
      MAX_CHAT_MESSAGES,
    );
    const persist = async () => {
      if (isStudioStateAvailable()) {
        try {
          await putStudioState(storageKey, trimmed);
          return;
        } catch {
          // localStorage remains the fallback.
        }
      }
      try {
        writeLocalStorage(
          storageKey,
          JSON.stringify(trimmed),
        );
      } catch {
        // Keep the in-memory conversation.
      }
    };
    const handle = window.setTimeout(() => {
      void persist();
    }, 300);
    return () => window.clearTimeout(handle);
  }, [messages, storageKey]);

  return {
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
  };
};
