/* eslint-disable @next/next/no-img-element */
"use client";

import type {
  Dispatch,
  KeyboardEvent,
  RefObject,
  SetStateAction,
} from "react";
import {
  AudioLines,
  Bot,
  FileText,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Send,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react";
import {
  AnimatePresence,
  motion,
} from "framer-motion";

import type { ModelOption } from "@/lib/constants";
import type {
  ChatAttachmentAsset,
  ChatTurnIntent,
} from "@/lib/chat-tooling";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  MAX_PENDING_ATTACHMENTS,
  chatTurnIntentCompactLabel,
  chatTurnIntentLabel,
  isChatTurnIntent,
  type QueuedChatTurn,
} from "./chutes-chat-types";
import { summarizeModalities } from "./chutes-chat-runtime";

type ToolAvailability = {
  image: boolean;
  video: boolean;
  audio: boolean;
};

type ChutesChatComposerProps = {
  messageCount: number;
  onClearChat: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  attachmentAccept: string;
  pendingAttachments: ChatAttachmentAsset[];
  attachmentLoading: boolean;
  attachmentUploadDisabled: boolean;
  onAddAttachmentFiles: (files: FileList) => void;
  onRemoveAttachment: (id: string) => void;
  currentTurnDecision: {
    intent: ChatTurnIntent;
    reason: string;
  };
  turnIntent: ChatTurnIntent;
  setTurnIntent: Dispatch<SetStateAction<ChatTurnIntent>>;
  toolAvailability: ToolAvailability;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  onKeyDown: (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => void;
  busy: boolean;
  hasApiAccess: boolean;
  onStop: () => void;
  onSubmit: () => void;
  selectedChatModel?: ModelOption;
  chatModelToolCapability?: boolean | null;
  queuedTurns: QueuedChatTurn[];
  chatError: string | null;
  attachmentError: string | null;
};

const IntentIcon = ({
  intent,
}: {
  intent: ChatTurnIntent;
}) => {
  if (intent === "generate_image") {
    return (
      <ImageIcon
        className="h-4 w-4"
        aria-hidden="true"
      />
    );
  }
  if (intent === "generate_video") {
    return (
      <Video
        className="h-4 w-4"
        aria-hidden="true"
      />
    );
  }
  if (intent === "generate_audio") {
    return (
      <AudioLines
        className="h-4 w-4"
        aria-hidden="true"
      />
    );
  }
  return (
    <Bot
      className="h-4 w-4"
      aria-hidden="true"
    />
  );
};

export function ChutesChatComposer({
  messageCount,
  onClearChat,
  fileInputRef,
  composerRef,
  attachmentAccept,
  pendingAttachments,
  attachmentLoading,
  attachmentUploadDisabled,
  onAddAttachmentFiles,
  onRemoveAttachment,
  currentTurnDecision,
  turnIntent,
  setTurnIntent,
  toolAvailability,
  input,
  setInput,
  onKeyDown,
  busy,
  hasApiAccess,
  onStop,
  onSubmit,
  selectedChatModel,
  chatModelToolCapability,
  queuedTurns,
  chatError,
  attachmentError,
}: ChutesChatComposerProps) {
  return (
    <footer className="mt-auto flex-none border-t border-border bg-background p-2.5 sm:p-4">
      <div className="relative mx-auto w-full max-w-7xl">
        <AnimatePresence>
          {messageCount > 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute -top-10 right-0 sm:-top-12"
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearChat}
                className="min-h-10 gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2
                  className="h-4 w-4"
                  aria-hidden="true"
                />
                Clear chat
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={attachmentAccept}
          className="hidden"
          onChange={(event) => {
            if (event.target.files) {
              onAddAttachmentFiles(event.target.files);
            }
            event.currentTarget.value = "";
          }}
        />

        {pendingAttachments.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <div
                key={attachment.id}
                className="flex max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground"
              >
                {attachment.kind === "image" &&
                attachment.dataUrl ? (
                  <img
                    src={attachment.dataUrl}
                    alt=""
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <FileText
                    className="h-4 w-4 text-primary"
                    aria-hidden="true"
                  />
                )}
                <span className="max-w-[14rem] truncate">
                  {attachment.name}
                  {attachment.truncated
                    ? " (truncated)"
                    : ""}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onRemoveAttachment(attachment.id)
                  }
                  className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${attachment.name}`}
                >
                  <X
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-border bg-secondary p-2 shadow-sm sm:p-2.5">
          <div className="flex min-w-0 items-start gap-2">
            <div className="mt-0.5 rounded-lg bg-primary/10 p-1.5 text-primary">
              <IntentIcon
                intent={currentTurnDecision.intent}
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                <span className="sm:hidden">
                  Next ·{" "}
                  {chatTurnIntentCompactLabel(
                    currentTurnDecision.intent,
                  )}
                </span>
                <span className="hidden sm:inline">
                  Next action ·{" "}
                  {chatTurnIntentLabel(
                    currentTurnDecision.intent,
                  )}
                </span>
              </p>
              <p
                aria-live="polite"
                className="mt-0.5 hidden text-[11px] leading-relaxed text-muted-foreground sm:block"
              >
                {currentTurnDecision.reason}
              </p>
            </div>
          </div>
          <Select
            value={turnIntent}
            onValueChange={(value) => {
              if (isChatTurnIntent(value)) {
                setTurnIntent(value);
              }
            }}
          >
            <SelectTrigger
              aria-label="Choose action for this chat turn"
              className="h-11 w-[168px] shrink-0 bg-background text-foreground sm:w-[190px]"
            >
              <span>
                <span className="sm:hidden">
                  {chatTurnIntentCompactLabel(
                    turnIntent,
                  )}
                </span>
                <span className="hidden sm:inline">
                  {chatTurnIntentLabel(turnIntent)}
                </span>
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                Auto · Agent decides
              </SelectItem>
              <SelectItem value="chat">
                Chat only
              </SelectItem>
              <SelectItem
                value="generate_image"
                disabled={!toolAvailability.image}
              >
                Create image
              </SelectItem>
              <SelectItem
                value="generate_video"
                disabled={!toolAvailability.video}
              >
                Create video
              </SelectItem>
              <SelectItem
                value="generate_audio"
                disabled={!toolAvailability.audio}
              >
                Create audio
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card p-1.5 shadow-[var(--shadow-raised)]">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={
              attachmentUploadDisabled ||
              attachmentLoading ||
              pendingAttachments.length >=
                MAX_PENDING_ATTACHMENTS
            }
            title={
              attachmentUploadDisabled
                ? "Selected model does not advertise image or file input"
                : "Attach image, PDF, or text file"
            }
            aria-label="Attach file"
            className="mb-0.5 h-11 w-11 rounded-full hover:bg-primary/10 hover:text-primary"
          >
            {attachmentLoading ? (
              <Loader2
                className="h-5 w-5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Paperclip
                className="h-5 w-5"
                aria-hidden="true"
              />
            )}
          </Button>
          <Textarea
            ref={composerRef}
            value={input}
            onChange={(event) =>
              setInput(event.target.value)
            }
            onKeyDown={onKeyDown}
            placeholder={
              busy
                ? "Queue another request…"
                : pendingAttachments.length
                  ? "Ask about the files…"
                  : "Describe what you want to create…"
            }
            aria-label="Message the creator agent"
            className="max-h-[140px] min-h-11 flex-1 resize-none border-0 bg-transparent px-3 py-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-0 sm:max-h-[200px] sm:px-4"
            rows={1}
          />
          {busy ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onStop}
              title="Stop current request"
              aria-label="Stop current request"
              className="mb-0.5 h-11 w-11 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Square
                className="h-4 w-4 fill-current"
                aria-hidden="true"
              />
            </Button>
          ) : null}
          <Button
            size="icon"
            onClick={onSubmit}
            disabled={
              (!input.trim() &&
                !pendingAttachments.length) ||
              !hasApiAccess
            }
            title={
              busy ? "Queue request" : "Send request"
            }
            aria-label={
              busy ? "Queue request" : "Send request"
            }
            className={cn(
              "mb-0.5 h-11 w-11 rounded-full shadow transition-colors",
              input.trim() ||
                pendingAttachments.length
                ? "bg-primary text-primary-foreground hover:bg-primary/85 hover:text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            {busy && !input.trim() ? (
              <Loader2
                className="h-5 w-5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Send
                className="h-5 w-5"
                aria-hidden="true"
              />
            )}
          </Button>
        </div>

        <div className="mt-2 hidden flex-wrap items-center gap-2 text-[11px] text-muted-foreground sm:flex">
          <span className="rounded-full border border-border bg-background px-2 py-1">
            Input:{" "}
            {summarizeModalities(
              selectedChatModel?.inputModalities,
            )}
          </span>
          <span className="rounded-full border border-border bg-background px-2 py-1">
            Output:{" "}
            {summarizeModalities(
              selectedChatModel?.outputModalities,
            )}
          </span>
          {attachmentUploadDisabled ? (
            <span className="rounded-full border border-border bg-background px-2 py-1">
              Uploads unavailable for this model
            </span>
          ) : null}
          {chatModelToolCapability === false ? (
            <span className="rounded-full border border-amber-600/50 bg-amber-100 px-2 py-1 text-amber-950 dark:border-amber-400/50 dark:bg-amber-950 dark:text-amber-100">
              Tool calling is unavailable; explicit
              generation uses the local fallback
            </span>
          ) : null}
        </div>

        {busy || queuedTurns.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1">
              <Loader2
                className={cn(
                  "h-3 w-3 text-primary",
                  busy && "animate-spin",
                )}
                aria-hidden="true"
              />
              {busy ? "Running" : "Idle"}
            </span>
            <span className="inline-flex rounded-full border border-border bg-background px-2 py-1">
              {queuedTurns.length} queued
            </span>
            {queuedTurns
              .slice(0, 2)
              .map((turn, index) => (
                <span
                  key={turn.id}
                  className="max-w-[22rem] truncate rounded-full border border-border bg-background px-2 py-1"
                  title={turn.content}
                >
                  #{index + 1} ·{" "}
                  {chatTurnIntentLabel(
                    turn.turnIntent,
                  )}{" "}
                  · {turn.content}
                </span>
              ))}
          </div>
        ) : null}

        {chatError ? (
          <p
            role="alert"
            className="mt-2 text-xs font-medium text-destructive"
          >
            {chatError}
          </p>
        ) : null}
        {attachmentError ? (
          <p
            role="alert"
            className="mt-2 text-xs font-medium text-destructive"
          >
            {attachmentError}
          </p>
        ) : null}
      </div>
    </footer>
  );
}
