export const runtime = "edge";

import { handleAIStudioChatRequest } from "@/lib/server/ai-sdk-chat-route";

export const POST = handleAIStudioChatRequest;
