/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquarePlus } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/app/components/ui/card";
import { Label } from "@/app/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { type ModelOption } from "@/lib/constants";
import { dataUrlFromBase64 } from "@/lib/utils";
import { CHUTES_IMAGE_GUIDE_PROMPT } from "@/lib/chutes-prompts";

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

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

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
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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

  const callChat = async (items: ChatMessage[]) => {
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
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error ?? "Chat request failed.");
    }
    return payload;
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
    let nextMessages: ChatMessage[] = [...messages, userMessage];
    setMessages(nextMessages);
    setBusy(true);
    try {
      for (let step = 0; step < 3; step += 1) {
        const payload = await callChat(nextMessages);
        const message = payload?.choices?.[0]?.message;
        const content =
          typeof message?.content === "string" ? message.content : "";
        const toolCalls = Array.isArray(message?.tool_calls)
          ? (message.tool_calls as ToolCall[])
          : Array.isArray(message?.toolCalls)
            ? (message.toolCalls as ToolCall[])
            : [];
        const assistantMessage: ChatMessage = {
          id: createId(),
          role: "assistant",
          content,
          toolCalls: toolCalls.length ? toolCalls : undefined,
        };
        nextMessages = [...nextMessages, assistantMessage];
        setMessages(nextMessages);
        if (!toolCalls.length) break;
        const toolMessages = await handleToolCalls(toolCalls);
        nextMessages = [...nextMessages, ...toolMessages];
        setMessages(nextMessages);
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
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setChatError(null);
  };

  return (
    <Card className="border-2 border-primary/10 shadow-xl bg-card/50 backdrop-blur-3xl">
      <CardHeader className="space-y-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquarePlus className="h-5 w-5" />
          Chutes Agent Chat
        </CardTitle>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Chat Model</Label>
              {onRefreshModels ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRefreshModels}
                  disabled={modelsLoading}
                >
                  {modelsLoading ? "Refreshing..." : "Refresh models"}
                </Button>
              ) : null}
            </div>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {modelsError ? (
              <p className="text-xs text-destructive">{modelsError}</p>
            ) : null}
            {!apiKey.trim() ? (
              <p className="text-xs text-muted-foreground">
                Add your Chutes API key in settings to enable chat.
              </p>
            ) : null}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Default Image Model (Tool)</Label>
            <Select value={toolImageModel} onValueChange={setToolImageModel}>
              <SelectTrigger>
                <SelectValue placeholder="Select image model" />
              </SelectTrigger>
              <SelectContent>
                {imageModels.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          ref={scrollRef}
          className="max-h-[420px] space-y-4 overflow-y-auto rounded-lg border bg-muted/20 p-4"
        >
          {messages.length ? (
            messages.map((message) => {
              const isUser = message.role === "user";
              const isTool = message.role === "tool";
              const label =
                message.role === "assistant"
                  ? "Assistant"
                  : message.role === "tool"
                    ? message.name ?? "Tool"
                    : "You";
              return (
                <div
                  key={message.id}
                  className={`max-w-[85%] space-y-2 rounded-lg p-3 text-sm ${isUser
                    ? "ml-auto bg-primary text-primary-foreground"
                    : isTool
                      ? "bg-muted"
                      : "bg-card"} `}
                >
                  <div className="text-[10px] uppercase tracking-wide opacity-70">
                    {label}
                  </div>
                  {message.content ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : message.toolCalls?.length ? (
                    <p className="italic opacity-70">Tool call requested.</p>
                  ) : (
                    <p className="italic opacity-70">No message content.</p>
                  )}
                  {message.images?.length ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {message.images.map((image) => (
                        <img
                          key={image.id}
                          src={image.dataUrl}
                          alt="Generated"
                          className="w-full rounded-md border"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              Ask for an image or a plan. The agent can call tools.
            </p>
          )}
        </div>

        {chatError ? (
          <p className="text-sm text-destructive">{chatError}</p>
        ) : null}

        <div className="space-y-2">
          <Label>Message</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask the agent to generate or refine prompts..."
            className="min-h-[90px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void submitMessage()}
              disabled={busy || !input.trim() || !apiKey.trim() || !model}
              className="flex-1"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Thinking...
                </>
              ) : (
                "Send message"
              )}
            </Button>
            <Button
              variant="outline"
              onClick={clearChat}
              disabled={busy || !messages.length}
            >
              Clear chat
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Press <kbd className="font-mono">Cmd+Enter</kbd> to send.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
