import {
  ArrowUpRight,
  AudioLines,
  Image as ImageIcon,
  MessageCircle,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/app/components/ui/button";
import type { ChatTurnIntent } from "@/lib/chat-tooling";

type CreatorWelcomeProps = {
  availability: {
    image: boolean;
    video: boolean;
    audio: boolean;
  };
  onSelectIntent: (intent: ChatTurnIntent) => void;
};

type Starter = {
  intent: ChatTurnIntent;
  label: string;
  icon: LucideIcon;
  availability?: keyof CreatorWelcomeProps["availability"];
};

const STARTERS: Starter[] = [
  {
    intent: "generate_image",
    label: "Create an image",
    icon: ImageIcon,
    availability: "image",
  },
  {
    intent: "generate_video",
    label: "Make a video",
    icon: Video,
    availability: "video",
  },
  {
    intent: "generate_audio",
    label: "Generate audio",
    icon: AudioLines,
    availability: "audio",
  },
  {
    intent: "chat",
    label: "Develop an idea",
    icon: MessageCircle,
  },
];

export function CreatorWelcome({
  availability,
  onSelectIntent,
}: CreatorWelcomeProps) {
  return (
    <section className="mx-auto flex min-h-[22rem] w-full max-w-5xl items-center py-6 text-left sm:min-h-[31rem] sm:py-12">
      <div className="w-full">
        <div
          className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-secondary text-primary shadow-sm"
          aria-hidden="true"
        >
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="mb-3 text-sm font-medium text-primary">One request. Any medium.</p>
        <h1 className="min-w-0 max-w-3xl text-[clamp(2.35rem,8vw,4.75rem)] leading-[0.98] tracking-[-0.035em] text-foreground [overflow-wrap:anywhere]">
          What should we make?
        </h1>
        <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-muted-foreground sm:text-lg">
          Describe the outcome. Your agent can think it through, write it,
          create an image, render a video, or make audio.
        </p>

        <div className="mt-9 grid border-t border-border sm:grid-cols-2 sm:gap-x-8">
          {STARTERS.map((starter) => {
            const Icon = starter.icon;
            const enabled =
              !starter.availability || availability[starter.availability];

            return (
              <Button
                key={starter.intent}
                type="button"
                variant="ghost"
                onClick={() => onSelectIntent(starter.intent)}
                disabled={!enabled}
                className="group h-16 justify-start rounded-none border-b border-border px-2 py-4 text-left text-foreground hover:bg-primary/10 hover:text-primary"
                title={
                  enabled
                    ? starter.label
                    : `${starter.label} is unavailable with the current setup`
                }
              >
                <span className="mr-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground transition-colors duration-150 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground transition-colors group-hover:text-primary">
                  {starter.label}
                </span>
                <ArrowUpRight
                  className="ml-3 h-4 w-4 shrink-0 text-muted-foreground transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
                  aria-hidden="true"
                />
              </Button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
