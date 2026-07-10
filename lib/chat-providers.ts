import type { ChatProvider } from "./constants.ts";

export const CHAT_PROVIDER_OPTIONS: ReadonlyArray<{
  id: ChatProvider;
  label: string;
  heading: string;
}> = [
  { id: "chutes", label: "Chutes", heading: "Chutes Agent" },
  { id: "navy", label: "NavyAI", heading: "NavyAI Chat" },
  { id: "nanogpt", label: "NanoGPT", heading: "NanoGPT Chat" },
];

const CHAT_PROVIDER_IDS = new Set<ChatProvider>(
  CHAT_PROVIDER_OPTIONS.map((option) => option.id),
);

export const isChatProvider = (value: unknown): value is ChatProvider =>
  typeof value === "string" && CHAT_PROVIDER_IDS.has(value as ChatProvider);

export const chatProviderDisplayName = (provider: ChatProvider) =>
  CHAT_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label ??
  provider;

export const chatProviderHeading = (provider: ChatProvider) =>
  CHAT_PROVIDER_OPTIONS.find((option) => option.id === provider)?.heading ??
  chatProviderDisplayName(provider);
