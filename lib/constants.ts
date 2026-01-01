export type Provider = "gemini" | "navy" | "chutes" | "openrouter";
export type Mode = "image" | "video" | "tts";
export type ModelOption = {
    id: string;
    label: string;
};

export const GEMINI_IMAGE_MODELS: ModelOption[] = [
    {
        id: "gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image",
    },
    {
        id: "gemini-3-pro-image-preview",
        label: "Gemini 3 Pro Image (Preview)",
    },
    {
        id: "imagen-4.0-generate-001",
        label: "Imagen 4",
    },
    {
        id: "imagen-4.0-fast-generate-001",
        label: "Imagen 4 Fast",
    },
];

export const GEMINI_VIDEO_MODELS: ModelOption[] = [
    {
        id: "veo-3.1-generate-preview",
        label: "Veo 3.1 Preview",
    },
    {
        id: "veo-3.1-fast-generate-preview",
        label: "Veo 3.1 Fast Preview",
    },
];

export const NAVY_IMAGE_MODELS: ModelOption[] = [
    {
        id: "flux.1-schnell",
        label: "Flux 1 Schnell",
    },
    {
        id: "dall-e-3",
        label: "DALL-E 3",
    },
];

export const NAVY_VIDEO_MODELS: ModelOption[] = [
    {
        id: "veo-3.1",
        label: "Veo 3.1",
    },
    {
        id: "cogvideox-flash",
        label: "CogVideoX Flash",
    },
];

export const CHUTES_IMAGE_MODELS: ModelOption[] = [
    {
        id: "z-image-turbo",
        label: "Chutes Z Image Turbo",
    },
];

export const OPENROUTER_IMAGE_MODELS: ModelOption[] = [
    {
        id: "google/gemini-2.5-flash-image-preview",
        label: "Gemini 2.5 Flash Image Preview",
    },
    {
        id: "black-forest-labs/flux.2-pro",
        label: "Flux 2 Pro",
    },
    {
        id: "black-forest-labs/flux.2-flex",
        label: "Flux 2 Flex",
    },
    {
        id: "sourceful/riverflow-v2-standard-preview",
        label: "Riverflow V2 Standard Preview",
    },
];

export const NAVY_TTS_MODELS: ModelOption[] = [
    {
        id: "tts-1",
        label: "TTS 1",
    },
    {
        id: "tts-1-hd",
        label: "TTS 1 HD",
    },
];

export const IMAGE_ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
export const IMAGE_SIZES = ["1K", "2K", "4K"];
export const IMAGEN_SIZES = ["1K", "2K"];
export const VIDEO_ASPECTS = ["16:9", "9:16"];
export const VIDEO_RESOLUTIONS = ["720p", "1080p"];
export const VIDEO_DURATIONS = ["4", "6", "8"];
export const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
export const TTS_FORMATS = ["mp3", "opus", "aac", "flac"];

export const DEFAULT_MODELS: Record<Provider, Record<Mode, string>> = {
    gemini: {
        image: GEMINI_IMAGE_MODELS[0].id,
        video: GEMINI_VIDEO_MODELS[0].id,
        tts: GEMINI_IMAGE_MODELS[0].id,
    },
    navy: {
        image: NAVY_IMAGE_MODELS[0].id,
        video: NAVY_VIDEO_MODELS[0].id,
        tts: NAVY_TTS_MODELS[0].id,
    },
    chutes: {
        image: CHUTES_IMAGE_MODELS[0].id,
        video: CHUTES_IMAGE_MODELS[0].id,
        tts: CHUTES_IMAGE_MODELS[0].id,
    },
    openrouter: {
        image: OPENROUTER_IMAGE_MODELS[0].id,
        video: OPENROUTER_IMAGE_MODELS[0].id,
        tts: OPENROUTER_IMAGE_MODELS[0].id,
    },
};
