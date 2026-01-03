import { Provider } from "./constants";

export type StoredImage = {
    id: string;
    dataUrl: string;
    prompt: string;
    model: string;
    provider: Provider;
    createdAt: string;
};

export type GeneratedImage = {
    id: string;
    dataUrl: string;
    mimeType: string;
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
