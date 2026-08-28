/* eslint-disable @next/next/no-img-element */
"use client";

import type { RefObject } from "react";
import {
  Bot,
  Check,
  Copy,
  Download,
  FileText,
  Maximize2,
  Sparkles,
  User,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
} from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  type ChatAttachmentAsset,
  type ChatMediaAsset,
} from "@/lib/chat-media-persistence";
import type { ChatTurnIntent } from "@/lib/chat-turn-policy";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { CreatorWelcome } from "./creator-welcome";
import {
  ThinkingBlock,
  ToolCallsBlock,
} from "./chutes-chat-message-details";
import {
  chatTurnIntentLabel,
  type ChatMessage,
} from "./chutes-chat-types";

type ToolAvailability = {
  image: boolean;
  video: boolean;
  audio: boolean;
};

type ChutesChatConversationProps = {
  scrollRef: RefObject<HTMLDivElement | null>;
  messages: ChatMessage[];
  busy: boolean;
  toolAvailability: ToolAvailability;
  copiedPromptMessageId: string | null;
  onSelectIntent: (intent: ChatTurnIntent) => void;
  onCopyPrompt: (
    messageId: string,
    prompt: string,
  ) => void | Promise<void>;
  onOpenAttachment: (
    attachment: ChatAttachmentAsset,
    prompt: string,
  ) => void;
  onOpenMedia: (
    item: ChatMediaAsset,
    prompt: string,
  ) => void;
  onDownloadMedia: (item: ChatMediaAsset) => void;
};

const parseAssistantContent = (message: ChatMessage) => {
  let thoughtContent =
    typeof message.thinking === "string" &&
    message.thinking.trim()
      ? message.thinking
      : null;
  let displayContent = message.content;

  if (message.role === "assistant") {
    const thinkMatch = message.content.match(
      /<think>([\s\S]*?)<\/think>/,
    );
    if (thinkMatch) {
      thoughtContent = thoughtContent
        ? `${thoughtContent}\n${thinkMatch[1]}`
        : thinkMatch[1];
      displayContent = message.content
        .replace(/<think>[\s\S]*?<\/think>/, "")
        .trim();
    }
  }
  return { thoughtContent, displayContent };
};

export function ChutesChatConversation({
  scrollRef,
  messages,
  busy,
  toolAvailability,
  copiedPromptMessageId,
  onSelectIntent,
  onCopyPrompt,
  onOpenAttachment,
  onOpenMedia,
  onDownloadMedia,
}: ChutesChatConversationProps) {
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-4"
      ref={scrollRef}
    >
      <div className="mx-auto w-full max-w-7xl space-y-4 py-4 sm:space-y-6 sm:py-6">
        <AnimatePresence initial={false} mode="popLayout">
          {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.18,
                ease: "easeOut",
              }}
            >
              <CreatorWelcome
                availability={toolAvailability}
                onSelectIntent={onSelectIntent}
              />
            </motion.div>
          ) : (
            messages.map((message) => {
              const isUser = message.role === "user";
              const isTool = message.role === "tool";
              const isAssistant =
                message.role === "assistant";
              const mediaItems =
                message.media ??
                (message.images?.map((image) => ({
                  ...image,
                  kind: "image" as const,
                })) ??
                  []);
              const attachmentItems =
                message.attachments ?? [];

              if (
                isTool &&
                !mediaItems.length &&
                !message.content.trim()
              ) {
                return null;
              }

              const {
                thoughtContent,
                displayContent,
              } = parseAssistantContent(message);

              return (
                <motion.div
                  key={message.id}
                  initial={{
                    opacity: 0,
                    y: 20,
                    scale: 0.95,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                  }}
                  transition={{ duration: 0.3 }}
                  className={cn(
                    "group flex gap-2 sm:gap-4",
                    isUser
                      ? "flex-row-reverse"
                      : "flex-row",
                  )}
                >
                  <Avatar
                    className={cn(
                      "h-8 w-8 border sm:h-9 sm:w-9",
                      isUser
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground",
                    )}
                  >
                    <AvatarFallback
                      className={
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-foreground"
                      }
                    >
                      {isUser ? (
                        <User
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      ) : (
                        <Bot
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      )}
                    </AvatarFallback>
                  </Avatar>

                  <div
                    className={cn(
                      "flex w-full max-w-[96%] flex-col gap-2 sm:max-w-[88%]",
                      isUser
                        ? "items-end"
                        : "items-start",
                    )}
                  >
                    <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span>
                        {isUser
                          ? "You"
                          : isTool
                            ? "System helper"
                            : "Agent"}
                      </span>
                      {isUser && message.turnIntent ? (
                        <span className="rounded-full border border-border bg-background px-1.5 py-0.5 normal-case tracking-normal text-foreground">
                          {chatTurnIntentLabel(
                            message.turnIntent,
                          )}
                        </span>
                      ) : null}
                    </div>

                    <div
                      className={cn(
                        "relative w-full rounded-2xl px-3.5 py-2.5 text-sm shadow-sm transition-colors duration-200 sm:px-5 sm:py-3.5",
                        isUser
                          ? "rounded-tr-sm bg-primary text-primary-foreground"
                          : isTool
                            ? "border border-border bg-secondary text-secondary-foreground"
                            : "glass-card rounded-tl-sm text-foreground",
                      )}
                    >
                      {thoughtContent ? (
                        <ThinkingBlock
                          content={thoughtContent}
                        />
                      ) : null}

                      {attachmentItems.length ? (
                        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {attachmentItems.map(
                            (attachment) => (
                              <div
                                key={attachment.id}
                                className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background/80 p-2 text-foreground"
                              >
                                {attachment.kind ===
                                  "image" &&
                                attachment.dataUrl ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenAttachment(
                                        attachment,
                                        displayContent,
                                      )
                                    }
                                    className="group/attachment-image relative h-12 w-12 flex-none overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    aria-label={`Open ${attachment.name} fullscreen preview`}
                                  >
                                    <img
                                      src={
                                        attachment.dataUrl
                                      }
                                      alt=""
                                      className="h-full w-full object-cover"
                                    />
                                    <span className="absolute inset-0 flex items-center justify-center bg-slate-950/65 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/attachment-image:opacity-100">
                                      <Maximize2
                                        className="h-4 w-4 text-white"
                                        aria-hidden="true"
                                      />
                                    </span>
                                  </button>
                                ) : (
                                  <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
                                    <FileText
                                      className="h-5 w-5"
                                      aria-hidden="true"
                                    />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1 text-left">
                                  <div className="truncate text-xs font-semibold">
                                    {attachment.name}
                                  </div>
                                  <div className="truncate text-[11px] text-muted-foreground">
                                    {attachment.kind}
                                    {attachment.pagesRead &&
                                    attachment.totalPages
                                      ? ` · ${attachment.pagesRead}/${attachment.totalPages} pages`
                                      : ""}
                                    {attachment.truncated
                                      ? " · truncated"
                                      : ""}
                                  </div>
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      ) : null}

                      {displayContent ? (
                        isUser ? (
                          <p className="whitespace-pre-wrap break-words leading-relaxed">
                            {displayContent}
                          </p>
                        ) : (
                          <div className="prose prose-sm max-w-none break-words leading-relaxed dark:prose-invert">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                            >
                              {displayContent}
                            </ReactMarkdown>
                          </div>
                        )
                      ) : isAssistant ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Sparkles
                            className="h-3 w-3 animate-pulse text-primary"
                            aria-hidden="true"
                          />
                          {message.toolCalls?.length
                            ? `Invoking ${message.toolCalls
                                .map(
                                  (call) =>
                                    call.function.name,
                                )
                                .filter(Boolean)
                                .join(", ")}…`
                            : "Thinking…"}
                        </div>
                      ) : null}

                      {isAssistant &&
                      message.toolCalls?.length ? (
                        <ToolCallsBlock
                          toolCalls={message.toolCalls}
                        />
                      ) : null}

                      {isTool && message.promptUsed ? (
                        <div className="mt-2 rounded-md border border-border bg-background/80 p-2 text-foreground">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                              Prompt used
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void onCopyPrompt(
                                  message.id,
                                  message.promptUsed ??
                                    "",
                                )
                              }
                              className="min-h-10 px-3 text-xs hover:bg-primary/10 hover:text-primary"
                              disabled={
                                !message.promptUsed?.trim()
                              }
                            >
                              {copiedPromptMessageId ===
                              message.id ? (
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
                          <p className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed">
                            {message.promptUsed}
                          </p>
                        </div>
                      ) : null}

                      {mediaItems.length ? (
                        <div className="mt-3 grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {mediaItems.map((item) => (
                            <motion.div
                              key={item.id}
                              layoutId={item.id}
                              className="group/image relative overflow-hidden rounded-lg border border-border bg-background/80 p-1.5 text-foreground"
                            >
                              {item.kind === "image" ? (
                                <div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onOpenMedia(
                                        item,
                                        message.promptUsed ??
                                          displayContent,
                                      )
                                    }
                                    className="block w-full overflow-hidden rounded-md bg-checkered focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    aria-label="Open generated image preview"
                                  >
                                    <img
                                      src={item.dataUrl}
                                      alt={
                                        message.promptUsed ??
                                        displayContent ??
                                        "Generated image"
                                      }
                                      className="h-auto max-h-96 w-full object-contain"
                                    />
                                  </button>
                                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 pb-0.5">
                                    <div className="min-w-0 flex-1">
                                      {item.model ? (
                                        <span className="inline-block max-w-full truncate rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">
                                          {item.model}
                                        </span>
                                      ) : null}
                                    </div>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="min-h-11 px-3 text-xs hover:bg-primary/10 hover:text-primary"
                                      onClick={() =>
                                        onOpenMedia(
                                          item,
                                          message.promptUsed ??
                                            displayContent,
                                        )
                                      }
                                    >
                                      <Maximize2
                                        className="h-4 w-4"
                                        aria-hidden="true"
                                      />
                                      Preview
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="min-h-11 px-3 text-xs hover:bg-primary/10 hover:text-primary"
                                      onClick={() =>
                                        onDownloadMedia(
                                          item,
                                        )
                                      }
                                    >
                                      <Download
                                        className="h-4 w-4"
                                        aria-hidden="true"
                                      />
                                      Download
                                    </Button>
                                  </div>
                                </div>
                              ) : item.kind === "video" ? (
                                <video
                                  src={item.dataUrl}
                                  controls
                                  className="max-h-64 w-full rounded-md bg-black"
                                />
                              ) : (
                                <audio
                                  src={item.dataUrl}
                                  controls
                                  className="w-full"
                                />
                              )}
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

          {busy ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="flex gap-4"
              role="status"
              aria-label="Agent is working"
            >
              <div className="flex h-8 w-8 items-center justify-center">
                <span className="h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                <span className="mx-1 h-2 w-2 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-primary" />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="h-4" />
      </div>
    </div>
  );
}
