import { Provider } from "./constants";

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
    status: "queued" | "running" | "success" | "error";
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
