export type Provider = "gemini" | "navy" | "chutes" | "openrouter" | "nanogpt";
export type Mode = "image" | "video" | "tts";
export type ChatProvider = "chutes" | "navy" | "nanogpt";
export type ModelEndpoint =
    | "gemini-generate-content"
    | "imagen-predict"
    | "veo-predict-long-running"
    | "openrouter-chat-completions"
    | "navy-chat-completions"
    | "navy-images-generations"
    | "navy-audio-speech"
    | "nanogpt-images-generations"
    | "nanogpt-video-generation"
    | "chutes-image"
    | "chutes-video"
    | "chutes-audio"
    | string;

export type ModelParameterValue = string | number | boolean | null;

export type ModelParameterType =
    | "select"
    | "switch"
    | "boolean"
    | "number"
    | "text"
    | "string";

export type ModelParameterOption = {
    value: Exclude<ModelParameterValue, null>;
    label: string;
};

export type ModelParameterDescriptor = {
    type: ModelParameterType;
    label?: string;
    description?: string;
    placeholder?: string;
    default?: ModelParameterValue;
    options?: ModelParameterOption[];
    min?: number;
    max?: number;
    step?: number;
    showWhen?: Record<string, ModelParameterValue>;
};

export type ModelMediaConstraint = {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxBytes?: number;
    formats?: string[];
    source?: string;
    note?: string;
};

export type ModelInputImageConstraints = {
    maxItems?: number;
    route?: ModelMediaConstraint;
    provider?: ModelMediaConstraint;
};

export type ModelSubscription = {
    included?: boolean;
    inputTokenMultiplier?: number;
    note?: string;
};

export type ModelOption = {
    id: string;
    label: string;
    provider?: Provider | string;
    endpoint?: ModelEndpoint;
    inputModalities?: string[] | null;
    outputModalities?: string[] | null;
    premium?: boolean;
    requiredPlan?: string | null;
    tokenMultiplier?: number;
    contextWindow?: number | null;
    maxOutputTokens?: number | null;
    modality?: string | null;
    tokenizer?: string | null;
    category?: string | null;
    description?: string | null;
    metadataSource?: string | null;
    metadataStatus?: string;
    supportsVision?: boolean | null;
    supportsTools?: boolean | null;
    supportsFunctionCalling?: boolean | null;
    supportsReasoning?: boolean | null;
    supportsJsonMode?: boolean | null;
    supportsAudioInput?: boolean | null;
    supportsVideoInput?: boolean | null;
    supportsImageOutput?: boolean | null;
    supportsStreaming?: boolean | null;
    pricing?: unknown;
    costEstimate?: unknown;
    providers?: string[];
    subscription?: ModelSubscription;
    supports?: Partial<{
        imageGeneration: boolean;
        imageEdit: boolean;
        referenceImages: boolean;
        tts: boolean;
        video: boolean;
        textToVideo: boolean;
        imageToVideo: boolean;
        asyncJobs: boolean;
        negativePrompt: boolean;
        seed: boolean;
        size: boolean;
        aspectRatio: boolean;
        imageSize: boolean;
        sourceImage: boolean;
        firstFrame: boolean;
        lastFrame: boolean;
    }>;
    maxReferenceImages?: number;
    supportedResolutions?: string[];
    maxOutputImages?: number;
    fixedOutputImages?: number;
    inputImageConstraints?: ModelInputImageConstraints;
    dynamicParameters?: Record<string, ModelParameterDescriptor>;
    parameterDefaults?: Record<string, ModelParameterValue>;
};

export const GEMINI_IMAGE_MODELS: ModelOption[] = [
    {
        id: "gemini-3.1-flash-image-preview",
        label: "Gemini 3.1 Flash Image Preview",
        provider: "gemini",
        endpoint: "gemini-generate-content",
        inputModalities: ["text", "image"],
        outputModalities: ["text", "image"],
        supports: {
            imageGeneration: true,
            imageEdit: true,
            referenceImages: true,
            aspectRatio: true,
            imageSize: true,
        },
    },
    {
        id: "gemini-3-pro-image-preview",
        label: "Gemini 3 Pro Image (Preview)",
        provider: "gemini",
        endpoint: "gemini-generate-content",
        inputModalities: ["text", "image"],
        outputModalities: ["text", "image"],
        supports: {
            imageGeneration: true,
            imageEdit: true,
            referenceImages: true,
            aspectRatio: true,
            imageSize: true,
        },
    },
    {
        id: "gemini-2.5-flash-image",
        label: "Gemini 2.5 Flash Image",
        provider: "gemini",
        endpoint: "gemini-generate-content",
        inputModalities: ["text", "image"],
        outputModalities: ["text", "image"],
        supports: {
            imageGeneration: true,
            imageEdit: true,
            referenceImages: true,
            aspectRatio: true,
        },
    },
    {
        id: "imagen-4.0-generate-001",
        label: "Imagen 4",
        provider: "gemini",
        endpoint: "imagen-predict",
        inputModalities: ["text"],
        outputModalities: ["image"],
        supports: {
            imageGeneration: true,
            aspectRatio: true,
            imageSize: true,
        },
    },
    {
        id: "imagen-4.0-fast-generate-001",
        label: "Imagen 4 Fast",
        provider: "gemini",
        endpoint: "imagen-predict",
        inputModalities: ["text"],
        outputModalities: ["image"],
        supports: {
            imageGeneration: true,
            aspectRatio: true,
            imageSize: true,
        },
    },
];

export const GEMINI_VIDEO_MODELS: ModelOption[] = [
    {
        id: "veo-3.1-generate-preview",
        label: "Veo 3.1 Preview",
        provider: "gemini",
        endpoint: "veo-predict-long-running",
        inputModalities: ["text", "image"],
        outputModalities: ["video", "audio"],
        supports: {
            video: true,
            asyncJobs: true,
            sourceImage: true,
            referenceImages: true,
            firstFrame: true,
            lastFrame: true,
            negativePrompt: true,
            aspectRatio: true,
        },
    },
    {
        id: "veo-3.1-fast-generate-preview",
        label: "Veo 3.1 Fast Preview",
        provider: "gemini",
        endpoint: "veo-predict-long-running",
        inputModalities: ["text", "image"],
        outputModalities: ["video", "audio"],
        supports: {
            video: true,
            asyncJobs: true,
            sourceImage: true,
            referenceImages: true,
            firstFrame: true,
            lastFrame: true,
            negativePrompt: true,
            aspectRatio: true,
        },
    },
];

export const NAVY_IMAGE_MODELS: ModelOption[] = [
    {
        id: "flux",
        label: "Flux",
    },
    {
        id: "gpt-image-2",
        label: "GPT Image 2",
        premium: true,
    },
    {
        id: "gpt-image-1.5",
        label: "GPT Image 1.5",
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

export const NAVY_CHAT_MODELS: ModelOption[] = [
    {
        id: "gpt-4o",
        label: "GPT-4o",
    },
    {
        id: "glm-5.1-venice",
        label: "GLM 5.1 Venice",
    },
    {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
    },
    {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
    },
    {
        id: "gpt-5",
        label: "GPT-5",
    },
    {
        id: "gpt-5.5",
        label: "GPT-5.5",
        premium: true,
        tokenMultiplier: 12,
        contextWindow: 1050000,
        maxOutputTokens: 128000,
        inputModalities: ["text", "image", "file"],
        outputModalities: ["text"],
        supportsVision: true,
        supportsTools: true,
        supportsFunctionCalling: true,
        supportsReasoning: true,
        supportsJsonMode: true,
        supportsAudioInput: false,
        supportsImageOutput: false,
        supportsStreaming: true,
        description: "High-cost frontier model. Avoid for enterprise workloads unless explicitly selected.",
    },
    {
        id: "grok-4.3",
        label: "Grok 4.3",
        tokenMultiplier: 3,
        outputModalities: ["text"],
    },
    {
        id: "o4-mini",
        label: "O4 Mini",
    },
    {
        id: "claude-sonnet-4.5",
        label: "Claude Sonnet 4.5",
    },
];

export const NANOGPT_LLM_MODELS: ModelOption[] = [
    {
        id: "minimax/minimax-m2.7",
        label: "MiniMax M2.7",
        provider: "nanogpt",
        endpoint: "nanogpt-chat-completions",
        inputModalities: ["text"],
        outputModalities: ["text"],
        metadataSource: "nanogpt-docs-fallback",
        metadataStatus: "fallback",
    },
];

export const CHUTES_IMAGE_MODELS: ModelOption[] = [
    {
        id: "z-image-turbo",
        label: "Chutes Z Image Turbo",
    },
    {
        id: "chutes-hidream",
        label: "Chutes HiDream",
    },
    {
        id: "chroma",
        label: "Chroma",
    },
    {
        id: "JuggernautXL-Ragnarok",
        label: "JuggernautXL Ragnarok",
    },
    {
        id: "Qwen-Image-2512",
        label: "Qwen Image 2512",
    },
];

export const NANOGPT_IMAGE_MODELS: ModelOption[] = [
    {
        id: "hidream",
        label: "NanoGPT HiDream",
        provider: "nanogpt",
        endpoint: "nanogpt-images-generations",
        inputModalities: ["text"],
        outputModalities: ["image"],
        supports: {
            imageGeneration: true,
            size: true,
            seed: true,
        },
    },
    {
        id: "chroma",
        label: "NanoGPT Chroma",
        provider: "nanogpt",
        endpoint: "nanogpt-images-generations",
        inputModalities: ["text"],
        outputModalities: ["image"],
        supports: {
            imageGeneration: true,
            size: true,
            seed: true,
        },
    },
    {
        id: "z-image-turbo",
        label: "NanoGPT Z Image Turbo",
        provider: "nanogpt",
        endpoint: "nanogpt-images-generations",
        inputModalities: ["text"],
        outputModalities: ["image"],
        supports: {
            imageGeneration: true,
            size: true,
            seed: true,
        },
    },
    {
        id: "qwen-image",
        label: "NanoGPT Qwen Image",
        provider: "nanogpt",
        endpoint: "nanogpt-images-generations",
        inputModalities: ["text", "image"],
        outputModalities: ["image"],
        supports: {
            imageGeneration: true,
            imageEdit: true,
            referenceImages: true,
            size: true,
            seed: true,
        },
        maxReferenceImages: 3,
    },
    {
        id: "step-image-edit-2",
        label: "NanoGPT Step Image Edit 2",
        provider: "nanogpt",
        endpoint: "nanogpt-images-generations",
        inputModalities: ["text", "image"],
        outputModalities: ["image"],
        supports: {
            imageGeneration: true,
            imageEdit: true,
            referenceImages: true,
            size: true,
            seed: true,
        },
        maxReferenceImages: 1,
    },
];

export const NANOGPT_VIDEO_MODELS: ModelOption[] = [
    {
        id: "veo3-1-fast-video",
        label: "NanoGPT Veo 3.1 Fast",
        provider: "nanogpt",
        endpoint: "nanogpt-video-generation",
        inputModalities: ["text", "image"],
        outputModalities: ["video"],
        supports: {
            video: true,
            asyncJobs: true,
            sourceImage: true,
            aspectRatio: true,
            size: true,
        },
        maxReferenceImages: 1,
        supportedResolutions: ["720p", "1080p"],
        metadataSource: "nanogpt-catalog-fallback",
        metadataStatus: "fallback",
    },
];

export const CHUTES_VIDEO_MODELS: ModelOption[] = [
    {
        id: "wan-2-2-i2v-14b-fast",
        label: "WAN 2.2 I2V 14B Fast",
    },
];

export const CHUTES_LLM_MODELS: ModelOption[] = [
    {
        id: "Qwen/Qwen3-32B",
        label: "Qwen/Qwen3-32B",
    },
    {
        id: "tngtech/DeepSeek-TNG-R1T2-Chimera",
        label: "tngtech/DeepSeek-TNG-R1T2-Chimera",
    },
    {
        id: "deepseek-ai/DeepSeek-V3-0324-TEE",
        label: "deepseek-ai/DeepSeek-V3-0324-TEE",
    },
    {
        id: "chutesai/Mistral-Small-3.1-24B-Instruct-2503",
        label: "chutesai/Mistral-Small-3.1-24B-Instruct-2503",
    },
    {
        id: "deepseek-ai/DeepSeek-V3.2-TEE",
        label: "deepseek-ai/DeepSeek-V3.2-TEE",
    },
    {
        id: "Qwen/Qwen3-235B-A22B-Instruct-2507-TEE",
        label: "Qwen/Qwen3-235B-A22B-Instruct-2507-TEE",
    },
    {
        id: "tngtech/DeepSeek-R1T-Chimera",
        label: "tngtech/DeepSeek-R1T-Chimera",
    },
    {
        id: "unsloth/gemma-3-4b-it",
        label: "unsloth/gemma-3-4b-it",
    },
    {
        id: "openai/gpt-oss-120b-TEE",
        label: "openai/gpt-oss-120b-TEE",
    },
    {
        id: "deepseek-ai/DeepSeek-V3",
        label: "deepseek-ai/DeepSeek-V3",
    },
    {
        id: "Qwen/Qwen3-14B",
        label: "Qwen/Qwen3-14B",
    },
    {
        id: "NousResearch/Hermes-4-70B",
        label: "NousResearch/Hermes-4-70B",
    },
    {
        id: "zai-org/GLM-4.7-TEE",
        label: "zai-org/GLM-4.7-TEE",
    },
    {
        id: "unsloth/Mistral-Nemo-Instruct-2407",
        label: "unsloth/Mistral-Nemo-Instruct-2407",
    },
    {
        id: "openai/gpt-oss-20b",
        label: "openai/gpt-oss-20b",
    },
    {
        id: "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8-TEE",
        label: "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8-TEE",
    },
    {
        id: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
        label: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
    },
    {
        id: "NousResearch/DeepHermes-3-Mistral-24B-Preview",
        label: "NousResearch/DeepHermes-3-Mistral-24B-Preview",
    },
    {
        id: "NousResearch/Hermes-4-405B-FP8-TEE",
        label: "NousResearch/Hermes-4-405B-FP8-TEE",
    },
    {
        id: "zai-org/GLM-4.6-TEE",
        label: "zai-org/GLM-4.6-TEE",
    },
    {
        id: "moonshotai/Kimi-K2-Instruct-0905",
        label: "moonshotai/Kimi-K2-Instruct-0905",
    },
    {
        id: "unsloth/Mistral-Small-24B-Instruct-2501",
        label: "unsloth/Mistral-Small-24B-Instruct-2501",
    },
    {
        id: "Qwen/Qwen3-30B-A3B-Instruct-2507",
        label: "Qwen/Qwen3-30B-A3B-Instruct-2507",
    },
    {
        id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        label: "Qwen/Qwen2.5-Coder-32B-Instruct",
    },
    {
        id: "unsloth/gemma-3-27b-it",
        label: "unsloth/gemma-3-27b-it",
    },
    {
        id: "deepseek-ai/DeepSeek-R1-0528-TEE",
        label: "deepseek-ai/DeepSeek-R1-0528-TEE",
    },
    {
        id: "deepseek-ai/DeepSeek-V3.1-TEE",
        label: "deepseek-ai/DeepSeek-V3.1-TEE",
    },
    {
        id: "deepseek-ai/DeepSeek-V3.1-Terminus-TEE",
        label: "deepseek-ai/DeepSeek-V3.1-Terminus-TEE",
    },
    {
        id: "OpenGVLab/InternVL3-78B-TEE",
        label: "OpenGVLab/InternVL3-78B-TEE",
    },
    {
        id: "mistralai/Devstral-2-123B-Instruct-2512-TEE",
        label: "mistralai/Devstral-2-123B-Instruct-2512-TEE",
    },
    {
        id: "zai-org/GLM-4.5-Air",
        label: "zai-org/GLM-4.5-Air",
    },
    {
        id: "chutesai/Mistral-Small-3.2-24B-Instruct-2506",
        label: "chutesai/Mistral-Small-3.2-24B-Instruct-2506",
    },
    {
        id: "unsloth/gemma-3-12b-it",
        label: "unsloth/gemma-3-12b-it",
    },
    {
        id: "tngtech/TNG-R1T-Chimera-TEE",
        label: "tngtech/TNG-R1T-Chimera-TEE",
    },
    {
        id: "moonshotai/Kimi-K2-Thinking-TEE",
        label: "moonshotai/Kimi-K2-Thinking-TEE",
    },
    {
        id: "NousResearch/Hermes-4.3-36B",
        label: "NousResearch/Hermes-4.3-36B",
    },
    {
        id: "zai-org/GLM-4.5-TEE",
        label: "zai-org/GLM-4.5-TEE",
    },
    {
        id: "deepseek-ai/DeepSeek-R1-TEE",
        label: "deepseek-ai/DeepSeek-R1-TEE",
    },
    {
        id: "Qwen/Qwen3-235B-A22B-Thinking-2507",
        label: "Qwen/Qwen3-235B-A22B-Thinking-2507",
    },
    {
        id: "Qwen/Qwen2.5-72B-Instruct",
        label: "Qwen/Qwen2.5-72B-Instruct",
    },
    {
        id: "MiniMaxAI/MiniMax-M2.1-TEE",
        label: "MiniMaxAI/MiniMax-M2.1-TEE",
    },
    {
        id: "Qwen/Qwen2.5-VL-72B-Instruct-TEE",
        label: "Qwen/Qwen2.5-VL-72B-Instruct-TEE",
    },
    {
        id: "Qwen/Qwen3-30B-A3B",
        label: "Qwen/Qwen3-30B-A3B",
    },
    {
        id: "Qwen/Qwen3-VL-235B-A22B-Instruct",
        label: "Qwen/Qwen3-VL-235B-A22B-Instruct",
    },
    {
        id: "zai-org/GLM-4.6V",
        label: "zai-org/GLM-4.6V",
    },
    {
        id: "XiaomiMiMo/MiMo-V2-Flash",
        label: "XiaomiMiMo/MiMo-V2-Flash",
    },
    {
        id: "Qwen/Qwen3-Next-80B-A3B-Instruct",
        label: "Qwen/Qwen3-Next-80B-A3B-Instruct",
    },
    {
        id: "Qwen/Qwen3-235B-A22B",
        label: "Qwen/Qwen3-235B-A22B",
    },
    {
        id: "deepseek-ai/DeepSeek-V3.2-Speciale-TEE",
        label: "deepseek-ai/DeepSeek-V3.2-Speciale-TEE",
    },
    {
        id: "Qwen/Qwen2.5-VL-32B-Instruct",
        label: "Qwen/Qwen2.5-VL-32B-Instruct",
    },
    {
        id: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16",
        label: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16",
    },
    {
        id: "miromind-ai/MiroThinker-v1.5-235B",
        label: "miromind-ai/MiroThinker-v1.5-235B",
    },
    {
        id: "NousResearch/Hermes-4-14B",
        label: "NousResearch/Hermes-4-14B",
    },
    {
        id: "unsloth/Llama-3.2-1B-Instruct",
        label: "unsloth/Llama-3.2-1B-Instruct",
    },
    {
        id: "Qwen/Qwen3Guard-Gen-0.6B",
        label: "Qwen/Qwen3Guard-Gen-0.6B",
    },
    {
        id: "rednote-hilab/dots.ocr",
        label: "rednote-hilab/dots.ocr",
    },
];

export const OPENROUTER_IMAGE_MODELS: ModelOption[] = [
    {
        id: "google/gemini-2.5-flash-image-preview",
        label: "Gemini 2.5 Flash Image Preview",
        outputModalities: ["text", "image"],
    },
    {
        id: "black-forest-labs/flux.2-pro",
        label: "Flux 2 Pro",
        outputModalities: ["image"],
    },
    {
        id: "black-forest-labs/flux.2-flex",
        label: "Flux 2 Flex",
        outputModalities: ["image"],
    },
    {
        id: "sourceful/riverflow-v2-standard-preview",
        label: "Riverflow V2 Standard Preview",
        outputModalities: ["image"],
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
    {
        id: "gpt-4o-mini-tts",
        label: "GPT-4o Mini TTS",
    },
    {
        id: "gemini-2.5-flash-preview-tts",
        label: "Gemini 2.5 Flash Preview TTS",
    },
    {
        id: "eleven_v3",
        label: "ElevenLabs v3",
    },
];

export const CHUTES_TTS_MODELS: ModelOption[] = [
    {
        id: "kokoro",
        label: "Kokoro",
    },
    {
        id: "csm-1b",
        label: "CSM 1B",
    },
];

export const AUTO_IMAGE_OPTION = "auto";
export const IMAGE_ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
export const EXTENDED_IMAGE_ASPECTS = [
    "1:1",
    "1:4",
    "4:1",
    "1:8",
    "8:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "4:5",
    "5:4",
    "9:16",
    "16:9",
    "21:9",
];
export const IMAGE_SIZES = ["1K", "2K", "4K"];
export const IMAGEN_SIZES = ["1K", "2K"];
export const NAVY_IMAGE_SIZES = [
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1152",
    "3840x2160",
    "2160x3840",
    "512x512",
    "768x768",
];
export const NAVY_IMAGE_QUALITIES = ["auto", "low", "medium", "high"];
export const VIDEO_ASPECTS = ["16:9", "9:16"];
export const VIDEO_RESOLUTIONS = ["720p", "1080p", "4k"];
export const VIDEO_DURATIONS = ["4", "6", "8"];
export const TTS_VOICES = [
    "alloy",
    "ash",
    "coral",
    "echo",
    "fable",
    "nova",
    "onyx",
    "sage",
    "shimmer",
    "alice",
    "aria",
    "brian",
    "charlie",
    "jessica",
    "Puck",
    "Charon",
    "Kore",
    "Fenrir",
    "Aoede",
];
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
        video: CHUTES_VIDEO_MODELS[0].id,
        tts: CHUTES_TTS_MODELS[0].id,
    },
    openrouter: {
        image: OPENROUTER_IMAGE_MODELS[0].id,
        video: OPENROUTER_IMAGE_MODELS[0].id,
        tts: OPENROUTER_IMAGE_MODELS[0].id,
    },
    nanogpt: {
        image: NANOGPT_IMAGE_MODELS[0].id,
        video: NANOGPT_VIDEO_MODELS[0].id,
        tts: NANOGPT_IMAGE_MODELS[0].id,
    },
};
