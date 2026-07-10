"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
    AUTO_IMAGE_OPTION,
    DEFAULT_MODELS,
    GEMINI_IMAGE_MODELS,
    GEMINI_VIDEO_MODELS,
    CHUTES_IMAGE_MODELS,
    CHUTES_LLM_MODELS,
    CHUTES_VIDEO_MODELS,
    CHUTES_TTS_MODELS,
    NANOGPT_IMAGE_MODELS,
    NANOGPT_VIDEO_MODELS,
    OPENROUTER_IMAGE_MODELS,
    NAVY_IMAGE_MODELS,
    NAVY_IMAGE_QUALITIES,
    NAVY_IMAGE_SIZES,
    NAVY_CHAT_MODELS,
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
    type ChatProvider,
    type ModelOption,
    type ModelParameterValue,
} from "@/lib/constants";
import {
    type GeneratedImage,
    type GenerationBilling,
    type NavyUsageResponse,
    type PersistedGenerationJob,
    type ReferenceRole,
    type StoredMedia,
    type StoredReference,
} from "@/lib/types";
import { dataUrlFromBase64, fetchAsDataUrl } from "@/lib/utils";
import {
    extractOpenRouterImageModels,
    getQueuedJobsToStart,
    getActiveJobCount,
    mergeGeneratedImagesInDisplayOrder,
    normalizeImageModelOrder,
    normalizeImageRetryAttempts,
    NAVY_JOB_POLL_INTERVAL_MS,
    NAVY_JOB_POLL_MAX_ATTEMPTS,
    resolveNavyJobPollDelayMs,
    resolveImageSizingOptions,
    resolveImageGenerationModelPipeline,
    retryAsyncOperation,
    isGptImage2Model,
    isValidGptImage2Size,
    isValidNavyImagePixelSize,
    DEFAULT_IMAGE_RETRY_ATTEMPTS,
} from "@/lib/studio-generation";
import {
    buildModelParameterPayload,
    resolveModelParameterValues,
    type ModelParameterValues,
} from "@/lib/model-capability-settings";
import {
    restorePersistedGenerationJob,
    shouldPersistRemoteGenerationJob,
} from "@/lib/generation-job-persistence";
import { normalizeVeoDuration } from "@/lib/studio-validation";
import {
    clearGalleryStore,
    deleteGalleryBlob,
    deletePersistedJobRecord,
    deleteReferenceRecord,
    getGalleryBlob,
    isIndexedDbAvailable,
    listPersistedJobRecords,
    listReferenceRecords,
    putPersistedJobRecord,
    putGalleryBlob,
    putReferenceRecord,
} from "@/lib/gallery-db";
import {
    clearAllProviderKeys,
    detectLegacyProviderKeys,
    hasDismissedLegacyKeyMigration,
    markLegacyKeyMigrationDismissed,
    persistProviderKeys,
    readKeyStorageMode,
    readProviderKeys,
    removeLegacyProviderKeys,
    writeKeyStorageMode,
    type KeyStorageMode,
    type LegacyProviderKey,
    type ProviderKeys,
} from "@/lib/client/key-storage";

// --- Types ---

type JobStatus = "queued" | "running" | "success" | "error";

export type GenerationJob = {
    id: string;
    status: JobStatus;
    mode: Mode;
    provider: Provider;
    model: string;
    outputModalities?: string[];
    prompt: string;
    apiKey: string;
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
    negativePrompt?: string;
    promptAgentModel?: string;
    referenceIds?: string[];

    imageCount?: number;
    imageRetryAttempts?: number;
    imageAspect?: string;
    imageSize?: string;
    navyImageSize?: string;
    navyImageQuality?: string;
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
    modelParameters?: ModelParameterValues;
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
    modelSelections: "studio_model_selections",
    settings: "studio_settings",
    generatedImages: "studio_generated_images",
    lastOutput: "studio_last_output",
    selectedReferences: "studio_selected_references",
    images: "studio_saved_images",
    openRouterModels: "studio_openrouter_models",
    navyImageModels: "studio_navy_image_models",
    navyVideoModels: "studio_navy_video_models",
    navyTtsModels: "studio_navy_tts_models",
    nanoGptImageModels: "studio_nanogpt_image_models",
    nanoGptVideoModels: "studio_nanogpt_video_models",
    chatProvider: "studio_chat_provider",
    chutesChatModels: "studio_chutes_chat_models",
    chutesChatModel: "studio_chutes_chat_model",
    chutesToolImageModel: "studio_chutes_tool_image_model",
    navyChatModels: "studio_navy_chat_models",
    navyChatModel: "studio_navy_chat_model",
    navyToolImageModel: "studio_navy_tool_image_model",
};

type StoredSettings = Partial<{
    prompt: string;
    negativePrompt: string;
    imagePipelineEnabled: boolean;
    imageModelOrder: string[];
    imageRetryAttempts: number;
    imageCount: number;
    imageAspect: string;
    imageSize: string;
    navyImageSize: string;
    navyImageQuality: string;
    chutesGuidanceScale: string;
    chutesWidth: string;
    chutesHeight: string;
    chutesSteps: string;
    chutesResolution: string;
    chutesSeed: string;
    chutesVideoFps: string;
    chutesVideoGuidanceScale: string;
    videoAspect: string;
    videoResolution: string;
    videoDuration: string;
    ttsVoice: string;
    ttsFormat: string;
    ttsSpeed: string;
    saveToGallery: boolean;
    chutesTtsSpeed: string;
    chutesTtsSpeaker: string;
    chutesTtsMaxDuration: string;
    modelParameterValuesByModel: Record<string, ModelParameterValues>;
}>;

type GenerateOptions = {
    mode?: Mode;
    prompt?: string;
};

const MAX_CACHED_MODELS = 500;
const MAX_SAVED_MEDIA = 250;
const MAX_JOB_HISTORY = 20;
const MAX_REFERENCES = 24;
const MAX_NAVY_REFERENCE_IMAGES = 5;

// --- Utils ---

const yieldToPaint = () =>
    new Promise<void>((resolve) => {
        if (typeof window !== "undefined" && window.requestAnimationFrame) {
            window.requestAnimationFrame(() => resolve());
            return;
        }
        setTimeout(resolve, 0);
    });

const buildNavyImageUrlPayload = (
    referenceImages: Array<{ dataUrl: string; role?: string }>,
    primaryImage?: string | null
) => {
    const ordered = [
        ...(primaryImage ? [{ dataUrl: primaryImage, role: "source_image" }] : []),
        ...referenceImages.filter(
            (reference) =>
                reference.role === "source_image" ||
                reference.role === "first_frame" ||
                reference.role === "last_frame"
        ),
        ...referenceImages.filter(
            (reference) =>
                reference.role !== "source_image" &&
                reference.role !== "first_frame" &&
                reference.role !== "last_frame"
        ),
    ];
    const urls: string[] = [];
    for (const reference of ordered) {
        const url = reference.dataUrl.trim();
        if (!url || urls.includes(url)) continue;
        urls.push(url);
        if (urls.length >= MAX_NAVY_REFERENCE_IMAGES) break;
    }
    if (!urls.length) return undefined;
    return urls.length === 1 ? urls[0] : urls;
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

const readNullableStringArray = (record: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
        const value = record[key];
        if (value === null) return null;
        if (Array.isArray(value)) {
            const values = value.filter(
                (entry): entry is string => typeof entry === "string"
            );
            if (values.length) return values;
        }
    }
    return undefined;
};

const readNullableNumber = (record: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
        const value = record[key];
        if (value === null) return null;
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return undefined;
};

const readNullableBoolean = (record: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
        const value = record[key];
        if (value === null) return null;
        if (typeof value === "boolean") return value;
    }
    return undefined;
};

const readNullableString = (record: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
        const value = record[key];
        if (value === null) return null;
        if (typeof value === "string") return value;
    }
    return undefined;
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
            const outputModalities = readNullableStringArray(record, "outputModalities", "output_modalities");
            const inputModalities = readNullableStringArray(record, "inputModalities", "input_modalities");
            const endpoint = typeof record.endpoint === "string" ? record.endpoint : undefined;
            const provider = typeof record.provider === "string" ? record.provider : undefined;
            const premium = typeof record.premium === "boolean" ? record.premium : undefined;
            const requiredPlan =
                typeof record.requiredPlan === "string"
                    ? record.requiredPlan
                    : typeof record.required_plan === "string"
                        ? record.required_plan
                        : record.requiredPlan === null || record.required_plan === null
                            ? null
                            : undefined;
            const tokenMultiplier =
                typeof record.tokenMultiplier === "number"
                    ? record.tokenMultiplier
                    : typeof record.token_multiplier === "number"
                        ? record.token_multiplier
                        : undefined;
            const contextWindow = readNullableNumber(record, "contextWindow", "context_window");
            const maxOutputTokens = readNullableNumber(record, "maxOutputTokens", "max_output_tokens");
            const modality = readNullableString(record, "modality");
            const tokenizer = readNullableString(record, "tokenizer");
            const description = readNullableString(record, "description");
            const metadataSource = readNullableString(record, "metadataSource", "metadata_source");
            const metadataStatus =
                typeof record.metadataStatus === "string"
                    ? record.metadataStatus
                    : typeof record.metadata_status === "string"
                        ? record.metadata_status
                        : undefined;
            const supportsVision = readNullableBoolean(record, "supportsVision", "supports_vision");
            const supportsTools = readNullableBoolean(record, "supportsTools", "supports_tools");
            const supportsFunctionCalling = readNullableBoolean(record, "supportsFunctionCalling", "supports_function_calling");
            const supportsReasoning = readNullableBoolean(record, "supportsReasoning", "supports_reasoning");
            const supportsJsonMode = readNullableBoolean(record, "supportsJsonMode", "supports_json_mode");
            const supportsAudioInput = readNullableBoolean(record, "supportsAudioInput", "supports_audio_input");
            const supportsImageOutput = readNullableBoolean(record, "supportsImageOutput", "supports_image_output");
            const supportsStreaming = readNullableBoolean(record, "supportsStreaming", "supports_streaming");
            const maxReferenceImages =
                typeof record.maxReferenceImages === "number" && Number.isFinite(record.maxReferenceImages)
                    ? record.maxReferenceImages
                    : typeof record.max_reference_images === "number" && Number.isFinite(record.max_reference_images)
                        ? record.max_reference_images
                        : undefined;
            const supportedResolutions = readNullableStringArray(
                record,
                "supportedResolutions",
                "supported_resolutions"
            );
            const maxOutputImages =
                typeof record.maxOutputImages === "number" && Number.isFinite(record.maxOutputImages)
                    ? record.maxOutputImages
                    : undefined;
            const fixedOutputImages =
                typeof record.fixedOutputImages === "number" && Number.isFinite(record.fixedOutputImages)
                    ? record.fixedOutputImages
                    : undefined;
            const inputImageConstraints =
                record.inputImageConstraints &&
                    typeof record.inputImageConstraints === "object" &&
                    !Array.isArray(record.inputImageConstraints)
                    ? record.inputImageConstraints as ModelOption["inputImageConstraints"]
                    : undefined;
            const dynamicParameters =
                record.dynamicParameters &&
                    typeof record.dynamicParameters === "object" &&
                    !Array.isArray(record.dynamicParameters)
                    ? record.dynamicParameters as ModelOption["dynamicParameters"]
                    : undefined;
            const parameterDefaults =
                record.parameterDefaults &&
                    typeof record.parameterDefaults === "object" &&
                    !Array.isArray(record.parameterDefaults)
                    ? record.parameterDefaults as ModelOption["parameterDefaults"]
                    : undefined;
            return {
                id,
                label,
                ...(provider ? { provider } : {}),
                ...(endpoint ? { endpoint } : {}),
                ...(inputModalities !== undefined ? { inputModalities } : {}),
                ...(outputModalities !== undefined ? { outputModalities } : {}),
                ...(typeof premium === "boolean" ? { premium } : {}),
                ...(requiredPlan !== undefined ? { requiredPlan } : {}),
                ...(typeof tokenMultiplier === "number" ? { tokenMultiplier } : {}),
                ...(contextWindow !== undefined ? { contextWindow } : {}),
                ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
                ...(modality !== undefined ? { modality } : {}),
                ...(tokenizer !== undefined ? { tokenizer } : {}),
                ...(description !== undefined ? { description } : {}),
                ...(metadataSource !== undefined ? { metadataSource } : {}),
                ...(metadataStatus !== undefined ? { metadataStatus } : {}),
                ...(supportsVision !== undefined ? { supportsVision } : {}),
                ...(supportsTools !== undefined ? { supportsTools } : {}),
                ...(supportsFunctionCalling !== undefined ? { supportsFunctionCalling } : {}),
                ...(supportsReasoning !== undefined ? { supportsReasoning } : {}),
                ...(supportsJsonMode !== undefined ? { supportsJsonMode } : {}),
                ...(supportsAudioInput !== undefined ? { supportsAudioInput } : {}),
                ...(supportsImageOutput !== undefined ? { supportsImageOutput } : {}),
                ...(supportsStreaming !== undefined ? { supportsStreaming } : {}),
                ...(maxReferenceImages !== undefined ? { maxReferenceImages } : {}),
                ...(supportedResolutions !== undefined ? { supportedResolutions } : {}),
                ...(maxOutputImages !== undefined ? { maxOutputImages } : {}),
                ...(fixedOutputImages !== undefined ? { fixedOutputImages } : {}),
                ...(inputImageConstraints !== undefined ? { inputImageConstraints } : {}),
                ...(dynamicParameters !== undefined ? { dynamicParameters } : {}),
                ...(parameterDefaults !== undefined ? { parameterDefaults } : {}),
                ...(record.pricing !== undefined ? { pricing: record.pricing } : {}),
                ...(record.supports && typeof record.supports === "object" ? { supports: record.supports as ModelOption["supports"] } : {}),
            };
        })
        .filter((item): item is ModelOption => !!item)
        .slice(0, MAX_CACHED_MODELS);
};

const mergeModelOptions = (...modelLists: ModelOption[][]): ModelOption[] => {
    const merged = new Map<string, ModelOption>();
    const order: string[] = [];
    for (const models of modelLists) {
        for (const model of models) {
            if (!merged.has(model.id)) {
                order.push(model.id);
            }
            merged.set(model.id, { ...merged.get(model.id), ...model });
        }
    }
    return order
        .map((id) => merged.get(id))
        .filter((model): model is ModelOption => !!model)
        .slice(0, MAX_CACHED_MODELS);
};



const createId = () => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const sleep = (ms: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, ms));



const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;



const getString = (value: unknown, fallback = "") =>
    typeof value === "string" ? value : fallback;

const getNumber = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

const getBoolean = (value: unknown, fallback: boolean) =>
    typeof value === "boolean" ? value : fallback;

const isProvider = (value: unknown): value is Provider =>
    value === "gemini" ||
    value === "navy" ||
    value === "chutes" ||
    value === "openrouter" ||
    value === "nanogpt";

const isChatProvider = (value: unknown): value is ChatProvider =>
    value === "chutes" || value === "navy";

const isMode = (value: unknown): value is Mode =>
    value === "image" || value === "video" || value === "tts";

const sanitizeGeneratedImages = (value: unknown): GeneratedImage[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!isRecord(item)) return null;
            const dataUrl = getString(item.dataUrl);
            if (!dataUrl) return null;
            const mimeType = getString(item.mimeType, "image/png");
            const id = getString(item.id, createId());
            const model = getString(item.model);
            const prompt = getString(item.prompt);
            const provider = isProvider(item.provider) ? item.provider : undefined;
            const batchId = getString(item.batchId);
            const batchCreatedAt = getString(item.batchCreatedAt);
            const batchOrder =
                typeof item.batchOrder === "number" ? item.batchOrder : undefined;
            const imageOrder =
                typeof item.imageOrder === "number" ? item.imageOrder : undefined;
            const createdAt = getString(item.createdAt);

            return {
                id,
                dataUrl,
                mimeType,
                ...(model ? { model } : {}),
                ...(prompt ? { prompt } : {}),
                ...(provider ? { provider } : {}),
                ...(batchId ? { batchId } : {}),
                ...(batchCreatedAt ? { batchCreatedAt } : {}),
                ...(typeof batchOrder === "number" ? { batchOrder } : {}),
                ...(typeof imageOrder === "number" ? { imageOrder } : {}),
                ...(createdAt ? { createdAt } : {}),
            };
        })
        .filter((item): item is GeneratedImage => !!item)
        .slice(0, MAX_SAVED_MEDIA);
};

const sanitizeModelSelections = (value: unknown): Record<string, string> => {
    if (!isRecord(value)) return {};
    return Object.entries(value).reduce<Record<string, string>>((acc, [key, entry]) => {
        if (typeof entry === "string" && entry.trim()) {
            acc[key] = entry;
        }
        return acc;
    }, {});
};

const sanitizeStoredModelParameterValues = (
    value: unknown
): Record<string, ModelParameterValues> => {
    if (!isRecord(value)) return {};
    const result: Record<string, ModelParameterValues> = {};
    for (const [modelId, rawValues] of Object.entries(value).slice(0, MAX_CACHED_MODELS)) {
        if (!modelId.trim() || !isRecord(rawValues)) continue;
        const values: ModelParameterValues = {};
        for (const [key, rawValue] of Object.entries(rawValues).slice(0, 64)) {
            if (
                rawValue === null ||
                typeof rawValue === "string" ||
                typeof rawValue === "boolean" ||
                (typeof rawValue === "number" && Number.isFinite(rawValue))
            ) {
                values[key] = rawValue;
            }
        }
        if (Object.keys(values).length) result[modelId] = values;
    }
    return result;
};

const buildGeneratedImages = (payload: unknown): GeneratedImage[] => {
    const record = isRecord(payload) ? payload : {};
    const rawImages = Array.isArray(record.images) ? record.images : [];
    return rawImages
        .map((image) => {
            if (!isRecord(image)) return null;
            const data = getString(image.data);
            const url = getString(image.url);
            if (!data && !url) return null;
            const mimeType = getString(image.mimeType, "image/png");
            return {
                id: createId(),
                dataUrl: data ? dataUrlFromBase64(data, mimeType) : url,
                mimeType,
            };
        })
        .filter((image): image is GeneratedImage => image !== null);
};

const errorMessageFromPayload = (payload: unknown, fallback: string) => {
    if (!isRecord(payload)) return fallback;
    const error = payload.error;
    return typeof error === "string" && error.trim() ? error : fallback;
};

const generationMetadataFromPayload = (payload: unknown) => {
    const root = isRecord(payload) ? payload : {};
    const rawBilling = isRecord(root.billing) ? root.billing : root;
    const billing: GenerationBilling = {};
    if (typeof rawBilling.cost === "number" && Number.isFinite(rawBilling.cost)) {
        billing.cost = rawBilling.cost;
    }
    if (typeof rawBilling.paymentSource === "string" && rawBilling.paymentSource) {
        billing.paymentSource = rawBilling.paymentSource;
    }
    if (
        typeof rawBilling.remainingBalance === "number" &&
        Number.isFinite(rawBilling.remainingBalance)
    ) {
        billing.remainingBalance = rawBilling.remainingBalance;
    }
    return {
        billing: Object.keys(billing).length ? billing : undefined,
        requestId: typeof root.requestId === "string" ? root.requestId : undefined,
    };
};

const toPersistedJob = (job: GenerationJob): PersistedGenerationJob => ({
    id: job.id,
    status: job.status,
    mode: job.mode,
    provider: job.provider,
    model: job.model,
    prompt: job.prompt,
    createdAt: job.createdAt,
    batchId: job.batchId,
    batchCreatedAt: job.batchCreatedAt,
    batchOrder: job.batchOrder,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    progress: job.progress,
    remoteJobId: job.remoteJobId,
    remoteOperationName: job.remoteOperationName,
    remoteStatus: job.remoteStatus,
    billing: job.billing,
    requestId: job.requestId,
    saveToGallery: job.saveToGallery,
});

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
    apiKeys: ProviderKeys;
    setApiKeyForProvider: (provider: Provider, key: string) => void;
    keyStorageMode: KeyStorageMode;
    setKeyStorageMode: React.Dispatch<React.SetStateAction<KeyStorageMode>>;
    legacyProviderKeys: LegacyProviderKey[];
    migrateLegacyProviderKeys: (mode?: KeyStorageMode) => void;
    discardLegacyProviderKeys: () => void;
    clearAllKeys: () => void;
    model: string;
    setModel: (m: string) => void;

    // Settings
    prompt: string;
    setPrompt: (s: string) => void;
    negativePrompt: string;
    setNegativePrompt: (s: string) => void;
    imageCount: number;
    setImageCount: (n: number) => void;
    imagePipelineEnabled: boolean;
    setImagePipelineEnabled: (enabled: boolean) => void;
    imageModelOrder: string[];
    setImageModelOrder: React.Dispatch<React.SetStateAction<string[]>>;
    imageRetryAttempts: number;
    setImageRetryAttempts: (n: number) => void;
    imageAspect: string;
    setImageAspect: (s: string) => void;
    imageSize: string;
    setImageSize: (s: string) => void;
    navyImageSize: string;
    setNavyImageSize: (s: string) => void;
    navyImageQuality: string;
    setNavyImageQuality: (s: string) => void;
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
    modelParameterValues: ModelParameterValues;
    setModelParameterValue: (key: string, value: ModelParameterValue) => void;

    // Chutes TTS
    chutesTtsSpeed: string;
    setChutesTtsSpeed: (s: string) => void;
    chutesTtsSpeaker: string;
    setChutesTtsSpeaker: (s: string) => void;
    chutesTtsMaxDuration: string;
    setChutesTtsMaxDuration: (s: string) => void;

    // Chutes Chat Specifics
    chatProvider: ChatProvider;
    setChatProvider: (p: ChatProvider) => void;
    chutesChatModels: ModelOption[];
    chutesChatModel: string;
    setChutesChatModel: (s: string) => void;
    chutesToolImageModel: string;
    setChutesToolImageModel: (s: string) => void;
    chutesChatModelsLoading: boolean;
    chutesChatModelsError: string | null;
    navyChatModels: ModelOption[];
    navyChatModel: string;
    setNavyChatModel: (s: string) => void;
    navyToolImageModel: string;
    setNavyToolImageModel: (s: string) => void;
    navyChatModelsLoading: boolean;
    navyChatModelsError: string | null;

    // Data / Models
    openRouterImageModels: ModelOption[];
    navyImageModels: ModelOption[];
    navyVideoModels: ModelOption[];
    navyTtsModels: ModelOption[];
    nanoGptImageModels: ModelOption[];
    nanoGptVideoModels: ModelOption[];
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
    requestPersistentStorage: () => Promise<boolean>;

    // References
    references: StoredReference[];
    selectedReferenceIds: string[];
    selectedReferences: StoredReference[];
    addReferenceFile: (file: File, role?: ReferenceRole) => Promise<void>;
    removeReference: (id: string) => Promise<void>;
    toggleReferenceSelection: (id: string) => void;
    clearSelectedReferences: () => void;

    // Outputs
    generatedImages: GeneratedImage[];
    setGeneratedImages: React.Dispatch<React.SetStateAction<GeneratedImage[]>>;
    savedMedia: StoredMedia[];
    setSavedMedia: React.Dispatch<React.SetStateAction<StoredMedia[]>>;
    deleteSavedMedia: (id: string) => Promise<void>;
    videoUrl: string | null;
    setVideoUrl: (s: string | null) => void;
    audioUrl: string | null;
    setAudioUrl: (s: string | null) => void;
    audioMimeType: string | null;
    setAudioMimeType: (s: string | null) => void;
    lastOutput: { mode: Mode; prompt: string; model: string; provider: Provider; ttsVoice?: string; mediaIds?: string[] } | null;
    setLastOutput: (o: { mode: Mode; prompt: string; model: string; provider: Provider; ttsVoice?: string; mediaIds?: string[] } | null) => void;

    // Jobs
    jobs: GenerationJob[];
    updateJobs: (param: GenerationJob[] | ((prev: GenerationJob[]) => GenerationJob[])) => void;
    activeJobCount: number;
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
    refreshNavyChatModels: () => Promise<void>;
    saveChatImages: (payload: {
        images: { id: string; dataUrl: string; mimeType: string; model?: string }[];
        prompt: string;
        model: string;
        provider: Provider;
    }) => Promise<void>;

    // Logic
    // Logic
    handleGenerate: (options?: GenerateOptions) => void;
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
    const [apiKeys, setApiKeys] = useState<ProviderKeys>({
        gemini: "",
        navy: "",
        chutes: "",
        openrouter: "",
        nanogpt: "",
    });
    const [keyStorageMode, setKeyStorageMode] = useState<KeyStorageMode>("session");
    const [legacyProviderKeys, setLegacyProviderKeys] = useState<LegacyProviderKey[]>([]);
    const apiKey = apiKeys[provider] ?? "";
    const [model, setModel] = useState(DEFAULT_MODELS.gemini.image);

    // --- Dynamic Models ---
    const [openRouterImageModels, setOpenRouterImageModels] = useState<ModelOption[]>(OPENROUTER_IMAGE_MODELS);
    const [navyImageModels, setNavyImageModels] = useState<ModelOption[]>(NAVY_IMAGE_MODELS);
    const [navyVideoModels, setNavyVideoModels] = useState<ModelOption[]>(NAVY_VIDEO_MODELS);
    const [navyTtsModels, setNavyTtsModels] = useState<ModelOption[]>(NAVY_TTS_MODELS);
    const [nanoGptImageModels, setNanoGptImageModels] = useState<ModelOption[]>(NANOGPT_IMAGE_MODELS);
    const [nanoGptVideoModels, setNanoGptVideoModels] = useState<ModelOption[]>(NANOGPT_VIDEO_MODELS);

    // --- Settings ---
    const [prompt, setPrompt] = useState("");
    const [negativePrompt, setNegativePrompt] = useState("");
    const [imageCount, setImageCount] = useState(1);
    const [imagePipelineEnabled, setImagePipelineEnabled] = useState(false);
    const [imageModelOrder, setImageModelOrder] = useState<string[]>([]);
    const [imageRetryAttempts, setImageRetryAttempts] = useState(DEFAULT_IMAGE_RETRY_ATTEMPTS);
    const [imageAspect, setImageAspect] = useState(AUTO_IMAGE_OPTION);
    const [imageSize, setImageSize] = useState(AUTO_IMAGE_OPTION);
    const [navyImageSize, setNavyImageSize] = useState(AUTO_IMAGE_OPTION);
    const [navyImageQuality, setNavyImageQuality] = useState(AUTO_IMAGE_OPTION);
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
    const [modelParameterValuesByModel, setModelParameterValuesByModel] = useState<
        Record<string, ModelParameterValues>
    >({});

    // --- Chat Helper State ---
    const [chatProvider, setChatProvider] = useState<ChatProvider>("chutes");
    const [chutesChatModels, setChutesChatModels] = useState<ModelOption[]>(CHUTES_LLM_MODELS);
    const [chutesChatModel, setChutesChatModel] = useState(CHUTES_LLM_MODELS[0]?.id ?? "");
    const [chutesToolImageModel, setChutesToolImageModel] = useState(CHUTES_IMAGE_MODELS[0]?.id ?? "z-image-turbo");
    const [chutesChatModelsLoading, setChutesChatModelsLoading] = useState(false);
    const [chutesChatModelsError, setChutesChatModelsError] = useState<string | null>(null);
    const [navyChatModels, setNavyChatModels] = useState<ModelOption[]>(NAVY_CHAT_MODELS);
    const [navyChatModel, setNavyChatModel] = useState(NAVY_CHAT_MODELS[0]?.id ?? "");
    const [navyToolImageModel, setNavyToolImageModel] = useState(NAVY_IMAGE_MODELS[0]?.id ?? "flux");
    const [navyChatModelsLoading, setNavyChatModelsLoading] = useState(false);
    const [navyChatModelsError, setNavyChatModelsError] = useState<string | null>(null);

    // --- App Logic State ---
    const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
    const [savedMedia, setSavedMedia] = useState<StoredMedia[]>([]);
    const [references, setReferences] = useState<StoredReference[]>([]);
    const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
    const [videoUrl, setVideoUrl] = useState<string | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioMimeType, setAudioMimeType] = useState<string | null>(null);

    const [jobs, setJobs] = useState<GenerationJob[]>([]);
    const [statusMessage, setStatusMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const [modelsLoading, setModelsLoading] = useState(false);
    const [modelsError, setModelsError] = useState<string | null>(null);
    const [lastOutput, setLastOutput] = useState<{ mode: Mode; prompt: string; model: string; provider: Provider; ttsVoice?: string; mediaIds?: string[] } | null>(null);

    const [storageSnapshot, setStorageSnapshot] = useState<StorageSnapshot | null>(null);
    const [storageError, setStorageError] = useState<string | null>(null);

    const [navyUsage, setNavyUsage] = useState<NavyUsageResponse | null>(null);
    const [navyUsageError, setNavyUsageError] = useState<string | null>(null);
    const [navyUsageLoading, setNavyUsageLoading] = useState(false);
    const [navyUsageUpdatedAt, setNavyUsageUpdatedAt] = useState<string | null>(null);
    const [queueTick, setQueueTick] = useState(0);

    // --- Refs ---
    const galleryUrlsRef = useRef(new Map<string, string>());
    const navyUsageLoadingRef = useRef(false);
    const processingRef = useRef(new Set<string>());
    const lastProviderModeRef = useRef(`${provider}:${mode}`);

    // --- Computed ---
    const supportsVideo = provider === "gemini" || provider === "navy" || provider === "chutes" || provider === "nanogpt";
    const supportsTts = provider === "navy" || provider === "chutes";
    const idbAvailable = useMemo(() => isIndexedDbAvailable(), []);

    const setApiKeyForProvider = useCallback((target: Provider, key: string) => {
        setApiKeys((prev) => ({ ...prev, [target]: key }));
    }, []);

    const setApiKey = useCallback(
        (key: string) => {
            setApiKeyForProvider(provider, key);
        },
        [provider, setApiKeyForProvider]
    );

    const migrateLegacyProviderKeys = useCallback((modeOverride?: KeyStorageMode) => {
        const nextMode = modeOverride ?? keyStorageMode;
        const legacyKeys = detectLegacyProviderKeys();
        const nextKeys: ProviderKeys = { ...apiKeys };
        for (const legacyKey of legacyKeys) {
            nextKeys[legacyKey.provider] = legacyKey.key;
        }
        setKeyStorageMode(nextMode);
        setApiKeys(nextKeys);
        persistProviderKeys(nextMode, nextKeys);
        removeLegacyProviderKeys();
        markLegacyKeyMigrationDismissed();
        setLegacyProviderKeys([]);
    }, [apiKeys, keyStorageMode]);

    const discardLegacyProviderKeys = useCallback(() => {
        removeLegacyProviderKeys();
        markLegacyKeyMigrationDismissed();
        setLegacyProviderKeys([]);
    }, []);

    const clearAllKeys = useCallback(() => {
        clearAllProviderKeys();
        setApiKeys({
            gemini: "",
            navy: "",
            chutes: "",
            openrouter: "",
            nanogpt: "",
        });
        setLegacyProviderKeys([]);
    }, []);

    const refreshNavyCatalog = useCallback(async () => {
        const key = apiKeys.navy.trim();
        const response = await fetch("/api/navy/models", {
            headers: key
                ? {
                    "x-user-api-key": key,
                }
                : undefined,
        });
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload?.error ?? "Failed to fetch NavyAI models");
        }
        const rawModels = sanitizeModelOptions(payload?.data ?? []);
        const imageModels = sanitizeModelOptions(payload?.image ?? payload?.images ?? []);
        const videoModels = sanitizeModelOptions(payload?.video ?? payload?.videos ?? []);
        const audioModels = sanitizeModelOptions(payload?.audio ?? payload?.tts ?? []);
        const chatModels = sanitizeModelOptions(payload?.chat ?? payload?.llm ?? payload?.text ?? []);

        const hasBucketedPayload =
            imageModels.length > 0 ||
            videoModels.length > 0 ||
            audioModels.length > 0 ||
            chatModels.length > 0;

        if (hasBucketedPayload) {
            setNavyImageModels(
                imageModels.length
                    ? mergeModelOptions(NAVY_IMAGE_MODELS, imageModels)
                    : NAVY_IMAGE_MODELS
            );
            setNavyVideoModels(
                videoModels.length
                    ? mergeModelOptions(NAVY_VIDEO_MODELS, videoModels)
                    : NAVY_VIDEO_MODELS
            );
            setNavyTtsModels(
                audioModels.length
                    ? mergeModelOptions(NAVY_TTS_MODELS, audioModels)
                    : NAVY_TTS_MODELS
            );
            setNavyChatModels(
                chatModels.length
                    ? mergeModelOptions(NAVY_CHAT_MODELS, chatModels)
                    : NAVY_CHAT_MODELS
            );
            return;
        }

        // Fallback for unexpected unbucketed responses.
        if (rawModels.length) {
            setNavyChatModels(mergeModelOptions(NAVY_CHAT_MODELS, rawModels));
            return;
        }

        throw new Error("No models returned by NavyAI.");
    }, [apiKeys.navy]);

    const refreshNanoGptCatalog = useCallback(async (targetMode: "image" | "video") => {
        const response = await fetch(`/api/nanogpt/models?mode=${targetMode}`);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload?.error ?? "Failed to fetch NanoGPT models.");
        }
        const models = sanitizeModelOptions(payload?.models ?? []);
        if (!models.length) {
            throw new Error(`NanoGPT returned no ${targetMode} models.`);
        }
        if (targetMode === "image") {
            setNanoGptImageModels(models);
        } else {
            setNanoGptVideoModels(models);
        }
    }, []);

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
        if (provider === "nanogpt") {
            if (mode === "image") return nanoGptImageModels;
            if (mode === "video") return nanoGptVideoModels;
            return [];
        }
        if (mode === "video") return navyVideoModels;
        if (mode === "tts") return navyTtsModels;
        return navyImageModels;
    }, [
        provider,
        mode,
        openRouterImageModels,
        navyImageModels,
        navyVideoModels,
        navyTtsModels,
        nanoGptImageModels,
        nanoGptVideoModels,
    ]);
    const selectedModelOption = useMemo(
        () => modelSuggestions.find((entry) => entry.id === model),
        [modelSuggestions, model]
    );
    const modelParameterValues = useMemo(
        () =>
            resolveModelParameterValues(
                selectedModelOption,
                modelParameterValuesByModel[model]
            ),
        [selectedModelOption, modelParameterValuesByModel, model]
    );
    const setModelParameterValue = useCallback(
        (key: string, value: ModelParameterValue) => {
            setModelParameterValuesByModel((previous) => ({
                ...previous,
                [model]: resolveModelParameterValues(selectedModelOption, {
                    ...previous[model],
                    [key]: value,
                }),
            }));
        },
        [model, selectedModelOption]
    );

    useEffect(() => {
        if (provider !== "nanogpt" || mode !== "image" || !selectedModelOption) {
            return;
        }
        const fixedCount = selectedModelOption.fixedOutputImages;
        const maxCount = selectedModelOption.maxOutputImages;
        if (typeof fixedCount === "number" && fixedCount > 0 && imageCount !== fixedCount) {
            setImageCount(fixedCount);
        } else if (
            typeof maxCount === "number" &&
            maxCount > 0 &&
            imageCount > maxCount
        ) {
            setImageCount(maxCount);
        }

        const resolutions = selectedModelOption.supportedResolutions ?? [];
        if (resolutions.length && !resolutions.includes(chutesResolution)) {
            setChutesResolution(resolutions[0]);
        }
    }, [
        provider,
        mode,
        selectedModelOption,
        imageCount,
        chutesResolution,
    ]);

    const runningJobs = jobs.filter((job) => job.status === "running");
    const queuedJobs = jobs.filter((job) => job.status === "queued");
    const activeJobCount = getActiveJobCount(jobs);
    const hasActiveJobs = activeJobCount > 0;
    const recentJobs = jobs.slice(-4).reverse();
    const resolvedImageModelOrder = useMemo(
        () =>
            resolveImageGenerationModelPipeline(
                imageModelOrder,
                model,
                modelSuggestions.map((entry) => entry.id)
            ),
        [imageModelOrder, model, modelSuggestions]
    );
    const selectedReferences = useMemo(() => {
        const selected = new Set(selectedReferenceIds);
        return references.filter((reference) => selected.has(reference.id));
    }, [references, selectedReferenceIds]);

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
        items: { url: string; mimeType?: string; blob?: Blob; model?: string }[],
        metadata: {
            prompt: string;
            model: string;
            provider: Provider;
            saveToGallery: boolean;
            kind: StoredMedia["kind"];
        }
    ): Promise<StoredMedia[]> => {
        if (!metadata.saveToGallery || items.length === 0) return [];
        try {
            const entries: StoredMedia[] = [];
            for (const item of items) {
                const id = createId();
                let blob = item.blob;
                let mimeType = item.mimeType;
                const model = item.model ?? metadata.model;
                if (!idbAvailable) {
                    entries.push({ id, dataUrl: item.url, prompt: metadata.prompt, model, provider: metadata.provider, createdAt: new Date().toISOString(), kind: metadata.kind, mimeType });
                    continue;
                }
                if (!blob) {
                    try {
                        const response = await fetch(item.url);
                        if (!response.ok) throw new Error("Fetch failed");
                        blob = await response.blob();
                        mimeType = mimeType ?? blob.type;
                    } catch {
                        entries.push({ id, dataUrl: item.url, prompt: metadata.prompt, model, provider: metadata.provider, createdAt: new Date().toISOString(), kind: metadata.kind, mimeType });
                        continue;
                    }
                }
                await putGalleryBlob(id, blob);
                const url = URL.createObjectURL(blob);
                galleryUrlsRef.current.set(id, url);
                entries.push({ id, dataUrl: url, prompt: metadata.prompt, model, provider: metadata.provider, createdAt: new Date().toISOString(), kind: metadata.kind, mimeType: mimeType ?? blob.type });
            }
            if (entries.length) {
                setSavedMedia((prev) => [...entries, ...prev].slice(0, MAX_SAVED_MEDIA));
            }
            return entries;
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : "Gallery save failed");
            return [];
        }
    };

    const addReferenceFile = useCallback(async (file: File, role: ReferenceRole = "general") => {
        if (!file.type.startsWith("image/")) {
            setErrorMessage("Only image references are supported.");
            return;
        }
        const id = createId();
        const blobKey = `reference:${id}`;
        const objectUrl = URL.createObjectURL(file);
        const entry: StoredReference = {
            id,
            role,
            label: file.name,
            dataUrl: objectUrl,
            blobKey,
            mimeType: file.type || "image/png",
            createdAt: new Date().toISOString(),
            size: file.size,
        };

        try {
            if (idbAvailable) {
                await putGalleryBlob(blobKey, file);
                await putReferenceRecord({ ...entry, dataUrl: "" });
            }
            setReferences((prev) => [entry, ...prev].slice(0, MAX_REFERENCES));
            setSelectedReferenceIds((prev) => [id, ...prev.filter((entryId) => entryId !== id)]);
        } catch (error) {
            URL.revokeObjectURL(objectUrl);
            setErrorMessage(error instanceof Error ? error.message : "Reference save failed.");
        }
    }, [idbAvailable]);

    const removeReference = useCallback(async (id: string) => {
        setReferences((prev) => {
            const target = prev.find((reference) => reference.id === id);
            if (target?.dataUrl.startsWith("blob:")) URL.revokeObjectURL(target.dataUrl);
            return prev.filter((reference) => reference.id !== id);
        });
        setSelectedReferenceIds((prev) => prev.filter((entryId) => entryId !== id));
        try {
            await deleteReferenceRecord(id);
            await deleteGalleryBlob(`reference:${id}`);
        } catch {
            // Reference metadata cleanup is best-effort.
        }
    }, []);

    const toggleReferenceSelection = useCallback((id: string) => {
        setSelectedReferenceIds((prev) =>
            prev.includes(id)
                ? prev.filter((entryId) => entryId !== id)
                : [...prev, id].slice(-MAX_REFERENCES)
        );
    }, []);

    const clearSelectedReferences = useCallback(() => {
        setSelectedReferenceIds([]);
    }, []);

    const buildSelectedReferencePayload = useCallback(async (ids = selectedReferenceIds) => {
        const selected = new Set(ids);
        const payload: Array<{ dataUrl: string; role?: string }> = [];
        for (const reference of references.filter((entry) => selected.has(entry.id))) {
            try {
                const dataUrl = reference.dataUrl.startsWith("data:")
                    ? reference.dataUrl
                    : await fetchAsDataUrl(reference.dataUrl);
                payload.push({ dataUrl, role: reference.role });
            } catch {
                // Skip references that can no longer be read from local storage.
            }
        }
        return payload;
    }, [references, selectedReferenceIds]);

    const resolveVideoSourceImage = useCallback(async (ids = selectedReferenceIds) => {
        if (videoImage) return videoImage;
        const selected = new Set(ids);
        const jobReferences = references.filter((reference) => selected.has(reference.id));
        const source =
            jobReferences.find((reference) => reference.role === "source_image") ??
            jobReferences.find((reference) => reference.role === "first_frame") ??
            jobReferences[0];
        if (!source) return null;
        try {
            return source.dataUrl.startsWith("data:")
                ? source.dataUrl
                : await fetchAsDataUrl(source.dataUrl);
        } catch {
            return null;
        }
    }, [references, selectedReferenceIds, videoImage]);

    const generateImages = async (job: GenerationJob) => {
        startJob(job, "Generating image...");
        try {
            const requestHeaders = {
                "Content-Type": "application/json",
                "x-user-api-key": job.apiKey,
            };
            const referenceImages = await buildSelectedReferencePayload(job.referenceIds);
            const imageSizing = resolveImageSizingOptions(job.provider, {
                imageAspect: job.imageAspect,
                imageSize: job.imageSize,
                navyImageSize: job.navyImageSize,
            });
            let generationBilling: GenerationBilling | undefined;
            let providerRequestId: string | undefined;

            const images = await retryAsyncOperation<GeneratedImage[]>({
                maxAttempts: job.remoteJobId ? 1 : job.imageRetryAttempts,
                onAttempt: ({ attempt, maxAttempts }) => {
                    if (maxAttempts <= 1) return;
                    updateJob(job.id, {
                        progress: `Generating image with ${job.model} (try ${attempt}/${maxAttempts})...`,
                    });
                },
                onError: ({ attempt, maxAttempts, error, final }) => {
                    if (final) return;
                    const message =
                        error instanceof Error ? error.message : "Image generation failed.";
                    updateJob(job.id, {
                        progress: `Retrying ${job.model} after try ${attempt}/${maxAttempts}: ${message}`,
                    });
                },
                run: async ({ attempt, maxAttempts }) => {
                    const attemptLabel =
                        maxAttempts > 1 ? ` (try ${attempt}/${maxAttempts})` : "";
                    let images: GeneratedImage[] = [];
                    let url = `/api/${job.provider}/image`;
                    let body: Record<string, unknown> = {
                        model: job.model,
                        prompt: job.prompt,
                    };

                    if (job.provider === "gemini") {
                        body = {
                            ...body,
                            ...imageSizing,
                            numberOfImages: job.imageCount,
                            referenceImages,
                        };
                    } else if (job.provider === "openrouter") {
                        body = {
                            ...body,
                            ...imageSizing,
                            outputModalities: job.outputModalities,
                            referenceImages,
                        };
                    } else if (job.provider === "navy") {
                        const imageUrl = buildNavyImageUrlPayload(referenceImages);
                        body = {
                            ...body,
                            ...imageSizing,
                            quality: job.navyImageQuality,
                            negativePrompt: job.negativePrompt,
                            promptAgentModel: job.promptAgentModel,
                            imageUrl,
                            sync: false,
                        };
                    } else if (job.provider === "nanogpt") {
                        const selectedNanoGptModel = nanoGptImageModels.find(
                            (entry) => entry.id === job.model
                        );
                        const catalogParameters = job.modelParameters ?? {};
                        const supportsReferenceImages =
                            selectedNanoGptModel?.supports?.referenceImages === true;
                        const maxReferenceImages = supportsReferenceImages
                            ? selectedNanoGptModel?.maxReferenceImages ?? 1
                            : 0;
                        const catalogResolution =
                            typeof catalogParameters.resolution === "string"
                                ? catalogParameters.resolution
                                : "";
                        const requestedResolution =
                            catalogResolution ||
                            (job.imageSize && job.imageSize !== AUTO_IMAGE_OPTION
                                ? job.imageSize
                                : job.chutesResolution ?? "");
                        const supportedResolutions =
                            selectedNanoGptModel?.supportedResolutions ?? [];
                        const resolution =
                            !supportedResolutions.length ||
                                supportedResolutions.includes(requestedResolution)
                                ? requestedResolution
                                : supportedResolutions.includes(AUTO_IMAGE_OPTION)
                                    ? AUTO_IMAGE_OPTION
                                    : supportedResolutions[0];
                        body = {
                            ...body,
                            parameters: catalogParameters,
                            resolution,
                            numberOfImages: job.imageCount,
                            input_references: referenceImages
                                .slice(0, maxReferenceImages)
                                .map((reference) => reference.dataUrl),
                            seed: selectedNanoGptModel?.supports?.seed
                                ? typeof catalogParameters.seed === "number"
                                    ? catalogParameters.seed
                                    : Number(job.chutesSeed) || null
                                : null,
                            modelCapabilities: {
                                supportedResolutions,
                                maxOutputImages: selectedNanoGptModel?.maxOutputImages,
                                fixedOutputImages: selectedNanoGptModel?.fixedOutputImages,
                                maxReferenceImages,
                                supportsReferenceImages,
                            },
                        };
                    } else {
                        url = "/api/chutes/image";
                        body = {
                            ...body,
                            negativePrompt: job.negativePrompt,
                            guidanceScale: Number(job.chutesGuidanceScale),
                            width: Number(job.chutesWidth),
                            height: Number(job.chutesHeight),
                            numInferenceSteps: Number(job.chutesSteps),
                            resolution: job.chutesResolution,
                            seed: Number(job.chutesSeed) || null,
                        };
                    }

                    let payload: Record<string, unknown> = {};
                    if (job.provider === "navy" && job.remoteJobId) {
                        updateJob(job.id, {
                            progress: `Resuming Navy image job ${job.remoteJobId}...`,
                        });
                        payload = { id: job.remoteJobId };
                    } else {
                        updateJob(job.id, {
                            progress: `Submitting image request to ${job.model}${attemptLabel}...`,
                        });
                        const response = await fetch(url, {
                            method: "POST",
                            headers: requestHeaders,
                            body: JSON.stringify(body),
                        });
                        payload = await response.json();
                        if (!response.ok) {
                            throw new Error(errorMessageFromPayload(payload, "Image generation failed."));
                        }
                    }

                    if (job.provider === "navy") {
                        let navyPayload = payload;
                        const existingJobId = job.remoteJobId;
                        const submittedJobId =
                            typeof payload?.id === "string" ? payload.id : existingJobId;
                        if (typeof submittedJobId === "string" && submittedJobId) {
                            updateJob(job.id, {
                                remoteJobId: submittedJobId,
                                remoteStatus:
                                    typeof payload?.status === "string" ? payload.status : undefined,
                            });
                            let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
                            let didComplete = Boolean(navyPayload?.done);
                            for (let pollAttempt = 0; pollAttempt < NAVY_JOB_POLL_MAX_ATTEMPTS && !didComplete; pollAttempt += 1) {
                                updateJob(job.id, {
                                    progress: `Waiting for Navy image render${attemptLabel} (${pollAttempt + 1}/${NAVY_JOB_POLL_MAX_ATTEMPTS})...`,
                                });
                                await sleep(delayMs);
                                const pollResponse = await fetch(
                                    `/api/navy/image?id=${encodeURIComponent(submittedJobId)}`,
                                    {
                                        headers: {
                                            "x-user-api-key": job.apiKey,
                                        },
                                    }
                                );
                                navyPayload = await pollResponse.json();
                                if (!pollResponse.ok && pollResponse.status !== 429) {
                                    throw new Error(errorMessageFromPayload(navyPayload, "Unable to poll Navy image job."));
                                }
                                didComplete = Boolean(navyPayload?.done);
                                delayMs = resolveNavyJobPollDelayMs({
                                    payload: navyPayload,
                                    responseStatus: pollResponse.status,
                                    currentDelayMs: delayMs,
                                });
                                if (!didComplete && (pollResponse.status === 429 || navyPayload?.status === "rate_limited")) {
                                    updateJob(job.id, {
                                        remoteStatus: "rate_limited",
                                        progress: `Navy is rate limiting polls; retrying in ${Math.ceil(delayMs / 1000)}s...`,
                                    });
                                }
                            }
                            if (!didComplete) {
                                throw new Error("Timed out waiting for the Navy image job.");
                            }
                        }

                        const navyImages = Array.isArray(navyPayload?.images)
                            ? (navyPayload.images as Array<{
                                url?: string;
                                b64_json?: string;
                                data?: string;
                                mimeType?: string;
                                mime_type?: string;
                            }>)
                            : [];
                        for (const image of navyImages) {
                            const base64Data =
                                typeof image?.data === "string" && image.data
                                    ? image.data
                                    : typeof image?.b64_json === "string" && image.b64_json
                                        ? image.b64_json
                                        : "";
                            if (base64Data) {
                                const mimeType =
                                    typeof image.mimeType === "string"
                                        ? image.mimeType
                                        : typeof image.mime_type === "string"
                                            ? image.mime_type
                                            : "image/png";
                                images.push({
                                    id: createId(),
                                    dataUrl: dataUrlFromBase64(base64Data, mimeType),
                                    mimeType,
                                });
                                continue;
                            }
                            if (!image?.url) continue;
                            const dataUrl = await fetchAsDataUrl(image.url);
                            images.push({ id: createId(), dataUrl, mimeType: "image/png" });
                        }
                    } else {
                        if (job.provider === "nanogpt") {
                            const metadata = generationMetadataFromPayload(payload);
                            generationBilling = metadata.billing;
                            providerRequestId = metadata.requestId;
                        }
                        images = buildGeneratedImages(payload);
                    }

                    if (!images.length) {
                        throw new Error("No images were returned by the model.");
                    }

                    return images;
                },
            });

            const finalizedImages = images.map((image, index) => ({
                ...image,
                model: job.model,
                provider: job.provider,
                prompt: job.prompt,
                batchId: job.batchId,
                batchCreatedAt: job.batchCreatedAt ?? job.createdAt,
                batchOrder: job.batchOrder ?? 0,
                imageOrder: index,
                createdAt: new Date().toISOString(),
            }));

            for (let index = 0; index < finalizedImages.length; index += 1) {
                const image = finalizedImages[index];
                updateJob(job.id, {
                    progress: `Received image ${index + 1}/${finalizedImages.length} from ${job.model}.`,
                });
                React.startTransition(() => {
                    setGeneratedImages((prev) =>
                        mergeGeneratedImagesInDisplayOrder(prev, [image])
                    );
                });
                await yieldToPaint();
            }
            const galleryEntries = await addMediaToGallery(
                images.map((image) => ({ url: image.dataUrl, mimeType: image.mimeType })),
                {
                    prompt: job.prompt,
                    model: job.model,
                    provider: job.provider,
                    saveToGallery: job.saveToGallery,
                    kind: "image",
                }
            );
            setLastOutput({
                mode: "image",
                prompt: job.prompt,
                model: job.model,
                provider: job.provider,
                mediaIds: galleryEntries.length
                    ? galleryEntries.map((entry) => entry.id)
                    : undefined,
            });
            completeJob(
                job.id,
                {
                    billing: generationBilling,
                    requestId: providerRequestId,
                },
                `Generated ${images.length} image${images.length === 1 ? "" : "s"} with ${job.model}${
                    typeof generationBilling?.cost === "number"
                        ? ` for ${generationBilling.cost.toFixed(4)} ${generationBilling.paymentSource ?? "USD"}`
                        : ""
                }.`
            );
        } catch (error) {
            failJob(
                job.id,
                error instanceof Error ? error.message : "Image generation failed"
            );
        }
    };

    const generateVideo = async (job: GenerationJob) => {
        startJob(job, "Generating Video...");
        try {
            let response: Response;
            const requestHeaders = {
                "Content-Type": "application/json",
                "x-user-api-key": job.apiKey,
            };
            const sourceImage = job.videoImage || await resolveVideoSourceImage(job.referenceIds);
            const referenceImages = await buildSelectedReferencePayload(job.referenceIds);

            if (job.provider === "chutes") {
                response = await fetch("/api/chutes/video", {
                    method: "POST",
                    headers: requestHeaders,
                    body: JSON.stringify({
                        prompt: job.prompt,
                        model: job.model,
                        image: sourceImage,
                        fps: job.chutesVideoFps,
                        guidance_scale_2: job.chutesVideoGuidanceScale,
                    }),
                });
            } else if (job.provider === "gemini") {
                let operationName = job.remoteOperationName ?? "";
                if (!operationName) {
                    const submitResponse = await fetch("/api/gemini/video", {
                        method: "POST",
                        headers: requestHeaders,
                        body: JSON.stringify({
                            prompt: job.prompt,
                            model: job.model,
                            aspectRatio: job.videoAspect,
                            resolution: job.videoResolution,
                            durationSeconds: job.videoDuration,
                            negativePrompt: job.negativePrompt,
                            sourceImage,
                            referenceImages,
                        }),
                    });
                    const submitPayload = await submitResponse.json();
                    if (!submitResponse.ok) {
                        throw new Error(errorMessageFromPayload(submitPayload, "Video generation failed."));
                    }

                    operationName =
                        typeof submitPayload?.name === "string" ? submitPayload.name : "";
                    if (operationName) {
                        updateJob(job.id, { remoteOperationName: operationName });
                    }
                }
                if (!operationName) {
                    throw new Error("No Veo operation name returned.");
                }

                let videoUri = "";
                for (let attempt = 0; attempt < 60; attempt += 1) {
                    updateJob(job.id, {
                        progress: `Waiting for Veo render (${attempt + 1}/60)...`,
                    });
                    await sleep(10000);
                    const pollResponse = await fetch(
                        `/api/gemini/video?name=${encodeURIComponent(operationName)}`,
                        {
                            headers: {
                                "x-user-api-key": job.apiKey,
                            },
                        }
                    );
                    const pollPayload = await pollResponse.json();
                    if (!pollResponse.ok) {
                        throw new Error(pollPayload?.error ?? "Unable to poll Veo job.");
                    }
                    if (pollPayload?.done && typeof pollPayload?.videoUri === "string") {
                        videoUri = pollPayload.videoUri;
                        break;
                    }
                }

                if (!videoUri) {
                    throw new Error("Timed out waiting for the Veo render.");
                }

                response = await fetch("/api/gemini/video/download", {
                    method: "POST",
                    headers: requestHeaders,
                    body: JSON.stringify({
                        uri: videoUri,
                    }),
                });
            } else if (job.provider === "navy") {
                let submitPayload: Record<string, unknown> = {};
                if (job.remoteJobId) {
                    submitPayload = { id: job.remoteJobId };
                } else {
                    const imageUrl = buildNavyImageUrlPayload(referenceImages, sourceImage);
                    const submitResponse = await fetch("/api/navy/video", {
                        method: "POST",
                        headers: requestHeaders,
                        body: JSON.stringify({
                            prompt: job.prompt,
                            model: job.model,
                            imageUrl,
                            negativePrompt: job.negativePrompt,
                            seconds: Number(job.videoDuration),
                            aspectRatio: job.videoAspect,
                        }),
                    });
                    submitPayload = await submitResponse.json();
                    if (!submitResponse.ok) {
                        throw new Error(
                            typeof submitPayload?.error === "string"
                                ? submitPayload.error
                                : "Video generation failed."
                        );
                    }
                }

                let remoteVideoUrl =
                    typeof submitPayload?.videoUrl === "string"
                        ? submitPayload.videoUrl
                        : "";
                const generationId =
                    typeof submitPayload?.id === "string"
                        ? submitPayload.id
                        : job.remoteJobId ?? "";
                if (!generationId && !remoteVideoUrl) {
                    throw new Error("No Navy generation id returned.");
                }
                if (generationId) {
                    updateJob(job.id, { remoteJobId: generationId });
                }

                if (!remoteVideoUrl) {
                    for (let attempt = 0; attempt < NAVY_JOB_POLL_MAX_ATTEMPTS; attempt += 1) {
                        updateJob(job.id, {
                            progress: `Waiting for Navy render (${attempt + 1}/${NAVY_JOB_POLL_MAX_ATTEMPTS})...`,
                        });
                        await sleep(NAVY_JOB_POLL_INTERVAL_MS);
                        const pollResponse = await fetch(
                            `/api/navy/video?id=${encodeURIComponent(generationId)}`,
                            {
                                headers: {
                                    "x-user-api-key": job.apiKey,
                                },
                            }
                        );
                        const pollPayload = await pollResponse.json();
                        if (!pollResponse.ok) {
                            throw new Error(
                                pollPayload?.error ?? "Unable to poll Navy video job."
                            );
                        }
                        if (pollPayload?.done && typeof pollPayload?.videoUrl === "string") {
                            remoteVideoUrl = pollPayload.videoUrl;
                            break;
                        }
                    }
                }

                if (!remoteVideoUrl) {
                    throw new Error("Timed out waiting for the Navy render.");
                }

                response = await fetch("/api/navy/video/download", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-user-api-key": job.apiKey,
                    },
                    body: JSON.stringify({
                        url: remoteVideoUrl,
                    }),
                });
            } else if (job.provider === "nanogpt") {
                const selectedNanoGptModel = nanoGptVideoModels.find(
                    (entry) => entry.id === job.model
                );
                const catalogParameters = job.modelParameters ?? {};
                const parameters = Object.keys(catalogParameters).length
                    ? catalogParameters
                    : {
                        aspect_ratio: job.videoAspect,
                        resolution: job.videoResolution,
                        duration: job.videoDuration,
                    };
                let generationId = job.remoteJobId ?? "";
                let billing = job.billing;

                if (!generationId) {
                    const maxReferenceImages =
                        selectedNanoGptModel?.supports?.referenceImages === true
                            ? selectedNanoGptModel.maxReferenceImages ?? 1
                            : 0;
                    const submitResponse = await fetch("/api/nanogpt/video", {
                        method: "POST",
                        headers: requestHeaders,
                        body: JSON.stringify({
                            prompt: job.prompt,
                            model: job.model,
                            parameters,
                            sourceImage:
                                selectedNanoGptModel?.supports?.sourceImage === true
                                    ? sourceImage
                                    : undefined,
                            referenceImages: referenceImages
                                .slice(0, maxReferenceImages)
                                .map((reference) => reference.dataUrl),
                        }),
                    });
                    const submitPayload = await submitResponse.json();
                    if (!submitResponse.ok) {
                        throw new Error(
                            errorMessageFromPayload(
                                submitPayload,
                                "NanoGPT video generation failed."
                            )
                        );
                    }
                    generationId =
                        typeof submitPayload?.id === "string"
                            ? submitPayload.id
                            : typeof submitPayload?.runId === "string"
                                ? submitPayload.runId
                                : "";
                    billing = generationMetadataFromPayload(submitPayload).billing;
                    if (generationId) {
                        updateJob(job.id, {
                            remoteJobId: generationId,
                            remoteStatus:
                                typeof submitPayload?.status === "string"
                                    ? submitPayload.status
                                    : "pending",
                            billing,
                        });
                    }
                }

                if (!generationId) {
                    throw new Error("No NanoGPT video run id returned.");
                }

                let completed = false;
                let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
                for (
                    let attempt = 0;
                    attempt < NAVY_JOB_POLL_MAX_ATTEMPTS && !completed;
                    attempt += 1
                ) {
                    updateJob(job.id, {
                        progress: `Waiting for NanoGPT render (${attempt + 1}/${NAVY_JOB_POLL_MAX_ATTEMPTS})...`,
                    });
                    await sleep(delayMs);
                    const pollResponse = await fetch(
                        `/api/nanogpt/video?id=${encodeURIComponent(generationId)}`,
                        { headers: { "x-user-api-key": job.apiKey } }
                    );
                    const pollPayload = await pollResponse.json();
                    if (!pollResponse.ok) {
                        throw new Error(
                            errorMessageFromPayload(
                                pollPayload,
                                "Unable to poll NanoGPT video job."
                            )
                        );
                    }
                    const pollMetadata = generationMetadataFromPayload(pollPayload);
                    billing = pollMetadata.billing ?? billing;
                    const remoteStatus =
                        typeof pollPayload?.status === "string"
                            ? pollPayload.status
                            : undefined;
                    updateJob(job.id, { remoteStatus, billing });
                    completed = pollPayload?.done === true;
                    delayMs = resolveNavyJobPollDelayMs({
                        payload: pollPayload,
                        responseStatus: pollResponse.status,
                        currentDelayMs: delayMs,
                    });
                }
                if (!completed) {
                    throw new Error("Timed out waiting for the NanoGPT video render.");
                }

                response = await fetch("/api/nanogpt/video/download", {
                    method: "POST",
                    headers: requestHeaders,
                    body: JSON.stringify({ id: generationId }),
                });
            } else {
                throw new Error("Video generation is not available for this provider.");
            }

            if (!response.ok) {
                let message = "Failed to generate video";
                const errorContentType = response.headers.get("content-type") ?? "";
                if (errorContentType.includes("application/json")) {
                    try {
                        message = errorMessageFromPayload(await response.json(), message);
                    } catch {
                        // Keep the concise fallback when the route returns invalid JSON.
                    }
                } else {
                    const errText = await response.text();
                    message = errText || message;
                }
                throw new Error(message);
            }

            const contentType = response.headers.get("content-type") ?? "";
            let videoUrl: string | null = null;
            let videoBlob: Blob | undefined;
            let videoMimeType: string | undefined;

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
                    videoMimeType = mimeType;
                    videoUrl = dataUrlFromBase64(data.data, mimeType);
                }
            } else {
                const blob = await response.blob();
                videoBlob = blob;
                videoMimeType = blob.type || "video/mp4";
                videoUrl = URL.createObjectURL(blob);
            }

            if (!videoUrl) throw new Error("No video data received.");

            setVideoUrl(videoUrl);
            const galleryEntries = await addMediaToGallery(
                [{ url: videoUrl, mimeType: videoMimeType, blob: videoBlob }],
                {
                    prompt: job.prompt,
                    model: job.model,
                    provider: job.provider,
                    saveToGallery: job.saveToGallery,
                    kind: "video",
                }
            );
            setLastOutput({
                mode: "video",
                prompt: job.prompt,
                model: job.model,
                provider: job.provider,
                mediaIds: galleryEntries.length
                    ? galleryEntries.map((entry) => entry.id)
                    : undefined,
            });
            completeJob(job.id, { videoUrl }, "Video ready.");
        } catch (error) {
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
            if (job.provider === "chutes") {
                const normalizedModel = (job.model || "").toLowerCase();
                const isCsm = normalizedModel === "csm-1b";
                const response = await fetch("/api/chutes/audio", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-user-api-key": job.apiKey,
                    },
                    body: JSON.stringify({
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
                let audioBlob: Blob | undefined;

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
                    audioBlob = blob;
                    audioDataUrl = URL.createObjectURL(blob);
                    audioMime = blob.type;
                }

                if (!audioDataUrl) throw new Error("No audio data received.");

                setAudioUrl(audioDataUrl);
                setAudioMimeType(audioMime);
                const galleryEntries = await addMediaToGallery(
                    [{ url: audioDataUrl, mimeType: audioMime ?? undefined, blob: audioBlob }],
                    { prompt: job.prompt, model: job.model, provider: job.provider, saveToGallery: job.saveToGallery, kind: "audio" }
                );
                setLastOutput({
                    mode: "tts",
                    prompt: job.prompt,
                    model: job.model,
                    provider: job.provider,
                    ttsVoice: job.ttsVoice,
                    mediaIds: galleryEntries.length ? galleryEntries.map((entry) => entry.id) : undefined,
                });
                completeJob(job.id, {
                    audioUrl: audioDataUrl,
                    audioData: audioDataUrl.startsWith("data:") ? audioDataUrl : undefined,
                });
                return;
            }
            
            if (job.provider === "navy") {
                const response = await fetch("/api/navy/tts", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-user-api-key": job.apiKey,
                    },
                    body: JSON.stringify({
                        model: job.model,
                        input: job.prompt,
                        voice: job.ttsVoice,
                        speed: Number(job.ttsSpeed),
                        responseFormat: job.ttsFormat,
                    }),
                });
                const payload = await response.json();
                if (!response.ok) {
                    throw new Error(payload?.error ?? "Speech generation failed.");
                }
                const audio = payload?.audio;
                if (
                    !audio ||
                    typeof audio?.data !== "string" ||
                    typeof audio?.mimeType !== "string"
                ) {
                    throw new Error("No audio data received.");
                }

                const audioDataUrl = dataUrlFromBase64(audio.data, audio.mimeType);
                setAudioUrl(audioDataUrl);
                setAudioMimeType(audio.mimeType);
                const galleryEntries = await addMediaToGallery(
                    [{ url: audioDataUrl, mimeType: audio.mimeType }],
                    {
                        prompt: job.prompt,
                        model: job.model,
                        provider: job.provider,
                        saveToGallery: job.saveToGallery,
                        kind: "audio",
                    }
                );
                setLastOutput({
                    mode: "tts",
                    prompt: job.prompt,
                    model: job.model,
                    provider: job.provider,
                    ttsVoice: job.ttsVoice,
                    mediaIds: galleryEntries.length
                        ? galleryEntries.map((entry) => entry.id)
                        : undefined,
                });
                completeJob(job.id, {
                    audioUrl: audioDataUrl,
                    audioData: audioDataUrl,
                });
                return;
            }

            throw new Error("Audio generation not implemented for this provider");
        } catch (error) {
            failJob(job.id, error instanceof Error ? error.message : "Audio generation failed");
        }
    };



    // Queue Processor
    useEffect(() => {
        if (!hydrated) return;
        const nextJobs = getQueuedJobsToStart(
            jobs.map((job) => ({
                id: job.id,
                status: job.status,
                mode: job.mode,
            })),
            {
                activeIds: Array.from(processingRef.current),
                maxConcurrentImageJobs: 4,
                maxConcurrentNonImageJobs: 1,
            }
        );
        if (!nextJobs.length) return;

        for (const queuedJob of nextJobs) {
            const nextJob = jobs.find((job) => job.id === queuedJob.id);
            if (!nextJob) continue;

            processingRef.current.add(nextJob.id);
            runJob(nextJob).finally(() => {
                processingRef.current.delete(nextJob.id);
                setQueueTick((value) => value + 1);
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobs, hydrated, queueTick]);

    const handleGenerate = (options: GenerateOptions = {}) => {
        const activeMode = options.mode ?? mode;
        const activePrompt = options.prompt ?? prompt;

        if (!apiKey.trim()) { setErrorMessage("API Key required"); return; }
        if (!activePrompt.trim()) { setErrorMessage("Prompt required"); return; }
        if (activeMode === "video" && provider === "chutes" && !videoImage && selectedReferences.length === 0) {
            setErrorMessage("Chutes video generation requires a source image or selected reference.");
            return;
        }
        if (
            activeMode === "video" &&
            selectedModelOption?.supports?.imageToVideo === true &&
            selectedModelOption.supports.textToVideo === false &&
            !videoImage &&
            selectedReferences.length === 0
        ) {
            setErrorMessage(`${selectedModelOption.label} requires a source image or selected reference.`);
            return;
        }
        const batchCreatedAt = new Date().toISOString();
        const effectiveVideoDuration =
            activeMode === "video" && provider === "gemini"
                ? normalizeVeoDuration(videoDuration, {
                    resolution: videoResolution,
                    hasReferenceImages: selectedReferenceIds.length > 0 || Boolean(videoImage),
                })
                : videoDuration;
        if (effectiveVideoDuration !== videoDuration) {
            setVideoDuration(effectiveVideoDuration);
            setStatusMessage("Veo reference, 1080p, and 4K workflows use 8-second renders.");
        }
        const modelsToRun =
            activeMode === "image" && imagePipelineEnabled
                ? (resolvedImageModelOrder.length ? resolvedImageModelOrder : [model])
                : [model];
        const normalizedImageRetryAttempts = normalizeImageRetryAttempts(imageRetryAttempts);
        const normalizedNavyImageSize = navyImageSize.trim().toLowerCase();
        if (
            activeMode === "image" &&
            provider === "navy" &&
            normalizedNavyImageSize &&
            normalizedNavyImageSize !== AUTO_IMAGE_OPTION
        ) {
            if (!isValidNavyImagePixelSize(normalizedNavyImageSize)) {
                setErrorMessage("Navy image size must be auto or WIDTHxHEIGHT.");
                return;
            }
            const gptImage2Model = modelsToRun.find(isGptImage2Model);
            if (gptImage2Model && !isValidGptImage2Size(normalizedNavyImageSize)) {
                setErrorMessage(
                    "GPT Image 2 size must use 16px multiples, stay within 3840px per edge, keep a 3:1 max ratio, and fit 655,360-8,294,400 total pixels."
                );
                return;
            }
        }

        const jobsToQueue = modelsToRun.map((jobModel, index) => {
            const selectedModel = modelSuggestions.find((entry) => entry.id === jobModel);
            return {
                id: createId(),
                status: "queued" as const,
                mode: activeMode,
                provider,
                model: jobModel,
                prompt: activePrompt,
                apiKey,
                createdAt: batchCreatedAt,
                batchId: `${batchCreatedAt}:${provider}:${activeMode}`,
                batchCreatedAt,
                batchOrder: index,
                outputModalities: selectedModel?.outputModalities ?? undefined,
                imageCount,
                imageRetryAttempts: normalizedImageRetryAttempts,
                imageAspect,
                imageSize,
                navyImageSize: normalizedNavyImageSize || AUTO_IMAGE_OPTION,
                navyImageQuality,
                chutesGuidanceScale,
                chutesWidth,
                chutesHeight,
                chutesSteps,
                chutesResolution,
                chutesSeed,
                chutesVideoFps,
                chutesVideoGuidanceScale,
                modelParameters: buildModelParameterPayload(
                    selectedModel,
                    resolveModelParameterValues(
                        selectedModel,
                        modelParameterValuesByModel[jobModel]
                    )
                ),
                videoImage: videoImage || undefined,
                referenceIds: selectedReferenceIds,
                videoAspect,
                videoResolution,
                videoDuration: effectiveVideoDuration,
                ttsVoice,
                ttsFormat,
                ttsSpeed,
                saveToGallery,
                negativePrompt,
                promptAgentModel: provider === "navy" ? navyChatModel : undefined,
                chutesTtsSpeed,
                chutesTtsSpeaker,
                chutesTtsMaxDuration,
            };
        });

        setJobs((prev) => [...prev, ...jobsToQueue]);
        setStatusMessage(
            jobsToQueue.length > 1
                ? `Queued ${jobsToQueue.length} image jobs to run in parallel with ${normalizedImageRetryAttempts} tries per model.`
                : "Queued..."
        );
    };

    const clearKey = () => {
        setApiKeyForProvider(provider, "");
    };

    const clearGallery = () => {
        setSavedMedia([]);
        for (const url of galleryUrlsRef.current.values()) {
            URL.revokeObjectURL(url);
        }
        galleryUrlsRef.current.clear();
        clearGalleryStore().catch(() => {
            setStorageError("Unable to clear all gallery blobs from IndexedDB.");
        });
    };

    const deleteSavedMedia = useCallback(async (id: string) => {
        setSavedMedia((prev) => {
            const target = prev.find((item) => item.id === id);
            if (target?.dataUrl.startsWith("blob:")) URL.revokeObjectURL(target.dataUrl);
            return prev.filter((item) => item.id !== id);
        });
        try {
            await deleteGalleryBlob(id);
        } catch {
            setStorageError("Unable to remove the asset blob from IndexedDB.");
        }
    }, []);

    const saveChatImages = async (payload: {
        images: { id: string; dataUrl: string; mimeType: string; model?: string }[];
        prompt: string;
        model: string;
        provider: Provider;
    }) => {
        if (!payload.images.length) return;
        await addMediaToGallery(
            payload.images.map((image) => ({
                url: image.dataUrl,
                mimeType: image.mimeType,
                model: image.model,
            })),
            {
                prompt: payload.prompt,
                model: payload.model,
                provider: payload.provider,
                saveToGallery,
                kind: "image",
            }
        );
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

    const requestPersistentStorage = useCallback(async () => {
        if (typeof navigator === "undefined" || !navigator.storage?.persist) {
            setStorageError("Persistent storage requests are not available.");
            return false;
        }
        try {
            const granted = await navigator.storage.persist();
            await refreshStorageEstimate();
            return granted;
        } catch (error) {
            setStorageError(error instanceof Error ? error.message : "Unable to request persistent storage.");
            return false;
        }
    }, [refreshStorageEstimate]);

    const refreshNavyUsage = useCallback(async () => {
        const trimmedKey = apiKeys.navy.trim();
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
    }, [apiKeys.navy]);

    const refreshModels = useCallback(async () => {
        if (provider !== "openrouter" && provider !== "navy" && provider !== "nanogpt") return;
        if (provider === "openrouter" && !apiKey.trim()) {
            setModelsError("Add the provider API key before refreshing models.");
            return;
        }
        setModelsLoading(true);
        setModelsError(null);
        try {
            if (provider === "openrouter") {
                const key = apiKeys.openrouter.trim() || apiKey.trim();
                if (!key.trim()) {
                    throw new Error("Missing OpenRouter API key.");
                }
                const response = await fetch("/api/openrouter/models?output_modalities=image", {
                    headers: {
                        "x-user-api-key": key,
                    },
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload?.error ?? "Failed to fetch models from openrouter");
                const models = extractOpenRouterImageModels(payload);
                setOpenRouterImageModels(models);
            } else if (provider === "navy") {
                await refreshNavyCatalog();
            } else if (mode === "image" || mode === "video") {
                await refreshNanoGptCatalog(mode);
            } else {
                throw new Error("NanoGPT model discovery is available for image and video modes.");
            }
        } catch (error) {
            setModelsError(error instanceof Error ? error.message : "Unknown error refreshing models");
        } finally {
            setModelsLoading(false);
        }
    }, [
        apiKey,
        provider,
        mode,
        apiKeys.openrouter,
        refreshNavyCatalog,
        refreshNanoGptCatalog,
    ]);

    const refreshChutesChatModels = useCallback(async () => {
        setChutesChatModelsLoading(true);
        setChutesChatModelsError(null);
        try {
            const key = apiKeys.chutes.trim();
            if (!key) {
                throw new Error("Missing Chutes API key.");
            }
            const response = await fetch("/api/chutes/models", {
                headers: {
                    "x-user-api-key": key,
                },
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload?.error ?? "Failed to fetch Chutes models");
            const models = sanitizeModelOptions(payload?.data ?? payload);
            if (models.length) setChutesChatModels(mergeModelOptions(CHUTES_LLM_MODELS, models));
        } catch (error) {
            setChutesChatModelsError(error instanceof Error ? error.message : "Error");
        } finally {
            setChutesChatModelsLoading(false);
        }
    }, [apiKeys.chutes]);

    const refreshNavyChatModels = useCallback(async () => {
        setNavyChatModelsLoading(true);
        setNavyChatModelsError(null);
        try {
            await refreshNavyCatalog();
        } catch (error) {
            setNavyChatModelsError(error instanceof Error ? error.message : "Error");
        } finally {
            setNavyChatModelsLoading(false);
        }
    }, [refreshNavyCatalog]);

    // --- Effects (Persistence) ---

    // Hydration
    useEffect(() => {
        setHydrated(true);
        const storedProvider = readLocalStorage<Provider | null>(STORAGE_KEYS.provider, null);
        const storedMode = readLocalStorage<Mode | null>(STORAGE_KEYS.mode, null);
        const storedMedia = readLocalStorage<StoredMediaRecord[]>(STORAGE_KEYS.images, []);
        const storedChatProvider = readLocalStorage<ChatProvider | null>(STORAGE_KEYS.chatProvider, null);
        const storedKeyStorageMode = readKeyStorageMode();
        const storedKeys = readProviderKeys(storedKeyStorageMode);
        const legacyKeys = hasDismissedLegacyKeyMigration()
            ? []
            : detectLegacyProviderKeys();
        const storedSettings = readLocalStorage<StoredSettings>(STORAGE_KEYS.settings, {});
        const storedGeneratedImages = readLocalStorage<GeneratedImage[]>(STORAGE_KEYS.generatedImages, []);
        const storedLastOutput = readLocalStorage<unknown>(STORAGE_KEYS.lastOutput, null);
        const storedSelectedReferences = readLocalStorage<string[]>(STORAGE_KEYS.selectedReferences, []);

        if (storedProvider) setProvider(storedProvider);
        if (storedMode) setMode(storedMode);
        if (storedChatProvider && isChatProvider(storedChatProvider)) setChatProvider(storedChatProvider);
        setKeyStorageMode(storedKeyStorageMode);
        setApiKeys(storedKeys);
        setLegacyProviderKeys(legacyKeys);
        if (Array.isArray(storedSelectedReferences)) {
            setSelectedReferenceIds(
                storedSelectedReferences.filter(
                    (entry): entry is string => typeof entry === "string"
                )
            );
        }

        const storedOpenRouterModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.openRouterModels, []);
        if (storedOpenRouterModels.length) setOpenRouterImageModels(sanitizeModelOptions(storedOpenRouterModels));
        const storedNavyImageModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.navyImageModels, []);
        if (storedNavyImageModels.length) {
            setNavyImageModels(mergeModelOptions(NAVY_IMAGE_MODELS, sanitizeModelOptions(storedNavyImageModels)));
        }
        const storedNavyVideoModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.navyVideoModels, []);
        if (storedNavyVideoModels.length) {
            setNavyVideoModels(mergeModelOptions(NAVY_VIDEO_MODELS, sanitizeModelOptions(storedNavyVideoModels)));
        }
        const storedNavyTtsModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.navyTtsModels, []);
        if (storedNavyTtsModels.length) {
            setNavyTtsModels(mergeModelOptions(NAVY_TTS_MODELS, sanitizeModelOptions(storedNavyTtsModels)));
        }
        const storedNanoGptImageModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.nanoGptImageModels, []);
        if (storedNanoGptImageModels.length) {
            setNanoGptImageModels(sanitizeModelOptions(storedNanoGptImageModels));
        }
        const storedNanoGptVideoModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.nanoGptVideoModels, []);
        if (storedNanoGptVideoModels.length) {
            setNanoGptVideoModels(sanitizeModelOptions(storedNanoGptVideoModels));
        }

        const storedChutesChatModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.chutesChatModels, []);
        if (storedChutesChatModels.length) {
            setChutesChatModels(mergeModelOptions(CHUTES_LLM_MODELS, sanitizeModelOptions(storedChutesChatModels)));
        }
        const storedChutesChatModel = readLocalStorage<string>(STORAGE_KEYS.chutesChatModel, "");
        if (storedChutesChatModel) setChutesChatModel(storedChutesChatModel);
        const storedToolImageModel = readLocalStorage<string>(STORAGE_KEYS.chutesToolImageModel, "");
        if (storedToolImageModel) setChutesToolImageModel(storedToolImageModel);
        const storedNavyChatModels = readLocalStorage<ModelOption[]>(STORAGE_KEYS.navyChatModels, []);
        if (storedNavyChatModels.length) {
            setNavyChatModels(
                mergeModelOptions(NAVY_CHAT_MODELS, sanitizeModelOptions(storedNavyChatModels))
            );
        }
        const storedNavyChatModel = readLocalStorage<string>(STORAGE_KEYS.navyChatModel, "");
        if (storedNavyChatModel) setNavyChatModel(storedNavyChatModel);
        const storedNavyToolImageModel = readLocalStorage<string>(STORAGE_KEYS.navyToolImageModel, "");
        if (storedNavyToolImageModel) setNavyToolImageModel(storedNavyToolImageModel);

        if (isRecord(storedSettings)) {
            setModelParameterValuesByModel(
                sanitizeStoredModelParameterValues(
                    storedSettings.modelParameterValuesByModel
                )
            );
            const storedPrompt = getString(storedSettings.prompt);
            if (storedPrompt) setPrompt(storedPrompt);
            const storedNegativePrompt = getString(storedSettings.negativePrompt);
            if (storedNegativePrompt) setNegativePrompt(storedNegativePrompt);
            setImagePipelineEnabled(
                getBoolean(storedSettings.imagePipelineEnabled, false)
            );
            setImageModelOrder(normalizeImageModelOrder(storedSettings.imageModelOrder));
            setImageRetryAttempts(
                normalizeImageRetryAttempts(storedSettings.imageRetryAttempts)
            );

            const storedImageCount = getNumber(storedSettings.imageCount, 1);
            if (storedImageCount > 0) setImageCount(storedImageCount);

            const storedImageAspect = getString(storedSettings.imageAspect);
            if (
                storedImageAspect === AUTO_IMAGE_OPTION ||
                IMAGE_ASPECTS.includes(storedImageAspect)
            ) {
                setImageAspect(storedImageAspect);
            }
            const storedImageSize = getString(storedSettings.imageSize);
            if (
                storedImageSize === AUTO_IMAGE_OPTION ||
                IMAGE_SIZES.includes(storedImageSize)
            ) {
                setImageSize(storedImageSize);
            }
            const storedNavyImageSize = getString(storedSettings.navyImageSize);
            if (
                storedNavyImageSize === AUTO_IMAGE_OPTION ||
                NAVY_IMAGE_SIZES.includes(storedNavyImageSize) ||
                isValidNavyImagePixelSize(storedNavyImageSize)
            ) {
                setNavyImageSize(storedNavyImageSize.toLowerCase());
            }
            const storedNavyImageQuality = getString(storedSettings.navyImageQuality);
            if (NAVY_IMAGE_QUALITIES.includes(storedNavyImageQuality)) {
                setNavyImageQuality(storedNavyImageQuality);
            }
            const storedGuidanceScale = getString(storedSettings.chutesGuidanceScale);
            if (storedGuidanceScale) setChutesGuidanceScale(storedGuidanceScale);
            const storedWidth = getString(storedSettings.chutesWidth);
            if (storedWidth) setChutesWidth(storedWidth);
            const storedHeight = getString(storedSettings.chutesHeight);
            if (storedHeight) setChutesHeight(storedHeight);
            const storedSteps = getString(storedSettings.chutesSteps);
            if (storedSteps) setChutesSteps(storedSteps);
            const storedResolution = getString(storedSettings.chutesResolution);
            if (storedResolution) setChutesResolution(storedResolution);
            const storedSeed = getString(storedSettings.chutesSeed);
            if (storedSeed) setChutesSeed(storedSeed);
            const storedVideoFps = getString(storedSettings.chutesVideoFps);
            if (storedVideoFps) setChutesVideoFps(storedVideoFps);
            const storedVideoGuidance = getString(storedSettings.chutesVideoGuidanceScale);
            if (storedVideoGuidance) setChutesVideoGuidanceScale(storedVideoGuidance);

            const storedVideoAspect = getString(storedSettings.videoAspect);
            if (VIDEO_ASPECTS.includes(storedVideoAspect)) setVideoAspect(storedVideoAspect);
            const storedVideoResolution = getString(storedSettings.videoResolution);
            if (VIDEO_RESOLUTIONS.includes(storedVideoResolution)) setVideoResolution(storedVideoResolution);
            const storedVideoDuration = getString(storedSettings.videoDuration);
            if (VIDEO_DURATIONS.includes(storedVideoDuration)) setVideoDuration(storedVideoDuration);

            const storedTtsVoice = getString(storedSettings.ttsVoice);
            if (TTS_VOICES.includes(storedTtsVoice)) setTtsVoice(storedTtsVoice);
            const storedTtsFormat = getString(storedSettings.ttsFormat);
            if (TTS_FORMATS.includes(storedTtsFormat)) setTtsFormat(storedTtsFormat);
            const storedTtsSpeed = getString(storedSettings.ttsSpeed);
            if (storedTtsSpeed) setTtsSpeed(storedTtsSpeed);

            const storedSaveToGallery = getBoolean(storedSettings.saveToGallery, true);
            setSaveToGallery(storedSaveToGallery);

            const storedChutesTtsSpeed = getString(storedSettings.chutesTtsSpeed);
            if (storedChutesTtsSpeed) setChutesTtsSpeed(storedChutesTtsSpeed);
            const storedChutesTtsSpeaker = getString(storedSettings.chutesTtsSpeaker);
            if (storedChutesTtsSpeaker) setChutesTtsSpeaker(storedChutesTtsSpeaker);
            const storedChutesTtsMaxDuration = getString(storedSettings.chutesTtsMaxDuration);
            if (storedChutesTtsMaxDuration) setChutesTtsMaxDuration(storedChutesTtsMaxDuration);
        }

        const sanitizedImages = sanitizeGeneratedImages(storedGeneratedImages);
        if (sanitizedImages.length) setGeneratedImages(sanitizedImages);

        if (isRecord(storedLastOutput)) {
            const mode = storedLastOutput.mode;
            const provider = storedLastOutput.provider;
            if (isMode(mode) && isProvider(provider)) {
                const prompt = getString(storedLastOutput.prompt);
                const model = getString(storedLastOutput.model);
                const ttsVoice = getString(storedLastOutput.ttsVoice);
                const mediaIds = Array.isArray(storedLastOutput.mediaIds)
                    ? storedLastOutput.mediaIds.filter((entry): entry is string => typeof entry === "string")
                    : [];
                if (prompt && model) {
                    setLastOutput({
                        mode,
                        provider,
                        prompt,
                        model,
                        ttsVoice: ttsVoice || undefined,
                        mediaIds: mediaIds.length ? mediaIds : undefined,
                    });
                }
            }
        }

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

        const loadReferences = async () => {
            if (!idbAvailable) return;
            try {
                const storedReferences = await listReferenceRecords<
                    Omit<StoredReference, "dataUrl"> & { dataUrl?: string }
                >();
                const entries: StoredReference[] = [];
                for (const reference of storedReferences) {
                    const blob = await getGalleryBlob(reference.blobKey);
                    if (!blob) continue;
                    const url = URL.createObjectURL(blob);
                    galleryUrlsRef.current.set(reference.blobKey, url);
                    entries.push({
                        ...reference,
                        dataUrl: url,
                        mimeType: reference.mimeType ?? blob.type,
                    });
                }
                if (entries.length) setReferences(entries.slice(0, MAX_REFERENCES));
            } catch {
                // Reference restore is best-effort when IndexedDB is unavailable.
            }
        };
        void loadReferences();

        const loadPersistedJobs = async () => {
            if (!idbAvailable) return;
            try {
                const persistedJobs = await listPersistedJobRecords<PersistedGenerationJob>();
                const restorable: GenerationJob[] = [];
                for (const job of persistedJobs) {
                    const restored = restorePersistedGenerationJob(
                        job,
                        storedKeys[job.provider]
                    );
                    if (restored) {
                        restorable.push(restored as GenerationJob);
                    }
                }
                if (restorable.length) {
                    setJobs((prev) => [...prev, ...restorable]);
                }
            } catch {
                // Persisted remote jobs are a convenience, not a hard dependency.
            }
        };
        void loadPersistedJobs();

    }, [idbAvailable]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.provider, JSON.stringify(provider));
        writeLocalStorage(STORAGE_KEYS.mode, JSON.stringify(mode));
    }, [provider, mode, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeKeyStorageMode(keyStorageMode);
        persistProviderKeys(keyStorageMode, apiKeys);
    }, [apiKeys, keyStorageMode, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.chatProvider, JSON.stringify(chatProvider));
    }, [chatProvider, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.selectedReferences, JSON.stringify(selectedReferenceIds));
    }, [selectedReferenceIds, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        void refreshNavyCatalog();
    }, [apiKeys.navy, hydrated, refreshNavyCatalog]);

    useEffect(() => {
        if (!hydrated || provider !== "nanogpt") return;
        if (mode !== "image" && mode !== "video") return;
        let active = true;
        setModelsLoading(true);
        setModelsError(null);
        void refreshNanoGptCatalog(mode)
            .catch((error) => {
                if (!active) return;
                setModelsError(
                    error instanceof Error
                        ? error.message
                        : "Unable to refresh NanoGPT models."
                );
            })
            .finally(() => {
                if (active) setModelsLoading(false);
            });
        return () => {
            active = false;
        };
    }, [hydrated, provider, mode, refreshNanoGptCatalog]);

    useEffect(() => {
        if (!hydrated) return;
        const selectionKey = `${provider}:${mode}`;
        const selections = sanitizeModelSelections(
            readLocalStorage<unknown>(STORAGE_KEYS.modelSelections, {})
        );
        const availableModels = modelSuggestions.map((item) => item.id);
        const storedModel = selections[selectionKey];
        const providerModeChanged = lastProviderModeRef.current !== selectionKey;
        lastProviderModeRef.current = selectionKey;

        if (providerModeChanged) {
            if (storedModel && availableModels.includes(storedModel) && storedModel !== model) {
                setModel(storedModel);
                return;
            }
        }

        if (!availableModels.includes(model) && availableModels.length) {
            setModel(availableModels[0]);
        }
    }, [provider, mode, modelSuggestions, model, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        if (!model) return;
        const selectionKey = `${provider}:${mode}`;
        const selections = sanitizeModelSelections(
            readLocalStorage<unknown>(STORAGE_KEYS.modelSelections, {})
        );
        selections[selectionKey] = model;
        writeLocalStorage(STORAGE_KEYS.modelSelections, JSON.stringify(selections));
    }, [model, provider, mode, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        const payload: StoredSettings = {
            prompt,
            negativePrompt,
            imagePipelineEnabled,
            imageModelOrder: normalizeImageModelOrder(imageModelOrder),
            imageRetryAttempts: normalizeImageRetryAttempts(imageRetryAttempts),
            imageCount,
            imageAspect,
            imageSize,
            navyImageSize,
            navyImageQuality,
            chutesGuidanceScale,
            chutesWidth,
            chutesHeight,
            chutesSteps,
            chutesResolution,
            chutesSeed,
            chutesVideoFps,
            chutesVideoGuidanceScale,
            videoAspect,
            videoResolution,
            videoDuration,
            ttsVoice,
            ttsFormat,
            ttsSpeed,
            saveToGallery,
            chutesTtsSpeed,
            chutesTtsSpeaker,
            chutesTtsMaxDuration,
            modelParameterValuesByModel,
        };
        const handle = window.setTimeout(() => {
            try {
                writeLocalStorage(STORAGE_KEYS.settings, JSON.stringify(payload));
            } catch { }
        }, 150);
        return () => window.clearTimeout(handle);
    }, [
        prompt,
        negativePrompt,
        imagePipelineEnabled,
        imageModelOrder,
        imageRetryAttempts,
        imageCount,
        imageAspect,
        imageSize,
        navyImageSize,
        navyImageQuality,
        chutesGuidanceScale,
        chutesWidth,
        chutesHeight,
        chutesSteps,
        chutesResolution,
        chutesSeed,
        chutesVideoFps,
        chutesVideoGuidanceScale,
        videoAspect,
        videoResolution,
        videoDuration,
        ttsVoice,
        ttsFormat,
        ttsSpeed,
        saveToGallery,
        chutesTtsSpeed,
        chutesTtsSpeaker,
        chutesTtsMaxDuration,
        modelParameterValuesByModel,
        hydrated,
    ]);

    useEffect(() => {
        if (!hydrated) return;
        const trimmedImages = generatedImages.slice(0, MAX_SAVED_MEDIA);
        try {
            if (trimmedImages.length) {
                writeLocalStorage(STORAGE_KEYS.generatedImages, JSON.stringify(trimmedImages));
            } else {
                window.localStorage.removeItem(STORAGE_KEYS.generatedImages);
            }
        } catch { }
    }, [generatedImages, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        try {
            if (lastOutput) {
                writeLocalStorage(STORAGE_KEYS.lastOutput, JSON.stringify(lastOutput));
            } else {
                window.localStorage.removeItem(STORAGE_KEYS.lastOutput);
            }
        } catch { }
    }, [lastOutput, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.openRouterModels, JSON.stringify(openRouterImageModels));
    }, [openRouterImageModels, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.navyImageModels, JSON.stringify(navyImageModels));
    }, [navyImageModels, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.navyVideoModels, JSON.stringify(navyVideoModels));
    }, [navyVideoModels, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.navyTtsModels, JSON.stringify(navyTtsModels));
    }, [navyTtsModels, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.nanoGptImageModels, JSON.stringify(nanoGptImageModels));
    }, [nanoGptImageModels, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.nanoGptVideoModels, JSON.stringify(nanoGptVideoModels));
    }, [nanoGptVideoModels, hydrated]);

    useEffect(() => {
        if (!hydrated || !idbAvailable) return;
        for (const job of jobs) {
            if (shouldPersistRemoteGenerationJob(job)) {
                void putPersistedJobRecord(toPersistedJob(job));
            }
            if (job.status === "success" || job.status === "error") {
                void deletePersistedJobRecord(job.id);
            }
        }
    }, [jobs, hydrated, idbAvailable]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.chutesChatModels, JSON.stringify(chutesChatModels));
    }, [chutesChatModels, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        if (chutesChatModel) {
            writeLocalStorage(STORAGE_KEYS.chutesChatModel, JSON.stringify(chutesChatModel));
        }
    }, [chutesChatModel, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        if (chutesToolImageModel) {
            writeLocalStorage(STORAGE_KEYS.chutesToolImageModel, JSON.stringify(chutesToolImageModel));
        }
    }, [chutesToolImageModel, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        writeLocalStorage(STORAGE_KEYS.navyChatModels, JSON.stringify(navyChatModels));
    }, [navyChatModels, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        if (navyChatModel) {
            writeLocalStorage(STORAGE_KEYS.navyChatModel, JSON.stringify(navyChatModel));
        }
    }, [navyChatModel, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        if (navyToolImageModel) {
            writeLocalStorage(STORAGE_KEYS.navyToolImageModel, JSON.stringify(navyToolImageModel));
        }
    }, [navyToolImageModel, hydrated]);

    useEffect(() => {
        if (!hydrated) return;
        if (provider === "navy" && apiKeys.navy.trim()) {
            void refreshNavyUsage();
            const interval = window.setInterval(() => void refreshNavyUsage(), 60000);
            return () => window.clearInterval(interval);
        }
        if (!apiKeys.navy.trim()) {
            setNavyUsage(null);
        }
    }, [provider, apiKeys.navy, hydrated, refreshNavyUsage]);

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

    useEffect(() => {
        if (!hydrated || !lastOutput?.mediaIds?.length) return;
        const mediaMap = new Map(savedMedia.map((item) => [item.id, item]));
        const resolveMedia = (id: string) => mediaMap.get(id);

        if (lastOutput.mode === "video" && !videoUrl) {
            const entry = resolveMedia(lastOutput.mediaIds[0]);
            if (entry?.kind === "video") {
                setVideoUrl(entry.dataUrl);
            }
        }

        if (lastOutput.mode === "tts" && !audioUrl) {
            const entry = resolveMedia(lastOutput.mediaIds[0]);
            if (entry?.kind === "audio") {
                setAudioUrl(entry.dataUrl);
                setAudioMimeType(entry.mimeType ?? null);
            }
        }

        if (lastOutput.mode === "image" && generatedImages.length === 0) {
            const images = lastOutput.mediaIds
                .map((id) => resolveMedia(id))
                .filter((entry): entry is StoredMedia => !!entry && (entry.kind ?? "image") === "image")
                .map((entry) => ({
                    id: entry.id,
                    dataUrl: entry.dataUrl,
                    mimeType: entry.mimeType ?? "image/png",
                    model: entry.model,
                    provider: entry.provider,
                    prompt: entry.prompt,
                    createdAt: entry.createdAt,
                }))
                .slice(0, MAX_SAVED_MEDIA);
            if (images.length) {
                setGeneratedImages(images);
            }
        }
    }, [savedMedia, lastOutput, hydrated, videoUrl, audioUrl, generatedImages.length]);

    useEffect(() => {
        const galleryUrls = galleryUrlsRef.current;
        return () => {
            for (const url of galleryUrls.values()) {
                URL.revokeObjectURL(url);
            }
            galleryUrls.clear();
        };
    }, []);

    const value: StudioContextType = {
        hydrated,
        provider, setProvider,
        mode, setMode,
        apiKey, setApiKey,
        apiKeys, setApiKeyForProvider,
        keyStorageMode, setKeyStorageMode,
        legacyProviderKeys,
        migrateLegacyProviderKeys,
        discardLegacyProviderKeys,
        clearAllKeys,
        model, setModel,
        prompt, setPrompt,
        negativePrompt, setNegativePrompt,
        imageCount, setImageCount,
        imagePipelineEnabled, setImagePipelineEnabled,
        imageModelOrder, setImageModelOrder,
        imageRetryAttempts, setImageRetryAttempts,
        imageAspect, setImageAspect,
        imageSize, setImageSize,
        navyImageSize, setNavyImageSize,
        navyImageQuality, setNavyImageQuality,
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
        modelParameterValues, setModelParameterValue,
        chatProvider, setChatProvider,
        chutesChatModels,
        chutesChatModel, setChutesChatModel,
        chutesToolImageModel, setChutesToolImageModel,
        chutesChatModelsLoading,
        chutesChatModelsError,
        navyChatModels,
        navyChatModel, setNavyChatModel,
        navyToolImageModel, setNavyToolImageModel,
        navyChatModelsLoading,
        navyChatModelsError,
        openRouterImageModels,
        navyImageModels,
        navyVideoModels,
        navyTtsModels,
        nanoGptImageModels,
        nanoGptVideoModels,
        modelSuggestions,
        statusMessage, setStatusMessage,
        errorMessage, setErrorMessage,
        modelsLoading, modelsError,
        navyUsage, navyUsageError, navyUsageLoading, navyUsageUpdatedAt, refreshNavyUsage,
        storageSnapshot, storageError, refreshStorageEstimate, requestPersistentStorage,
        references,
        selectedReferenceIds,
        selectedReferences,
        addReferenceFile,
        removeReference,
        toggleReferenceSelection,
        clearSelectedReferences,
        generatedImages, setGeneratedImages,
        savedMedia, setSavedMedia, deleteSavedMedia,
        videoUrl, setVideoUrl,
        audioUrl, setAudioUrl,
        audioMimeType, setAudioMimeType,
        lastOutput, setLastOutput,
        jobs, updateJobs,
        activeJobCount,
        hasActiveJobs, runningJobs, queuedJobs, recentJobs,
        supportsVideo, supportsTts,
        clearKey, clearGallery,
        refreshModels, refreshChutesChatModels, refreshNavyChatModels,
        saveChatImages,
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
