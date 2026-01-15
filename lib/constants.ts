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
        tts: "kokoro",
    },
    openrouter: {
        image: OPENROUTER_IMAGE_MODELS[0].id,
        video: OPENROUTER_IMAGE_MODELS[0].id,
        tts: OPENROUTER_IMAGE_MODELS[0].id,
    },
};
