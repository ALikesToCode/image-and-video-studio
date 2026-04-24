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
