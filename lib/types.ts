import { Provider } from "./constants";

export type GenerationBilling = {
    cost?: number;
    paymentSource?: string;
    remainingBalance?: number;
};

export type StoredMedia = {
    id: string;
    dataUrl: string;
    prompt: string;
    model: string;
    provider: Provider;
    createdAt: string;
    kind: "image" | "video" | "audio";
    mimeType?: string;
};

export type StoredImage = StoredMedia;

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    mimeType: string;
    model?: string;
    provider?: Provider;
    prompt?: string;
    batchId?: string;
    batchCreatedAt?: string;
    batchOrder?: number;
    imageOrder?: number;
    createdAt?: string;
};

export type ReferenceRole =
    | "general"
    | "character"
    | "object"
    | "style"
    | "first_frame"
    | "last_frame"
    | "source_image";

export type StoredReference = {
    id: string;
    role: ReferenceRole;
    label?: string;
    dataUrl: string;
    blobKey: string;
    mimeType: string;
    createdAt: string;
    size?: number;
};

export type PersistedGenerationJob = {
    id: string;
    status: "queued" | "running" | "success" | "error" | "cancelled";
    mode: "image" | "video" | "tts";
    provider: Provider;
    model: string;
    prompt: string;
    createdAt: string;
    batchId?: string;
    batchCreatedAt?: string;
    batchOrder?: number;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    progress?: string;
    remoteJobId?: string;
    remoteOperationName?: string;
    remoteStatus?: string;
    billing?: GenerationBilling;
    requestId?: string;
    saveToGallery?: boolean;
};

export type NavyUsageResponse = {
    plan: string;
    limits: {
        tokens_per_day: number;
        rpm: number;
    };
    usage: {
        tokens_used_today: number;
        tokens_remaining_today: number;
        percent_used: number;
        resets_at_utc: string;
        resets_in_ms: number;
    };
    rate_limits: {
        per_minute: {
            limit: number;
            used: number;
            remaining: number;
            resets_in_ms: number;
        };
    };
    server_time_utc: string;
};

export type NavyModelHealth = {
    id: string;
    endpoint: string | null;
    status: string | null;
    lastChecked: string | null;
    inProgress: boolean | null;
    uptimePercent: number | null;
    checksCount: number | null;
    okCount: number | null;
    avgTtft: number | null;
    avgTotal: number | null;
    error?: string;
};

export type NavyModelHealthSelection = {
    lastUpdated: string | null;
    model: NavyModelHealth;
};

export type NanoGptUsageCounters = {
    requests: number;
    costUsd: number;
    refundedUsd: number;
    netCostUsd: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
};

export type NanoGptAccountResponse = {
    balance: {
        usdBalance: string;
        nanoBalance: string;
        depositAddress: string;
    };
    usage: {
        from: string;
        to: string;
        timezone: "UTC";
        groupBy: "day" | "model" | "day,model";
        asOf: string;
        totals: NanoGptUsageCounters;
        byDay?: Array<NanoGptUsageCounters & { date: string }>;
        byModel?: Array<NanoGptUsageCounters & { model: string }>;
        byDayModel?: Array<
            NanoGptUsageCounters & { date: string; model: string }
        >;
    };
    subscription: {
        active: boolean;
        state: "active" | "grace" | "inactive";
        enforceDailyLimit: boolean;
        limits: {
            daily: number;
            monthly: number;
        };
        daily: {
            used: number;
            remaining: number;
            percentUsed: number;
            resetAt: number;
        };
        monthly: {
            used: number;
            remaining: number;
            percentUsed: number;
            resetAt: number;
        };
        currentPeriodEnd: string | null;
        graceUntil: string | null;
    } | null;
    warnings?: Array<{
        section: "subscription";
        status: number;
        error: string;
        code?: string;
    }>;
};
