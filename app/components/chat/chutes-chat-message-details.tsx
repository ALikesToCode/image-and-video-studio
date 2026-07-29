"use client";

import { useState } from "react";
import {
  BrainCircuit,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";

import type { ToolCall } from "./chutes-chat-types";

export function ThinkingBlock({
  content,
}: {
  content: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-border/60 bg-background/70 text-xs">
      <button
        type="button"
        onClick={() => setIsExpanded((previous) => !previous)}
        className="flex min-h-10 w-full select-none items-center gap-2 bg-secondary/60 px-3 py-2 font-medium text-foreground transition-colors hover:bg-primary/10 hover:text-primary"
        aria-expanded={isExpanded}
      >
        <BrainCircuit className="h-3.5 w-3.5" />
        <span>Thinking process</span>
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 transition-transform",
            isExpanded && "rotate-90",
          )}
        />
      </button>
      <AnimatePresence>
        {isExpanded ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <div className="whitespace-pre-wrap border-t border-dashed border-border/50 p-3 font-mono leading-relaxed text-muted-foreground">
              {content.trim()}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function ToolCallsBlock({
  toolCalls,
}: {
  toolCalls: ToolCall[];
}) {
  if (!toolCalls.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {toolCalls.map((toolCall) => {
        const rawArgs = toolCall.function.arguments;
        let formattedArgs = rawArgs;
        let promptPreview = "";

        try {
          const parsed = JSON.parse(rawArgs) as Record<
            string,
            unknown
          >;
          formattedArgs = JSON.stringify(parsed, null, 2);
          const promptValue =
            parsed.prompt ?? parsed.input ?? parsed.text;
          promptPreview =
            typeof promptValue === "string" ? promptValue : "";
        } catch {
          // Streamed tool arguments may be incomplete JSON.
        }

        return (
          <div
            key={toolCall.id}
            className="rounded-xl border border-primary/25 bg-primary/8 p-2.5 text-xs"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 font-medium text-primary">
                <Sparkles className="h-3.5 w-3.5 animate-pulse" />
                <span className="truncate">
                  Calling {toolCall.function.name}
                </span>
              </div>
              <span className="rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                streaming
              </span>
            </div>
            {promptPreview ? (
              <div className="mb-2 rounded-lg border border-border/60 bg-background p-2">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  Prompt
                </p>
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap leading-relaxed text-foreground">
                  {promptPreview}
                </p>
              </div>
            ) : null}
            {formattedArgs ? (
              <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {formattedArgs}
              </pre>
            ) : (
              <p className="text-muted-foreground">
                Waiting for tool arguments...
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
