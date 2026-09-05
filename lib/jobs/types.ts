import type { Mode, Provider } from "../constants.ts";
import type { GenerationBilling } from "../types.ts";
import type { ModelParameterValues } from "../model-capability-settings.ts";
import type { GenerationReference } from "../client/generation-inputs.ts";

export type JobStatus = "queued" | "running" | "success" | "error" | "cancelled";

export type GenerationJob = {
    id: string;
    status: JobStatus;
    mode: Mode;
    provider: Provider;
    model: string;
    modelEndpoint?: string;
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
    referenceImages?: GenerationReference[];

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
