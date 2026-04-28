import type { Provider } from "@/lib/constants";

export type ProviderMode = "chat" | "image" | "video" | "audio";

export type ProviderModality = "text" | "image" | "audio" | "video";

export type ModelCapability = {
  provider: Provider;
  id: string;
  label: string;
  modes: ProviderMode[];
  inputModalities: ProviderModality[];
  outputModalities: ProviderModality[];
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  tokenizer?: string | null;
  description?: string | null;
  metadataSource?: string | null;
  metadataStatus?: string;
  pricing?: unknown;
  supportsVision?: boolean | null;
  supportsTools?: boolean | null;
  supportsFunctionCalling?: boolean | null;
  supportsReasoning?: boolean | null;
  supportsJsonMode?: boolean | null;
  supportsAudioInput?: boolean | null;
  supportsImageOutput?: boolean | null;
  supportsStreaming?: boolean | null;
  supportsNegativePrompt?: boolean;
  supportsAspectRatio?: boolean;
  supportedAspectRatios?: string[];
  supportsImageSize?: boolean;
  supportedImageSizes?: string[];
  supportsSeed?: boolean;
  supportsBatch?: boolean;
  maxBatchSize?: number;
  supportsImageInput?: boolean;
  maxReferenceImages?: number;
  supportsFirstLastFrame?: boolean;
  supportsVideoExtension?: boolean;
  supportedDurations?: string[];
  supportedResolutions?: string[];
  supportedAudioFormats?: string[];
  supportedVoices?: string[];
  asyncJob?: boolean;
  polling?: {
    intervalMs: number;
    maxAttempts: number;
  };
  costHint?: string;
  planGated?: boolean;
};

export type CapabilityFilter = {
  provider?: Provider;
  mode?: ProviderMode;
  inputModality?: ProviderModality;
  outputModality?: ProviderModality;
};
