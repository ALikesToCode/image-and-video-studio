export const DEFAULT_CHAT_CONTEXT_MAX_MESSAGES = 32;
export const DEFAULT_CHAT_CONTEXT_MAX_CHARACTERS = 48_000;

type ContextAttachment = {
  text?: string;
};

type ContextMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  toolCalls?: unknown[];
  attachments?: ContextAttachment[];
  transient?: boolean;
};

const estimateMessageCharacters = (message: ContextMessage) => {
  const attachmentCharacters = (message.attachments ?? []).reduce(
    (total, attachment) => total + (attachment.text?.length ?? 0),
    0,
  );
  const toolCharacters = message.toolCalls?.length
    ? JSON.stringify(message.toolCalls).length
    : 0;
  return (
    message.content.length +
    (message.thinking?.length ?? 0) +
    attachmentCharacters +
    toolCharacters
  );
};

const groupMessagesByUserTurn = <T extends ContextMessage>(messages: T[]) => {
  const turns: T[][] = [];
  for (const message of messages) {
    if (message.role === "user") {
      turns.push([message]);
      continue;
    }
    turns.at(-1)?.push(message);
  }
  return turns;
};

export const selectChatContextMessages = <T extends ContextMessage>(
  messages: T[],
  {
    maxMessages = DEFAULT_CHAT_CONTEXT_MAX_MESSAGES,
    maxCharacters = DEFAULT_CHAT_CONTEXT_MAX_CHARACTERS,
  }: {
    maxMessages?: number;
    maxCharacters?: number;
  } = {},
) => {
  const turns = groupMessagesByUserTurn(
    messages.filter((message) => !message.transient),
  );
  if (!turns.length) return [];

  const selectedTurns: T[][] = [];
  let selectedMessages = 0;
  let selectedCharacters = 0;

  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnCharacters = turn.reduce(
      (total, message) => total + estimateMessageCharacters(message),
      0,
    );
    const exceedsBudget =
      selectedTurns.length > 0 &&
      (selectedMessages + turn.length > Math.max(1, maxMessages) ||
        selectedCharacters + turnCharacters > Math.max(1, maxCharacters));
    if (exceedsBudget) break;

    selectedTurns.unshift(turn);
    selectedMessages += turn.length;
    selectedCharacters += turnCharacters;
  }

  return selectedTurns.flat();
};
