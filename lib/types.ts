import { Mode, Provider } from "./constants";

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
