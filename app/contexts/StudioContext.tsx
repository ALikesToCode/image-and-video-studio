"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
    DEFAULT_MODELS,
    GEMINI_IMAGE_MODELS,
    GEMINI_VIDEO_MODELS,
    CHUTES_IMAGE_MODELS,
    CHUTES_LLM_MODELS,
    CHUTES_VIDEO_MODELS,
    CHUTES_TTS_MODELS,
    OPENROUTER_IMAGE_MODELS,
    NAVY_IMAGE_MODELS,
    NAVY_VIDEO_MODELS,
    NAVY_TTS_MODELS,
    IMAGE_ASPECTS,
    IMAGE_SIZES,
    VIDEO_ASPECTS,
    VIDEO_RESOLUTIONS,
    VIDEO_DURATIONS,
    TTS_FORMATS,
    TTS_VOICES,
    type Provider,
    type Mode,
    type ModelOption,
} from "@/lib/constants";
import {
    type GeneratedImage,
    type NavyUsageResponse,
    type StoredMedia,
} from "@/lib/types";
import { dataUrlFromBase64, fetchAsDataUrl } from "@/lib/utils";
import {
    clearGalleryStore,
    getGalleryBlob,
    isIndexedDbAvailable,
    putGalleryBlob,
} from "@/lib/gallery-db";

// --- Types ---

type JobStatus = "queued" | "running" | "success" | "error";

export type GenerationJob = {
    id: string;
    status: JobStatus;
    mode: Mode;
    provider: Provider;
    model: string;
    prompt: string;
    apiKey: string;
    createdAt: string;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    progress?: string;
    negativePrompt?: string;

    imageCount?: number;
    imageAspect?: string;
    imageSize?: string;
    navyImageSize?: string;
    chutesGuidanceScale?: string;
    chutesWidth?: string;
    chutesHeight?: string;
    chutesSteps?: string;
    chutesResolution?: string;
    chutesSeed?: string;
    videoAspect?: string;
    videoResolution?: string;
    videoDuration?: string;
    ttsVoice?: string;
    ttsFormat?: string;
    ttsSpeed?: string;
    chutesVideoFps?: string;
    chutesVideoGuidanceScale?: string;
    videoImage?: string;
    saveToGallery: boolean;
    // Chutes TTS params
    chutesTtsSpeed?: string;
    chutesTtsSpeaker?: string;
    chutesTtsMaxDuration?: string;
    // Audio output
    audioUrl?: string; // result
    videoUrl?: string; // result
    audioData?: string; // base64
};

type StoredMediaRecord = Omit<StoredMedia, "dataUrl" | "kind"> & {
    dataUrl?: string;
    kind?: StoredMedia["kind"];
    mimeType?: string;
};

type StorageSnapshot = {
    usage: number;
    quota: number;
    persistent: boolean | null;
};

const STORAGE_KEYS = {
    provider: "studio_provider",
    mode: "studio_mode",
    model: "studio_model",
    keyGemini: "studio_api_key_gemini",
    keyNavy: "studio_api_key_navy",
    keyChutes: "studio_api_key_chutes",
    keyOpenRouter: "studio_api_key_openrouter",
    images: "studio_saved_images",
    openRouterModels: "studio_openrouter_models",
    navyImageModels: "studio_navy_image_models",
    navyVideoModels: "studio_navy_video_models",
    navyTtsModels: "studio_navy_tts_models",
    chutesChatModels: "studio_chutes_chat_models",
    chutesChatModel: "studio_chutes_chat_model",
    chutesToolImageModel: "studio_chutes_tool_image_model",
};

const MAX_CACHED_MODELS = 200;
const MAX_SAVED_MEDIA = 12;
const MAX_JOB_HISTORY = 20;

// --- Utils ---

const getKeyStorage = (provider: Provider) => {
    if (provider === "gemini") return STORAGE_KEYS.keyGemini;
    if (provider === "navy") return STORAGE_KEYS.keyNavy;
    if (provider === "openrouter") return STORAGE_KEYS.keyOpenRouter;
    return STORAGE_KEYS.keyChutes;
};



const readLocalStorage = <T,>(key: string, fallback: T): T => {
    if (typeof window === "undefined") return fallback;
    try {
        const stored = window.localStorage.getItem(key);
        if (!stored) return fallback;
        return JSON.parse(stored) as T;
    } catch {
        return fallback;
    }
};

const writeLocalStorage = (key: string, value: string) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
};

const sanitizeModelOptions = (models: unknown): ModelOption[] => {
    if (!Array.isArray(models)) return [];
    return models
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const record = item as Record<string, unknown>;
            const id = typeof record.id === "string" ? record.id : "";
            const label = typeof record.label === "string" ? record.label : id;
            if (!id) return null;
            return { id, label };
        })
        .filter((item): item is ModelOption => !!item)
        .slice(0, MAX_CACHED_MODELS);
};



const createId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};



const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;



const getString = (value: unknown, fallback = "") =>
    typeof value === "string" ? value : fallback;

const buildGeneratedImages = (payload: unknown): GeneratedImage[] => {
    const record = isRecord(payload) ? payload : {};
    const rawImages = Array.isArray(record.images) ? record.images : [];
    return rawImages
        .map((image) => {
            if (!isRecord(image)) return null;
            const data = getString(image.data);
            if (!data) return null;
            const mimeType = getString(image.mimeType, "image/png");
            return {
                id: createId(),
                dataUrl: dataUrlFromBase64(data, mimeType),
                mimeType,
            };
        })
        .filter((image): image is GeneratedImage => image !== null);
};

// --- Context Interface ---

interface StudioContextType {
    // State
    hydrated: boolean;
    provider: Provider;
    setProvider: (p: Provider) => void;
    mode: Mode;
    setMode: (m: Mode) => void;
    apiKey: string;
    setApiKey: (k: string) => void;
    model: string;
    setModel: (m: string) => void;

    // Settings
    prompt: string;
    setPrompt: (s: string) => void;
    negativePrompt: string;
    setNegativePrompt: (s: string) => void;
    imageCount: number;
    setImageCount: (n: number) => void;
    imageAspect: string;
    setImageAspect: (s: string) => void;
    imageSize: string;
    setImageSize: (s: string) => void;
    navyImageSize: string;
    setNavyImageSize: (s: string) => void;
    chutesVideoFps: string;
    setChutesVideoFps: (v: string) => void;
    chutesVideoGuidanceScale: string;
    setChutesVideoGuidanceScale: (v: string) => void;
    videoImage: string | null;
    setVideoImage: (dataUrl: string | null) => void;

    chutesGuidanceScale: string;
    setChutesGuidanceScale: (s: string) => void;
    chutesWidth: string;
    setChutesWidth: (s: string) => void;
    chutesHeight: string;
    setChutesHeight: (s: string) => void;
    chutesSteps: string;
    setChutesSteps: (s: string) => void;
    chutesResolution: string;
    setChutesResolution: (s: string) => void;
    chutesSeed: string;
    setChutesSeed: (s: string) => void;
    videoAspect: string;
    setVideoAspect: (s: string) => void;
    videoResolution: string;
    setVideoResolution: (s: string) => void;
    videoDuration: string;
    setVideoDuration: (s: string) => void;
    ttsVoice: string;
    setTtsVoice: (s: string) => void;
    ttsFormat: string;
    setTtsFormat: (s: string) => void;
    ttsSpeed: string;
    setTtsSpeed: (s: string) => void;
    saveToGallery: boolean;
    setSaveToGallery: (b: boolean) => void;

    // Chutes TTS
    chutesTtsSpeed: string;
    setChutesTtsSpeed: (s: string) => void;
    chutesTtsSpeaker: string;
    setChutesTtsSpeaker: (s: string) => void;
    chutesTtsMaxDuration: string;
    setChutesTtsMaxDuration: (s: string) => void;

    // Chutes Chat Specifics
    chutesChatKey: string;
    chutesChatModels: ModelOption[];
    chutesChatModel: string;
    setChutesChatModel: (s: string) => void;
    chutesToolImageModel: string;
    setChutesToolImageModel: (s: string) => void;
    chutesChatModelsLoading: boolean;
    chutesChatModelsError: string | null;

    // Data / Models
    openRouterImageModels: ModelOption[];
    navyImageModels: ModelOption[];
    navyVideoModels: ModelOption[];
    navyTtsModels: ModelOption[];
    modelSuggestions: ModelOption[];

    // Status
    statusMessage: string;
    setStatusMessage: (s: string) => void;
    errorMessage: string | null;
    setErrorMessage: (s: string | null) => void;
    modelsLoading: boolean;
    modelsError: string | null;

    // Navy Usage
    navyUsage: NavyUsageResponse | null;
    navyUsageError: string | null;
    navyUsageLoading: boolean;
    navyUsageUpdatedAt: string | null;
    refreshNavyUsage: () => Promise<void>;

    // Storage
    storageSnapshot: StorageSnapshot | null;
    storageError: string | null;
    refreshStorageEstimate: () => Promise<void>;

    // Outputs
    generatedImages: GeneratedImage[];
    setGeneratedImages: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
    savedMedia: StoredMedia[];
    setSavedMedia: React.Dispatch<React.SetStateAction<StoredMedia[]>>;
    videoUrl: string | null;
    setVideoUrl: (s: string | null) => void;
    audioUrl: string | null;
    setAudioUrl: (s: string | null) => void;
    audioMimeType: string | null;
    setAudioMimeType: (s: string | null) => void;
    lastOutput: { mode: Mode; prompt: string; model: string; provider: Provider; ttsVoice?: string } | null;
    setLastOutput: (o: { mode: Mode; prompt: string; model: string; provider: Provider; ttsVoice?: string } | null) => void;

    // Jobs
    jobs: GenerationJob[];
    updateJobs: (param: GenerationJob[] | ((prev: GenerationJob[]) => GenerationJob[])) => void;
    hasActiveJobs: boolean;
    runningJobs: GenerationJob[];
    queuedJobs: GenerationJob[];
    recentJobs: GenerationJob[];

    // Capabilities
    supportsVideo: boolean;
    supportsTts: boolean;

    // Actions
    clearKey: () => void;
    clearGallery: () => void;
    refreshModels: () => Promise<void>;
    refreshChutesChatModels: () => Promise<void>;

    // Logic
    // Logic
    handleGenerate: () => void;
    generateImage: (job: GenerationJob) => Promise<void>;
    generateVideo: (job: GenerationJob) => Promise<void>;
    generateAudio: (job: GenerationJob) => Promise<void>;
    runJob: (job: GenerationJob) => Promise<void>;
}

const StudioContext = createContext<StudioContextType | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
    const [hydrated, setHydrated] = useState(false);

    // --- Core State ---
    const [provider, setProvider] = useState<Provider>("gemini");
    const [mode, setMode] = useState<Mode>("image");
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState(DEFAULT_MODELS.gemini.image);

    // --- Dynamic Models ---
    const [openRouterImageModels, setOpenRouterImageModels] = useState<ModelOption[]>(OPENROUTER_IMAGE_MODELS);
    const [navyImageModels, setNavyImageModels] = useState<ModelOption[]>(NAVY_IMAGE_MODELS);
    const [navyVideoModels, setNavyVideoModels] = useState<ModelOption[]>(NAVY_VIDEO_MODELS);
    const [navyTtsModels, setNavyTtsModels] = useState<ModelOption[]>(NAVY_TTS_MODELS);

    // --- Settings ---
    const [prompt, setPrompt] = useState("");
    const [negativePrompt, setNegativePrompt] = useState("");
    const [imageCount, setImageCount] = useState(1);
    const [imageAspect, setImageAspect] = useState(IMAGE_ASPECTS[0]);
    const [imageSize, setImageSize] = useState(IMAGE_SIZES[0]);
    const [navyImageSize, setNavyImageSize] = useState("1024x1024");
    const [chutesGuidanceScale, setChutesGuidanceScale] = useState("7.5");
    // Chutes video
    const [chutesVideoFps, setChutesVideoFps] = useState("16");
    const [chutesVideoGuidanceScale, setChutesVideoGuidanceScale] = useState("1");
    // Chutes TTS
    const [chutesTtsSpeed, setChutesTtsSpeed] = useState("1");
    const [chutesTtsSpeaker, setChutesTtsSpeaker] = useState("1"); // for csm-1b
    const [chutesTtsMaxDuration, setChutesTtsMaxDuration] = useState("10000"); // for csm-1b
    const [videoImage, setVideoImage] = useState<string | null>(null);
    const [chutesWidth, setChutesWidth] = useState("1024");
    const [chutesHeight, setChutesHeight] = useState("1024");
    const [chutesSteps, setChutesSteps] = useState("50");
    const [chutesResolution, setChutesResolution] = useState("1024x1024");
    const [chutesSeed, setChutesSeed] = useState("");
    const [videoAspect, setVideoAspect] = useState(VIDEO_ASPECTS[0]);
    const [videoResolution, setVideoResolution] = useState(VIDEO_RESOLUTIONS[0]);
    const [videoDuration, setVideoDuration] = useState(VIDEO_DURATIONS[2]);
    const [ttsVoice, setTtsVoice] = useState(TTS_VOICES[0]);
    const [ttsFormat, setTtsFormat] = useState(TTS_FORMATS[0]);
    const [ttsSpeed, setTtsSpeed] = useState("1");
    const [saveToGallery, setSaveToGallery] = useState(true);

    // --- Chutes Chat Helper State ---
    const [chutesChatKey, setChutesChatKey] = useState("");
    const [chutesChatModels, setChutesChatModels] = useState<ModelOption[]>(CHUTES_LLM_MODELS);
    const [chutesChatModel, setChutesChatModel] = useState(CHUTES_LLM_MODELS[0]?.id ?? "");
    const [chutesToolImageModel, setChutesToolImageModel] = useState(CHUTES_IMAGE_MODELS[0]?.id ?? "z-image-turbo");
    const [chutesChatModelsLoading, setChutesChatModelsLoading] = useState(false);
    const [chutesChatModelsError, setChutesChatModelsError] = useState<string | null>(null);

    // --- App Logic State ---
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
    const [savedMedia, setSavedMedia] = useState<StoredMedia[]>([]);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioMimeType, setAudioMimeType] = useState<string | null>(null);

    const [jobs, setJobs] = useState<GenerationJob[]>([]);
    const [statusMessage, setStatusMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [modelsLoading, setModelsLoading] = useState(false);
    const [modelsError, setModelsError] = useState<string | null>(null);
    const [lastOutput, setLastOutput] = useState<{ mode: Mode; prompt: string; model: string; provider: Provider; ttsVoice?: string } | null>(null);

    const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot | null>(null);
    const [storageError, setStorageError] = useState<string | null>(null);

    const [navyUsage, setNavyUsage] = useState<NavyUsageResponse | null>(null);
    const [navyUsageError, setNavyUsageError] = useState<string | null>(null);
    const [navyUsageLoading, setNavyUsageLoading] = useState(false);
    const [navyUsageUpdatedAt, setNavyUsageUpdatedAt] = useState<string | null>(null);

    // --- Refs ---
    const galleryUrlsRef = useRef(new Map<string, string>());
    const navyUsageLoadingRef = useRef(false);
    const processingRef = useRef(false);

    // --- Computed ---
    const supportsVideo = provider === "gemini" || provider === "navy" || provider === "chutes";
    const supportsTts = provider === "navy" || provider === "chutes";
    const idbAvailable = useMemo(() => isIndexedDbAvailable(), []);

    const modelSuggestions = useMemo(() => {
        if (provider === "gemini") {
            return mode === "image" ? GEMINI_IMAGE_MODELS : GEMINI_VIDEO_MODELS;
        }
        if (provider === "chutes") {
            if (mode === "image") return CHUTES_IMAGE_MODELS;
            if (mode === "video") return CHUTES_VIDEO_MODELS;
            if (mode === "tts") return CHUTES_TTS_MODELS;
            return CHUTES_IMAGE_MODELS;
        }
        if (provider === "openrouter") {
            return openRouterImageModels;
        }
        if (mode === "video") return navyVideoModels;
        if (mode === "tts") return navyTtsModels;
        return navyImageModels;
    }, [provider, mode, openRouterImageModels, navyImageModels, navyVideoModels, navyTtsModels]);

    const runningJobs = jobs.filter((job) => job.status === "running");
    const queuedJobs = jobs.filter((job) => job.status === "queued");
    const hasActiveJobs = runningJobs.length > 0 || queuedJobs.length > 0;
    const recentJobs = jobs.slice(-4).reverse();

    // --- Actions ---

    // Trim job history
    const trimJobHistory = (items: GenerationJob[]) => {
        const completedCount = items.filter(
            (job) => job.status === "success" || job.status === "error"
        ).length;
        const overflow = completedCount - MAX_JOB_HISTORY;
        if (overflow <= 0) return items;
        let removed = 0;
        return items.filter((job) => {
            if (job.status === "success" || job.status === "error") {
                if (removed < overflow) {
                    removed += 1;
                    return false;
                }
            }
            return true;
        });
    };

    const updateJobs = useCallback((param: GenerationJob[] | ((prev: GenerationJob[]) => GenerationJob[])) => {
        setJobs((prev) => {
            const next = typeof param === "function" ? (param as (prev: GenerationJob[]) => GenerationJob[])(prev) : param;
            return trimJobHistory(next);
        });
    }, []);

    const updateJob = (id: string, updates: Partial<GenerationJob>) => {
        setJobs((prev) => trimJobHistory(prev.map(j => j.id === id ? { ...j, ...updates } : j)));
    };

    const startJob = (job: GenerationJob, message: string) => {
        updateJob(job.id, { status: "running", startedAt: new Date().toISOString(), progress: message });
        setStatusMessage(message);
        setErrorMessage(null);
    };



    const completeJob = (jobId: string, updates: Partial<GenerationJob> = {}, message = "Ready.") => {
        updateJob(jobId, { status: "success", finishedAt: new Date().toISOString(), progress: "Completed", ...updates });
        setStatusMessage(message);
    };

    const failJob = (jobId: string, message: string) => {
        updateJob(jobId, { status: "error", finishedAt: new Date().toISOString(), error: message, progress: "Failed" });
        setErrorMessage(message);
        setStatusMessage("");
    };



    const addMediaToGallery = async (
        items: { url: string; mimeType?: string; blob?: Blob }[],
        metadata: {
            prompt: string;
            model: string;
            provider: Provider;
            saveToGallery: boolean;
            kind: StoredMedia["kind"];
        }
    ) => {
        if (!metadata.saveToGallery || items.length === 0) return;
        try {
            const entries: StoredMedia[] = [];
            for (const item of items) {
                const id = createId();
                let blob = item.blob;
                let mimeType = item.mimeType;
                if (!idbAvailable) {
                    entries.push({ id, dataUrl: item.url, prompt: metadata.prompt, model: metadata.model, provider: metadata.provider, createdAt: new Date().toISOString(), kind: metadata.kind, mimeType });
                    continue;
                }
                if (!blob) {
                    try {
                        const response = await fetch(item.url);
                        if (!response.ok) throw new Error("Fetch failed");
                        blob = await response.blob();
                        mimeType = mimeType ?? blob.type;
                    } catch {
                        entries.push({ id, dataUrl: item.url, prompt: metadata.prompt, model: metadata.model, provider: metadata.provider, createdAt: new Date().toISOString(), kind: metadata.kind, mimeType });
                        continue;
                    }
                }
                await putGalleryBlob(id, blob);
                const url = URL.createObjectURL(blob);
                galleryUrlsRef.current.set(id, url);
                entries.push({ id, dataUrl: url, prompt: metadata.prompt, model: metadata.model, provider: metadata.provider, createdAt: new Date().toISOString(), kind: metadata.kind, mimeType: mimeType ?? blob.type });
            }
            if (entries.length) {
                setSavedMedia((prev) => [...entries, ...prev].slice(0, MAX_SAVED_MEDIA));
            }
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Gallery save failed");
        }
    };

    const generateImages = async (job: GenerationJob) => {
        // Placeholder for full logic to save space, assuming generic fetch implemented
        // RE-IMPLEMENTING simplified version for patch
        startJob(job, "Generating...");
        try {
            let images: GeneratedImage[] = [];
            let url = `/api/${job.provider}/image`;
            let body: Record<string, unknown> = { apiKey: job.apiKey, model: job.model, prompt: job.prompt };

            if (job.provider === "gemini" || job.provider === "openrouter") {
                body = { ...body, aspectRatio: job.imageAspect, imageSize: job.imageSize, numberOfImages: job.imageCount };
            } else if (job.provider === "navy") {
                body = { ...body, size: job.navyImageSize, numberOfImages: job.imageCount };
            } else {
                url = `/api/chutes/image`;
                body = { ...body, guidanceScale: Number(job.chutesGuidanceScale), width: Number(job.chutesWidth), height: Number(job.chutesHeight), numInferenceSteps: Number(job.chutesSteps), resolution: job.chutesResolution, seed: Number(job.chutesSeed) || null };
            }

            const res = await fetch(url, { method: "POST", body: JSON.stringify(body) });
            const payload = await res.json();
            if (!res.ok) throw new Error(payload.error || "Failed");

            if (job.provider === "navy") {
                for (const img of payload.images) {
                    const dataUrl = await fetchAsDataUrl(img.url);
                    images.push({ id: createId(), dataUrl, mimeType: "image/png" });
                }
            } else {
                images = buildGeneratedImages(payload);
            }

            setGeneratedImages(images);
            await addMediaToGallery(
                images.map(img => ({ url: img.dataUrl, mimeType: img.mimeType })),
                { prompt: job.prompt, model: job.model, provider: job.provider, saveToGallery: job.saveToGallery, kind: "image" }
            );
            setLastOutput({ mode: "image", prompt: job.prompt, model: job.model, provider: job.provider });
            completeJob(job.id);
        } catch (e) {
            failJob(job.id, e instanceof Error ? e.message : "Failed");
        }
    };

    const generateVideo = async (job: GenerationJob) => {
        startJob(job, "Generating Video...");
        try {
            console.log("Generating video with model:", job.model);
            const url = "/api/chutes/video";
            const body: Record<string, unknown> = {
                apiKey: job.apiKey,
                prompt: job.prompt,
                model: job.model,
                image: job.videoImage,
                fps: job.chutesVideoFps,
                guidance_scale_2: job.chutesVideoGuidanceScale
            };

            // If we add other providers, switch logic here

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const err = await response.text();
                throw new Error(err || "Failed to generate video");
            }

            const contentType = response.headers.get("content-type") ?? "";
            let videoUrl: string | null = null;

            if (contentType.includes("application/json")) {
                const data = await response.json();
                if (data?.error) throw new Error(data.error);
                if (typeof data?.url === "string") {
                    videoUrl = data.url;
                } else if (typeof data?.data === "string") {
                    const mimeType =
                        typeof data?.mimeType === "string"
                            ? data.mimeType
                            : "video/mp4";
                    videoUrl = dataUrlFromBase64(data.data, mimeType);
                }
            } else {
                const blob = await response.blob();
                videoUrl = URL.createObjectURL(blob);
            }

            if (!videoUrl) throw new Error("No video data received.");
            setVideoUrl(videoUrl);
            completeJob(job.id, { videoUrl });
            setLastOutput({ mode: "video", prompt: job.prompt, model: job.model, provider: job.provider });

        } catch (error) {
            console.error("Video generation error:", error);
            failJob(job.id, error instanceof Error ? error.message : "Video generation failed");
        }
    };

    const runJob = async (job: GenerationJob) => {
        if (job.mode === "image") { await generateImages(job); return; }
        if (job.mode === "video") { await generateVideo(job); return; }
        if (job.mode === "tts") { await generateAudio(job); return; }
        failJob(job.id, "Mode not fully implemented.");
    };


    const generateAudio = async (job: GenerationJob) => {
        startJob(job, "Generating Audio...");
        try {
            console.log("Generating audio with model:", job.model);

            // Only chutes implemented for now
            if (job.provider === "chutes") {
                const normalizedModel = (job.model || "").toLowerCase();
                const isCsm = normalizedModel === "csm-1b";
                const response = await fetch("/api/chutes/audio", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        apiKey: job.apiKey,
                        prompt: job.prompt,
                        model: job.model,
                        speed: isCsm ? undefined : job.chutesTtsSpeed,
                        speaker: isCsm ? job.chutesTtsSpeaker : undefined,
                        maxDuration: isCsm ? job.chutesTtsMaxDuration : undefined,
                    }),
                });

                if (!response.ok) {
                    const err = await response.text();
                    throw new Error(err || "Failed to generate audio");
                }

                const contentType = response.headers.get("content-type");
                let audioDataUrl: string | null = null;
                let audioMime: string | null = null;

                if (contentType && contentType.includes("application/json")) {
                    const data = await response.json();
                    // handle json error or data
                    if (data.error) throw new Error(data.error);
                    // if it returns base64 url or direct url
                    if (data.url) {
                        audioDataUrl = data.url;
                        audioMime = data.mimeType || "audio/mpeg"; // Default to mp3 if not specified
                    } else if (data.data) { // Assuming base64 data
                        audioDataUrl = dataUrlFromBase64(data.data, data.mimeType || "audio/mpeg");
                        audioMime = data.mimeType || "audio/mpeg";
                    }
                } else {
                    // Assume direct audio blob
                    const blob = await response.blob();
                    audioDataUrl = URL.createObjectURL(blob);
                    audioMime = blob.type;
                }

                if (!audioDataUrl) throw new Error("No audio data received.");

                setAudioUrl(audioDataUrl);
                setAudioMimeType(audioMime);
                setLastOutput({ mode: "tts", prompt: job.prompt, model: job.model, provider: job.provider, ttsVoice: job.ttsVoice });
                completeJob(job.id, { audioUrl: audioDataUrl, audioData: audioDataUrl.startsWith("data:") ? audioDataUrl : undefined }); // Store dataUrl in job for history
                return;

            } else {
                throw new Error("Audio generation not implemented for this provider");
            }

        } catch (error) {
            console.error("Audio generation error:", error);
            failJob(job.id, error instanceof Error ? error.message : "Audio generation failed");
        }
    };



    // Queue Processor
    useEffect(() => {
        if (!hydrated || processingRef.current) return;
        const nextJob = jobs.find(j => j.status === "queued");
        if (!nextJob) return;
        processingRef.current = true;
        runJob(nextJob).finally(() => { processingRef.current = false; });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobs, hydrated]);

    const handleGenerate = () => {
        if (!apiKey.trim()) { setErrorMessage("API Key required"); return; }
        if (!prompt.trim()) { setErrorMessage("Prompt required"); return; }
        const job: GenerationJob = {
            id: createId(), status: "queued", mode, provider, model, prompt, apiKey, createdAt: new Date().toISOString(),
            imageCount, imageAspect, imageSize, navyImageSize, chutesGuidanceScale, chutesWidth, chutesHeight, chutesSteps, chutesResolution, chutesSeed,
            chutesVideoFps, chutesVideoGuidanceScale, videoImage: videoImage || undefined,
            videoAspect, videoResolution, videoDuration, ttsVoice, ttsFormat, ttsSpeed, saveToGallery,
            negativePrompt,
            chutesTtsSpeed,
            chutesTtsSpeaker,
            chutesTtsMaxDuration,
        };
        setJobs(prev => [...prev, job]);
        setStatusMessage("Queued...");
    };

    const clearKey = () => {
        setApiKey("");
        // will trigger local storage clear via effect
    };

    const clearGallery = () => {
        setSavedMedia([]);
        clearGalleryStore().catch(console.error);
    };

    const refreshStorageEstimate = useCallback(async () => {
        if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
            setStorageError("Storage usage isn't available.");
            return;
        }
        try {
            const estimate = await navigator.storage.estimate();
            const persistent = navigator.storage.persisted ? await navigator.storage.persisted() : null;
            setStorageSnapshot({
                usage: estimate.usage ?? 0,
                quota: estimate.quota ?? 0,
                persistent,
            });
            setStorageError(null);
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : "Unable to read storage usage.");
        }
    }, []);

    const refreshNavyUsage = useCallback(async () => {
        if (provider !== "navy") return;
        const trimmedKey = apiKey.trim();
        if (!trimmedKey) {
            setNavyUsage(null);
            setNavyUsageError(null);
            setNavyUsageUpdatedAt(null);
            return;
        }
        if (navyUsageLoadingRef.current) return;
        navyUsageLoadingRef.current = true;
        setNavyUsageLoading(true);
        try {
            const response = await fetch("/api/navy/usage", {
                headers: { "x-user-api-key": trimmedKey },
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? "Unable to fetch usage.");
            setNavyUsage(payload as NavyUsageResponse);
            setNavyUsageError(null);
            setNavyUsageUpdatedAt(new Date().toISOString());
        } catch (error) {
            setNavyUsageError(error instanceof Error ? error.message : "Unable to fetch usage.");
        } finally {
            navyUsageLoadingRef.current = false;
            setNavyUsageLoading(false);
        }
    }, [apiKey, provider]);

    const refreshModels = useCallback(async () => {
        if (provider !== "openrouter" && provider !== "navy") return;
        setModelsLoading(true);
        setModelsError(null);
        try {
            const response = await fetch(`/api/${provider}/models`);
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? `Failed to fetch models from ${provider}`);

            if (provider === "openrouter") {
                const models = sanitizeModelOptions(payload);
                setOpenRouterImageModels(models);
            } else {
                if (payload.image) setNavyImageModels(sanitizeModelOptions(payload.image));
                if (payload.video) setNavyVideoModels(sanitizeModelOptions(payload.video));
                if (payload.audio) setNavyTtsModels(sanitizeModelOptions(payload.audio));
            }
        } catch (error) {
            setModelsError(error instanceof Error ? error.message : "Unknown error refreshing models");
        } finally {
            setModelsLoading(false);
        }
    }, [provider]);

    const refreshChutesChatModels = useCallback(async () => {
        setChutesChatModelsLoading(true);
        setChutesChatModelsError(null);
        try {
            const response = await fetch("/api/chutes/models");
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? "Failed to fetch Chutes models");
            setChutesChatModels(sanitizeModelOptions(payload));
        } catch (error) {
            setChutesChatModelsError(error instanceof Error ? error.message : "Error");
        } finally {
            setChutesChatModelsLoading(false);
        }
    }, []);

    // --- Effects (Persistence) ---

    // Hydration
    useEffect(() => {
        setHydrated(true);
        const storedProvider = readLocalStorage<Provider | null>(STORAGE_KEYS.provider, null);
        const storedMode = readLocalStorage<Mode | null>(STORAGE_KEYS.mode, null);
        const storedMedia = readLocalStorage<StoredMediaRecord[]>(STORAGE_KEYS.images, []);
        const storedChutesKey = readLocalStorage<string>(STORAGE_KEYS.keyChutes, "");

        if (storedProvider) setProvider(storedProvider);
        if (storedMode) setMode(storedMode);
        setChutesChatKey(storedChutesKey);

        const storedOpenRouterModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.openRouterModels, []);
        if (storedOpenRouterModels.length) setOpenRouterImageModels(sanitizeModelOptions(storedOpenRouterModels));

        const loadSavedMedia = async () => {
            if (!storedMedia.length) return;
            if (!idbAvailable) {
                const legacyEntries = storedMedia.filter(
                    (item): item is StoredMediaRecord & { dataUrl: string } =>
                        typeof item.dataUrl === "string" && item.dataUrl.length > 0
                );
                if (legacyEntries.length) {
                    setSavedMedia(
                        legacyEntries.map((item) => ({
                            id: item.id,
                            dataUrl: item.dataUrl,
                            prompt: item.prompt,
                            model: item.model,
                            provider: item.provider,
                            createdAt: item.createdAt,
                            kind: item.kind ?? "image",
                            mimeType: item.mimeType,
                        }))
                    );
                }
                return;
            }
            const entries: StoredMedia[] = [];
            for (const item of storedMedia) {
                try {
                    let blob = await getGalleryBlob(item.id);
                    if (!blob && item.dataUrl) {
                        const response = await fetch(item.dataUrl);
                        if (response.ok) blob = await response.blob();
                        if (blob) await putGalleryBlob(item.id, blob);
                    }
                    if (!blob) continue;
                    const url = URL.createObjectURL(blob);
                    galleryUrlsRef.current.set(item.id, url);
                    entries.push({
                        id: item.id,
                        dataUrl: url,
                        prompt: item.prompt,
                        model: item.model,
                        provider: item.provider,
                        createdAt: item.createdAt,
                        kind: item.kind ?? "image",
                        mimeType: item.mimeType ?? blob.type,
                    });
                } catch {
                    // simplified error handling
                }
            }
            setSavedMedia(entries);
        };
        void loadSavedMedia();

    }, [idbAvailable]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.provider, JSON.stringify(provider));
        writeLocalStorage(STORAGE_KEYS.mode, JSON.stringify(mode));
    }, [provider, mode, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        const storageKey = getKeyStorage(provider);
        if (apiKey) writeLocalStorage(storageKey, JSON.stringify(apiKey));
        else window.localStorage.removeItem(storageKey);
    }, [apiKey, provider, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        const storedKey = readLocalStorage<string>(getKeyStorage(provider), "");
        setApiKey(storedKey);
    }, [provider, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        if (provider === "navy" && apiKey.trim()) {
            void refreshNavyUsage();
            const interval = window.setInterval(() => void refreshNavyUsage(), 60000);
            return () => window.clearInterval(interval);
        } else {
            setNavyUsage(null);
        }
    }, [provider, apiKey, hydrated, refreshNavyUsage]);

    useEffect(() => {
        if (!hydrated) return;
        try {
            const storedMedia: StoredMediaRecord[] = savedMedia.map((item) => ({
                id: item.id,
                prompt: item.prompt,
                model: item.model,
                provider: item.provider,
                createdAt: item.createdAt,
                kind: item.kind,
                mimeType: item.mimeType,
                ...(!idbAvailable || !item.dataUrl.startsWith("blob:") ? { dataUrl: item.dataUrl } : {}),
            }));
            writeLocalStorage(STORAGE_KEYS.images, JSON.stringify(storedMedia));
        } catch { }
    }, [savedMedia, hydrated, idbAvailable]);

    const value: StudioContextType = {
        hydrated,
        provider, setProvider,
        mode, setMode,
        apiKey, setApiKey,
        model, setModel,
        prompt, setPrompt,
        negativePrompt, setNegativePrompt,
        imageCount, setImageCount,
        imageAspect, setImageAspect,
        imageSize, setImageSize,
        navyImageSize, setNavyImageSize,
        chutesVideoFps, setChutesVideoFps,
        chutesVideoGuidanceScale, setChutesVideoGuidanceScale,
        videoImage, setVideoImage,
        chutesGuidanceScale, setChutesGuidanceScale,
        chutesWidth, setChutesWidth,
        chutesHeight, setChutesHeight,
        chutesSteps, setChutesSteps,
        chutesResolution, setChutesResolution,
        chutesSeed, setChutesSeed,
        videoAspect, setVideoAspect,
        videoResolution, setVideoResolution,
        videoDuration, setVideoDuration,
        ttsVoice, setTtsVoice,
        ttsFormat, setTtsFormat,
        ttsSpeed, setTtsSpeed,
        saveToGallery, setSaveToGallery,
        chutesChatKey,
        chutesChatModels,
        chutesChatModel, setChutesChatModel,
        chutesToolImageModel, setChutesToolImageModel,
        chutesChatModelsLoading,
        chutesChatModelsError,
        openRouterImageModels,
        navyImageModels,
        navyVideoModels,
        navyTtsModels,
        modelSuggestions,
        statusMessage, setStatusMessage,
        errorMessage, setErrorMessage,
        modelsLoading, modelsError,
        navyUsage, navyUsageError, navyUsageLoading, navyUsageUpdatedAt, refreshNavyUsage,
        storageSnapshot, storageError, refreshStorageEstimate,
        generatedImages, setGeneratedImages,
        savedMedia, setSavedMedia,
        videoUrl, setVideoUrl,
        audioUrl, setAudioUrl,
        audioMimeType, setAudioMimeType,
        lastOutput, setLastOutput,
        jobs, updateJobs,
        hasActiveJobs, runningJobs, queuedJobs, recentJobs,
        supportsVideo, supportsTts,
        clearKey, clearGallery,
        refreshModels, refreshChutesChatModels,
        handleGenerate,
        generateImage: generateImages,
        generateVideo,
        generateAudio,
        runJob,
        // Chutes TTS
        chutesTtsSpeed, setChutesTtsSpeed,
        chutesTtsSpeaker, setChutesTtsSpeaker,
        chutesTtsMaxDuration, setChutesTtsMaxDuration,
    };

    return (
        <StudioContext.Provider value={value}>
            {children}
        </StudioContext.Provider>
    );
}

export const useStudio = () => {
    const context = useContext(StudioContext);
    if (!context) throw new Error("useStudio must be used within a StudioProvider");
    return context;
};
