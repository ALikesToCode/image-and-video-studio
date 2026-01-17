/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Trash2, Bot, User, Sparkles, Image as ImageIcon, ChevronDown, ChevronRight, BrainCircuit } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { type ModelOption } from "@/lib/constants";
import { dataUrlFromBase64, cn } from "@/lib/utils";
import { CHUTES_IMAGE_GUIDE_PROMPT } from "@/lib/chutes-prompts";
import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback } from "./ui/avatar";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import {
  deleteStudioState,
  getStudioState,
  isStudioStateAvailable,
  putStudioState,
} from "@/lib/studio-state-db";

type ToolCall = {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  images?: { id: string; dataUrl: string; mimeType: string }[];
};

type ChutesChatProps = {
  apiKey: string;
  models: ModelOption[];
  model: string;
  setModel: (value: string) => void;
  imageModels: ModelOption[];
  toolImageModel: string;
  setToolImageModel: (value: string) => void;
  onRefreshModels?: () => void;
  modelsLoading?: boolean;
  modelsError?: string | null;
};

const CHAT_STORAGE_KEY = "studio_chat_chutes_history";
const MAX_CHAT_MESSAGES = 120;

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readLocalStorage = <T,>(key: string, fallback: T): T => {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(key);
    if (!stored) return fallback;
    return JSON.parse(stored) as T;
  } catch {
    return fallback;
  }
};

const writeLocalStorage = (key: string, value: string) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
};

const sanitizeChatMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const role = record.role;
      const content = typeof record.content === "string" ? record.content : "";
      if (!id) return null;
      if (role !== "user" && role !== "assistant" && role !== "tool") return null;

      const message: ChatMessage = { id, role, content };
      if (typeof record.toolCallId === "string") message.toolCallId = record.toolCallId;
      if (typeof record.name === "string") message.name = record.name;

      if (Array.isArray(record.toolCalls)) {
        const toolCalls = record.toolCalls
          .map((tc) => {
            if (!tc || typeof tc !== "object") return null;
            const tcRecord = tc as Record<string, unknown>;
            const tcId = typeof tcRecord.id === "string" ? tcRecord.id : "";
            const tcType = typeof tcRecord.type === "string" ? tcRecord.type : "function";
            const fn = tcRecord.function;
            if (!fn || typeof fn !== "object") return null;
            const fnRecord = fn as Record<string, unknown>;
            const fnName = typeof fnRecord.name === "string" ? fnRecord.name : "";
            const fnArgs = typeof fnRecord.arguments === "string" ? fnRecord.arguments : "";
            if (!tcId || !fnName) return null;
            return {
              id: tcId,
              type: tcType,
              function: {
                name: fnName,
                arguments: fnArgs,
              },
            };
          })
          .filter((entry): entry is ToolCall => !!entry);
        if (toolCalls.length) message.toolCalls = toolCalls;
      }

      if (Array.isArray(record.images)) {
        const images = record.images
          .map((img) => {
            if (!img || typeof img !== "object") return null;
            const imgRecord = img as Record<string, unknown>;
            const imgId = typeof imgRecord.id === "string" ? imgRecord.id : "";
            const dataUrl = typeof imgRecord.dataUrl === "string" ? imgRecord.dataUrl : "";
            const mimeType = typeof imgRecord.mimeType === "string" ? imgRecord.mimeType : "";
            if (!imgId || !dataUrl) return null;
            return { id: imgId, dataUrl, mimeType: mimeType || "image/png" };
          })
          .filter((entry): entry is { id: string; dataUrl: string; mimeType: string } => !!entry);
        if (images.length) message.images = images;
      }

      return message;
    })
    .filter((entry): entry is ChatMessage => !!entry)
    .slice(-MAX_CHAT_MESSAGES);
};

// Helper component for the thinking block
function ThinkingBlock({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="mb-3 rounded-xl bg-background/50 border border-border/50 overflow-hidden text-xs">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-muted-foreground/80 font-medium select-none"
      >
        <BrainCircuit className="h-3.5 w-3.5" />
        <span>Thinking Process</span>
        <ChevronRight className={cn("h-3.5 w-3.5 ml-auto transition-transform", isExpanded && "rotate-90")} />
      </button>
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="p-3 pt-0 font-mono text-muted-foreground/70 whitespace-pre-wrap leading-relaxed border-t border-border/30 border-dashed">
              {content.trim()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ChutesChat({
  apiKey,
  models,
  model,
  setModel,
  imageModels,
  toolImageModel,
  setToolImageModel,
  onRefreshModels,
  modelsLoading,
  modelsError,
}: ChutesChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMessages = async () => {
      if (typeof window === "undefined") return;
      let storedMessages: ChatMessage[] = [];

      if (isStudioStateAvailable()) {
        try {
          const fromDb = await getStudioState<ChatMessage[]>(CHAT_STORAGE_KEY);
          storedMessages = sanitizeChatMessages(fromDb);
        } catch {
          storedMessages = [];
        }
      }

      if (!storedMessages.length) {
        storedMessages = sanitizeChatMessages(
          readLocalStorage<ChatMessage[]>(CHAT_STORAGE_KEY, [])
        );
      }

      if (!cancelled && storedMessages.length) {
        setMessages(storedMessages);
      }
    };

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (messages.length <= MAX_CHAT_MESSAGES) return;
    setMessages((prev) => prev.slice(-MAX_CHAT_MESSAGES));
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trimmed = messages.slice(-MAX_CHAT_MESSAGES);
    const persist = async () => {
      if (isStudioStateAvailable()) {
        try {
          await putStudioState(CHAT_STORAGE_KEY, trimmed);
          return;
        } catch {
          // fall through to localStorage
        }
      }
      try {
        writeLocalStorage(CHAT_STORAGE_KEY, JSON.stringify(trimmed));
      } catch {
        // ignore storage failures
      }
    };

    const handle = window.setTimeout(() => {
      void persist();
    }, 300);

    return () => window.clearTimeout(handle);
  }, [messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, busy]);

  const toolSpec = useMemo(
    () => [
      {
        type: "function",
        function: {
          name: "generate_image",
          description:
            "Generate an image. Use the default model unless the user asks for a specific one.",
          parameters: {
            type: "object",
            properties: {
              prompt: { type: "string", description: "Image description." },
              model: { type: "string", description: "Image model id." },
              negative_prompt: {
                type: "string",
                description: "What to avoid in the image.",
              },
              guidance_scale: { type: "number", description: "CFG guidance." },
              width: { type: "number", description: "Width in pixels." },
              height: { type: "number", description: "Height in pixels." },
              resolution: {
                type: "string",
                description: "Resolution like 1024x1024 (HiDream).",
              },
              num_inference_steps: {
                type: "number",
                description: "Diffusion steps.",
              },
              seed: { type: "integer", description: "Seed (optional)." },
            },
            required: ["prompt"],
          },
        },
      },
    ],
    []
  );

  const systemPrompt = useMemo(() => {
    const modelList = imageModels.map((item) => item.id).join(", ");
    return `${CHUTES_IMAGE_GUIDE_PROMPT}

You are an image generation assistant. Use the guide above to help craft prompts, ask for missing details when needed, and summarize the final prompt before generating.

You can call the generate_image tool. Default image model: ${toolImageModel}. Available image models: ${modelList}.`;
  }, [toolImageModel, imageModels]);

  const toApiMessages = (items: ChatMessage[]) =>
    items.map((message) => {
      const base: Record<string, unknown> = {
        role: message.role,
        content: message.content,
      };
      if (message.role === "assistant" && message.toolCalls?.length) {
        base.tool_calls = message.toolCalls;
      }
      if (message.role === "tool") {
        base.tool_call_id = message.toolCallId;
        if (message.name) base.name = message.name;
      }
      return base;
    });



  const callChatStreaming = async (
    items: ChatMessage[],
    onUpdate: (update: { content?: string; toolCalls?: ToolCall[]; role?: string }) => void
  ) => {
    const response = await fetch("/api/chutes/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...toApiMessages(items),
        ],
        tools: toolSpec,
        toolChoice: "auto",
        maxTokens: 1024,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload?.error ?? "Chat request failed.");
    }

    if (!response.body) {
      throw new Error("No response body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // Accumulators
    let contentAcc = "";
    // Tool calls are tricky because they come as deltas to specific indices
    // We'll maintain a map or array of tool calls being built
    const toolCallsMap: Record<number, { id?: string; type?: string; name?: string; args?: string }> = {};

    const parser = createParser({
      onEvent: (event: EventSourceMessage) => {
        if (event.data === "[DONE]") return;
        try {
          const json = JSON.parse(event.data);
          const choice = json.choices?.[0];
          if (!choice) return;

          const delta = choice.delta;

          // Debugging aid
          // console.log("delta", delta);

          if (delta.content) {
            contentAcc += delta.content;
            onUpdate({ content: contentAcc });
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index;
              if (!toolCallsMap[index]) {
                toolCallsMap[index] = { args: "" };
              }
              const current = toolCallsMap[index];

              if (tc.id) current.id = tc.id;
              if (tc.type) current.type = tc.type;
              if (tc.function?.name) current.name = tc.function.name;
              if (tc.function?.arguments) current.args += tc.function.arguments;
            }

            // Reconstruct full tool calls array
            const toolCalls: ToolCall[] = Object.values(toolCallsMap).map((tc) => ({
              id: tc.id || "",
              type: tc.type || "function",
              function: {
                name: tc.name || "",
                arguments: tc.args || "",
              }
            })).filter(tc => tc.function.name && tc.id); // Only partial filter, might be incomplete

            if (toolCalls.length > 0) {
              onUpdate({ toolCalls });
            }
          }
        } catch (e) {
          console.error("Parse error", e);
        }
      }
    });

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value));
      }
    } finally {
      reader.releaseLock();
    }

    // Final result return could be useful, but state is updated via callback
    return {
      content: contentAcc,
      toolCalls: Object.values(toolCallsMap).map((tc) => ({
        id: tc.id || "",
        type: tc.type || "function",
        function: {
          name: tc.name || "",
          arguments: tc.args || "",
        }
      }))
    };
  };

  const runGenerateImage = async (args: Record<string, unknown>) => {
    if (!apiKey.trim()) {
      throw new Error("Missing API key for image tool.");
    }
    const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
    if (!prompt) {
      throw new Error("Tool call missing prompt.");
    }
    const modelOverride =
      typeof args.model === "string" && args.model.trim().length
        ? args.model.trim()
        : toolImageModel;
    const response = await fetch("/api/chutes/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        model: modelOverride,
        prompt,
        negativePrompt:
          typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
        guidanceScale:
          typeof args.guidance_scale === "number" ? args.guidance_scale : undefined,
        width: typeof args.width === "number" ? args.width : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
        resolution:
          typeof args.resolution === "string" ? args.resolution : undefined,
        numInferenceSteps:
          typeof args.num_inference_steps === "number"
            ? args.num_inference_steps
            : undefined,
        seed: typeof args.seed === "number" ? args.seed : null,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error ?? "Image tool failed.");
    }
    const images = Array.isArray(payload?.images)
      ? (payload.images as Array<{ data?: unknown; mimeType?: unknown }>)
      : [];
    if (!images.length) {
      throw new Error("No images returned by tool.");
    }
    const parsedImages = images
      .map((image) => {
        const data = typeof image?.data === "string" ? image.data : "";
        const mimeType =
          typeof image?.mimeType === "string" ? image.mimeType : "image/png";
        if (!data) return null;
        return {
          id: createId(),
          dataUrl: dataUrlFromBase64(data, mimeType),
          mimeType,
        };
      })
      .filter(
        (item): item is { id: string; dataUrl: string; mimeType: string } =>
          !!item
      );
    if (!parsedImages.length) {
      throw new Error("No usable images returned by tool.");
    }
    return { images: parsedImages, model: modelOverride };
  };

  const handleToolCalls = async (toolCalls: ToolCall[]) => {
    const toolMessages: ChatMessage[] = [];
    for (const toolCall of toolCalls) {
      if (toolCall.function?.name !== "generate_image") {
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: "Tool error: Unknown tool call.",
          toolCallId: toolCall.id,
          name: toolCall.function?.name,
        });
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        args = toolCall.function?.arguments
          ? (JSON.parse(toolCall.function.arguments) as Record<string, unknown>)
          : {};
      } catch {
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: "Tool error: Invalid tool arguments.",
          toolCallId: toolCall.id,
          name: toolCall.function?.name,
        });
        continue;
      }
      try {
        const result = await runGenerateImage(args);
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: `Generated ${result.images.length} image(s) using ${result.model}.`,
          toolCallId: toolCall.id,
          name: toolCall.function?.name,
          images: result.images,
        });
      } catch (error) {
        toolMessages.push({
          id: createId(),
          role: "tool",
          content: `Tool error: ${error instanceof Error ? error.message : "Tool failed."}`,
          toolCallId: toolCall.id,
          name: toolCall.function?.name,
        });
      }
    }
    return toolMessages;
  };

  const submitMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    if (!apiKey.trim()) {
      setChatError("Add your Chutes API key in settings.");
      return;
    }
    if (!model) {
      setChatError("Select a chat model.");
      return;
    }
    setChatError(null);
    setInput("");

    const userMessage: ChatMessage = {
      id: createId(),
      role: "user",
      content: trimmed,
    };

    // Optimistic update
    let currentMessages: ChatMessage[] = [...messages, userMessage];
    setMessages(currentMessages);
    setBusy(true);

    try {
      for (let step = 0; step < 3; step += 1) {
        // Create placeholder assistant message
        const assistantId = createId();
        const assistantMessage: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: "",
        };

        // Add to state immediately
        currentMessages = [...currentMessages, assistantMessage];
        setMessages(currentMessages);

        // Stream content into this message
        const finalResult = await callChatStreaming(
          currentMessages.slice(0, -1), // Send history excluding the placeholder
          (update) => {
            setMessages((prev) => prev.map((msg) => {
              if (msg.id === assistantId) {
                return {
                  ...msg,
                  content: update.content ?? msg.content,
                  toolCalls: update.toolCalls ?? msg.toolCalls,
                };
              }
              return msg;
            }));
          }
        );

        // After stream is done, final update to ensure consistency (and clean up any missing fields)
        const finalToolCalls = finalResult.toolCalls.filter(tc => tc.id && tc.function.name);

        // Update the message in our local variable to be current
        const finalizedAssistantMessage: ChatMessage = {
          id: assistantId,
          role: "assistant",
          content: finalResult.content,
          toolCalls: finalToolCalls.length ? finalToolCalls : undefined
        };

        // Replace the placeholder in currentMessages with the finalized one
        currentMessages = [...currentMessages.slice(0, -1), finalizedAssistantMessage];
        setMessages(currentMessages);

        // Check for tool calls
        if (!finalToolCalls.length) break;

        // Run tools
        const toolMessages = await handleToolCalls(finalToolCalls);
        currentMessages = [...currentMessages, ...toolMessages];
        setMessages(currentMessages);
      }
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "Unable to run chat."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setChatError(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
    }
    if (isStudioStateAvailable()) {
      void deleteStudioState(CHAT_STORAGE_KEY);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background/50 isolate">
      {/* Header */}
      <header className="flex-none p-4 glass border-b sticky top-0 z-10">
        <div className="flex flex-col sm:flex-row gap-3 justify-between items-center max-w-5xl mx-auto w-full">
          <div className="flex items-center gap-2">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-2 rounded-xl bg-primary/10 text-primary"
            >
              <Bot className="h-6 w-6" />
            </motion.div>
            <div>
              <h2 className="font-semibold text-lg leading-none">Chutes Agent</h2>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                Online
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="w-full sm:w-[200px] h-9 glass-card border-0 bg-secondary/50">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={toolImageModel} onValueChange={setToolImageModel}>
              <SelectTrigger className="w-full sm:w-[40px] px-0 justify-center h-9 glass-card border-0 bg-secondary/50" title="Image Model">
                <ImageIcon className="h-4 w-4" />
              </SelectTrigger>
              <SelectContent>
                {imageModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {onRefreshModels && (
              <Button variant="ghost" size="icon" onClick={onRefreshModels} disabled={modelsLoading} className="h-9 w-9">
                <Sparkles className={cn("h-4 w-4", modelsLoading && "animate-spin")} />
              </Button>
            )}
          </div>
        </div>
        {modelsError ? (
          <div className="max-w-5xl mx-auto w-full pt-2">
            <p className="text-xs text-destructive">{modelsError}</p>
          </div>
        ) : null}
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto min-h-0 container mx-auto" ref={scrollRef}>
        <div className="max-w-3xl mx-auto py-6 space-y-6 px-4">
          <AnimatePresence initial={false} mode="popLayout">
            {messages.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-4"
              >
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-primary/60" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-medium">How can I help you create?</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Ask me to generate images, refine prompts, or brainstorm ideas.
                  </p>
                </div>
              </motion.div>
            ) : (
              messages.map((message) => {
                const isUser = message.role === "user";
                const isTool = message.role === "tool";
                const isAssistant = message.role === "assistant";

                if (isTool && !message.images?.length && !message.content.includes("error")) {
                  // Collapse purely technical tool outputs unless they have images or errors
                  return null;
                }

                // Parse content for <think> blocks
                let thoughtContent: string | null = null;
                let displayContent = message.content;

                if (isAssistant) {
                  const thinkMatch = message.content.match(/<think>([\s\S]*?)<\/think>/);
                  if (thinkMatch) {
                    thoughtContent = thinkMatch[1];
                    displayContent = message.content.replace(/<think>[\s\S]*?<\/think>/, "").trim();
                  }
                }

                return (
                  <motion.div
                    key={message.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.3 }}
                    className={cn(
                      "flex gap-4 group",
                      isUser ? "flex-row-reverse" : "flex-row"
                    )}
                  >
                    <Avatar className={cn("h-8 w-8 border", isUser ? "bg-primary text-primary-foreground" : "bg-card")}>
                      <AvatarFallback className={isUser ? "bg-primary text-primary-foreground" : "bg-secondary"}>
                        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>

                    <div className={cn(
                      "flex flex-col gap-2 max-w-[85%]",
                      isUser ? "items-end" : "items-start",
                      "w-full"
                    )}>
                      {/* Name/Role */}
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium px-1">
                        {isUser ? "You" : isTool ? "System Helper" : "Agent"}
                      </span>

                      {/* Content */}
                      <div className={cn(
                        "relative rounded-2xl px-5 py-3.5 text-sm shadow-sm w-full transition-all duration-300",
                        isUser
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : isTool
                            ? "bg-secondary/50 text-secondary-foreground border border-border/50 text-xs font-mono"
                            : "glass-card text-foreground rounded-tl-sm"
                      )}>

                        {thoughtContent && <ThinkingBlock content={thoughtContent} />}

                        {displayContent ? (
                          isUser ? (
                            <p className="whitespace-pre-wrap leading-relaxed">{displayContent}</p>
                          ) : (
                            <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {displayContent}
                              </ReactMarkdown>
                            </div>
                          )
                        ) : message.toolCalls?.length ? (
                          <div className="flex items-center gap-2 text-muted-foreground italic text-xs">
                            <Sparkles className="h-3 w-3" />
                            Generating content...
                          </div>
                        ) : null}

                        {/* Images Grid */}
                        {message.images?.length ? (
                          <div className="grid grid-cols-2 gap-2 mt-3 w-full">
                            {message.images.map((image) => (
                              <motion.div
                                key={image.id}
                                layoutId={image.id}
                                className="relative aspect-square rounded-lg overflow-hidden border bg-background/50 group/image"
                              >
                                <img
                                  src={image.dataUrl}
                                  alt="Generated"
                                  className="w-full h-full object-cover transition-transform duration-500 group-hover/image:scale-110"
                                />
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/image:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                  <Button size="icon" variant="secondary" className="h-8 w-8 rounded-full" onClick={() => window.open(image.dataUrl, '_blank')}>
                                    <ChevronDown className="h-4 w-4" />
                                  </Button>
                                </div>
                              </motion.div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}

            {busy && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex gap-4"
              >
                <div className="w-8 h-8 flex items-center justify-center">
                  <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce [animation-delay:-0.15s] mx-1" />
                  <div className="w-2 h-2 bg-primary/50 rounded-full animate-bounce" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="h-4" />
        </div>
      </div>

      {/* Input Area */}
      <footer className="flex-none p-4 glass border-t mt-auto">
        <div className="max-w-3xl mx-auto w-full relative">
          <AnimatePresence>
            {messages.length > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="absolute -top-12 right-0"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearChat}
                  className="text-muted-foreground hover:text-destructive transition-colors gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear Chat
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative glass-card rounded-3xl p-1.5 flex items-end gap-2 shadow-lg ring-1 ring-white/20">
            <div className="flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message Chutes Agent..."
                className="min-h-[48px] max-h-[200px] w-full resize-none border-0 bg-transparent py-3 px-4 focus-visible:ring-0 text-base"
                rows={1}
              />
            </div>
            <Button
              size="icon"
              onClick={() => void submitMessage()}
              disabled={!input.trim() || busy || !apiKey.trim()}
              className={cn(
                "h-10 w-10 rounded-full mb-1 transition-all duration-300 shadow",
                input.trim() ? "bg-primary text-primary-foreground hover:scale-105" : "bg-muted text-muted-foreground"
              )}
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
          {chatError ? (
            <p className="mt-2 text-xs text-destructive">{chatError}</p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
