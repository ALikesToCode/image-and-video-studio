/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MODELS,
  GEMINI_IMAGE_MODELS,
  GEMINI_VIDEO_MODELS,
  CHUTES_IMAGE_MODELS,
  CHUTES_LLM_MODELS,
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
  deleteGalleryBlob,
  getGalleryBlob,
  isIndexedDbAvailable,
  putGalleryBlob,
} from "@/lib/gallery-db";
import { Header } from "./Header";
import { ImgGenSettings } from "./img-gen-settings";
import { PromptInput } from "./prompt-input";
import { GalleryGrid } from "./gallery-grid";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Download, Loader2, Maximize2 } from "lucide-react";
import { ImageViewer } from "./image-viewer";
import { ChutesChat } from "./chutes-chat";

type JobStatus = "queued" | "running" | "success" | "error";

type GenerationJob = {
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
  imageCount: number;
  imageAspect: string;
  imageSize: string;
  navyImageSize: string;
  chutesGuidanceScale: string;
  chutesWidth: string;
  chutesHeight: string;
  chutesSteps: string;
  chutesResolution: string;
  chutesSeed: string;
  videoAspect: string;
  videoResolution: string;
  videoDuration: string;
  ttsVoice: string;
  ttsFormat: string;
  ttsSpeed: string;
  saveToGallery: boolean;
};

type OutputMeta = {
  mode: Mode;
  prompt: string;
  model: string;
  provider: Provider;
  ttsVoice?: string;
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

const MAX_SAVED_MEDIA = 12;
const MAX_CACHED_MODELS = 200;
const MAX_JOB_HISTORY = 20;

const getKeyStorage = (provider: Provider) => {
  if (provider === "gemini") return STORAGE_KEYS.keyGemini;
  if (provider === "navy") return STORAGE_KEYS.keyNavy;
  if (provider === "openrouter") return STORAGE_KEYS.keyOpenRouter;
  return STORAGE_KEYS.keyChutes;
};

const getModelStorageKey = (provider: Provider, mode: Mode) =>
  `${STORAGE_KEYS.model}_${provider}_${mode}`;

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

const ensureModelOption = (models: ModelOption[], id: string) => {
  if (!id) return models;
  if (models.some((item) => item.id === id)) return models;
  return [{ id, label: id }, ...models];
};

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const digits = index === 0 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[index]}`;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
  }
  if (typeof value === "string") return [value.toLowerCase()];
  return [];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asRecordArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

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

const extractNavyModelTokens = (item: Record<string, unknown>) => {
  const tokens: string[] = [];
  const pushTokens = (value: unknown) => {
    if (typeof value === "string") {
      tokens.push(value.toLowerCase());
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => pushTokens(entry));
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.name === "string") {
        tokens.push(obj.name.toLowerCase());
      }
      if (typeof obj.id === "string") {
        tokens.push(obj.id.toLowerCase());
      }
    }
  };

  pushTokens(item.id);
  pushTokens(item.model);
  pushTokens(item.name);
  pushTokens(item.type);
  pushTokens(item.task);
  pushTokens(item.category);
  pushTokens(item.modality);
  pushTokens(item.modality_type);
  pushTokens(item.modalities);
  pushTokens(item.input_modalities);
  pushTokens(item.output_modalities);
  pushTokens(item.inputModalities);
  pushTokens(item.outputModalities);
  pushTokens(item.capabilities);
  pushTokens(item.tasks);
  return tokens;
};

const getNavyModalities = (item: Record<string, unknown>) => {
  const input = normalizeStringArray(
    item.input_modalities ?? item.inputModalities ?? item.inputs ?? item.input
  );
  const output = normalizeStringArray(
    item.output_modalities ?? item.outputModalities ?? item.outputs ?? item.output
  );
  return { input, output };
};

const navyModeTags: Record<Mode, string[]> = {
  image: ["image", "img", "flux", "dall", "diffusion", "schnell", "stable", "sd", "pixart"],
  video: ["video", "veo", "cogvideo", "cogvideox", "kling", "luma"],
  tts: ["tts", "speech", "voice"],
};

const isNavyModelForMode = (item: Record<string, unknown>, mode: Mode) => {
  const { input, output } = getNavyModalities(item);
  const tokens = extractNavyModelTokens(item);
  const matchesTags = navyModeTags[mode].some((tag) =>
    tokens.some((token) => token.includes(tag))
  );

  if (mode === "tts") {
    const hasTtsModalities = output.includes("audio") && input.includes("text");
    return hasTtsModalities || matchesTags;
  }
  if (mode === "video") {
    return output.includes("video") || matchesTags;
  }
  return output.includes("image") || matchesTags;
};

const getOpenRouterModalities = (item: Record<string, unknown>) => {
  const architecture =
    (item.architecture as Record<string, unknown> | undefined) ?? {};
  const input = normalizeStringArray(
    architecture.input_modalities ?? architecture.inputModalities
  );
  const output = normalizeStringArray(
    architecture.output_modalities ?? architecture.outputModalities
  );
  const modality = normalizeStringArray(architecture.modality);
  return { input, output, modality };
};

const isOpenRouterModelForMode = (
  item: Record<string, unknown>,
  mode: Mode
) => {
  const { input, output, modality } = getOpenRouterModalities(item);

  if (mode === "tts") {
    return output.includes("audio") && input.includes("text");
  }
  if (mode === "video") {
    return output.includes("video") || modality.includes("video");
  }
  return output.includes("image") || modality.includes("image");
};

export default function Studio() {
  const [hydrated, setHydrated] = useState(false);
  const [provider, setProvider] = useState<Provider>("gemini");
  const [mode, setMode] = useState<Mode>("image");
  const [apiKey, setApiKey] = useState("");

  const [model, setModel] = useState(DEFAULT_MODELS.gemini.image);
  const [openRouterImageModels, setOpenRouterImageModels] =
    useState<ModelOption[]>(OPENROUTER_IMAGE_MODELS);
  const [navyImageModels, setNavyImageModels] =
    useState<ModelOption[]>(NAVY_IMAGE_MODELS);
  const [navyVideoModels, setNavyVideoModels] =
    useState<ModelOption[]>(NAVY_VIDEO_MODELS);
  const [navyTtsModels, setNavyTtsModels] =
    useState<ModelOption[]>(NAVY_TTS_MODELS);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [imageAspect, setImageAspect] = useState(IMAGE_ASPECTS[0]);
  const [imageSize, setImageSize] = useState(IMAGE_SIZES[0]);
  const [navyImageSize] = useState("1024x1024"); // Default
  const [chutesGuidanceScale, setChutesGuidanceScale] = useState("7.5");
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
  const [chutesChatKey, setChutesChatKey] = useState("");
  const [chutesChatModels, setChutesChatModels] =
    useState<ModelOption[]>(CHUTES_LLM_MODELS);
  const [chutesChatModel, setChutesChatModel] = useState(
    CHUTES_LLM_MODELS[0]?.id ?? ""
  );
  const [chutesToolImageModel, setChutesToolImageModel] = useState(
    CHUTES_IMAGE_MODELS[0]?.id ?? "z-image-turbo"
  );
  const [chutesChatModelsLoading, setChutesChatModelsLoading] = useState(false);
  const [chutesChatModelsError, setChutesChatModelsError] = useState<
    string | null
  >(null);

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
  const [lastOutput, setLastOutput] = useState<OutputMeta | null>(null);
  const [storageSnapshot, setStorageSnapshot] =
    useState<StorageSnapshot | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [navyUsage, setNavyUsage] = useState<NavyUsageResponse | null>(null);
  const [navyUsageError, setNavyUsageError] = useState<string | null>(null);
  const [navyUsageLoading, setNavyUsageLoading] = useState(false);
  const [navyUsageUpdatedAt, setNavyUsageUpdatedAt] = useState<string | null>(
    null
  );
  const [viewerImage, setViewerImage] = useState<{
    dataUrl: string;
    prompt: string;
    model: string;
    provider: Provider;
  } | null>(null);

  const activeVideoUrl = useRef<string | null>(null);
  const processingRef = useRef(false);
  const galleryUrlsRef = useRef(new Map<string, string>());
  const prevSavedMediaRef = useRef<StoredMedia[]>([]);
  const navyUsageLoadingRef = useRef(false);

  const supportsVideo = provider === "gemini" || provider === "navy";
  const supportsTts = provider === "navy";
  const idbAvailable = useMemo(() => isIndexedDbAvailable(), []);

  const refreshStorageEstimate = useCallback(async () => {
    if (typeof navigator === "undefined") return;
    if (!navigator.storage?.estimate) {
      setStorageError("Storage usage isn't available in this browser.");
      return;
    }
    try {
      const estimate = await navigator.storage.estimate();
      const persistent = navigator.storage.persisted
        ? await navigator.storage.persisted()
        : null;
      setStorageSnapshot({
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
        persistent,
      });
      setStorageError(null);
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Unable to read storage usage."
      );
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
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to fetch usage.");
      }
      setNavyUsage(payload as NavyUsageResponse);
      setNavyUsageError(null);
      setNavyUsageUpdatedAt(new Date().toISOString());
    } catch (error) {
      setNavyUsageError(
        error instanceof Error ? error.message : "Unable to fetch usage."
      );
    } finally {
      navyUsageLoadingRef.current = false;
      setNavyUsageLoading(false);
    }
  }, [apiKey, provider]);

  const modelSuggestions = useMemo(() => {
    if (provider === "gemini") {
      return mode === "image" ? GEMINI_IMAGE_MODELS : GEMINI_VIDEO_MODELS;
    }
    if (provider === "chutes") {
      return CHUTES_IMAGE_MODELS;
    }
    if (provider === "openrouter") {
      return openRouterImageModels;
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
  ]);

  const runningJobs = jobs.filter((job) => job.status === "running");
  const queuedJobs = jobs.filter((job) => job.status === "queued");
  const hasActiveJobs = runningJobs.length > 0 || queuedJobs.length > 0;
  const recentJobs = jobs.slice(-4).reverse();

  const hasOutput =
    (lastOutput?.mode === "image" && generatedImages.length > 0) ||
    (lastOutput?.mode === "video" && !!videoUrl) ||
    (lastOutput?.mode === "tts" && !!audioUrl);

  // Hydration & Persistence
  useEffect(() => {
    setHydrated(true);
    const storedProvider = readLocalStorage<Provider | null>(STORAGE_KEYS.provider, null);
    const storedMode = readLocalStorage<Mode | null>(STORAGE_KEYS.mode, null);
    const storedMedia = readLocalStorage<StoredMediaRecord[]>(STORAGE_KEYS.images, []);
    const storedOpenRouterModels = readLocalStorage<ModelOption[]>(
      STORAGE_KEYS.openRouterModels,
      []
    );
    const storedNavyImageModels = readLocalStorage<ModelOption[]>(
      STORAGE_KEYS.navyImageModels,
      []
    );
    const storedNavyVideoModels = readLocalStorage<ModelOption[]>(
      STORAGE_KEYS.navyVideoModels,
      []
    );
    const storedNavyTtsModels = readLocalStorage<ModelOption[]>(
      STORAGE_KEYS.navyTtsModels,
      []
    );
    const storedChutesChatModels = readLocalStorage<ModelOption[]>(
      STORAGE_KEYS.chutesChatModels,
      []
    );
    const storedChutesChatModel = readLocalStorage<string | null>(
      STORAGE_KEYS.chutesChatModel,
      null
    );
    const storedChutesToolImageModel = readLocalStorage<string | null>(
      STORAGE_KEYS.chutesToolImageModel,
      null
    );
    const storedChutesKey = readLocalStorage<string>(STORAGE_KEYS.keyChutes, "");

    if (storedProvider) setProvider(storedProvider);
    if (storedMode) setMode(storedMode);
    if (storedOpenRouterModels.length) {
      setOpenRouterImageModels(sanitizeModelOptions(storedOpenRouterModels));
    }
    if (storedNavyImageModels.length) {
      setNavyImageModels(sanitizeModelOptions(storedNavyImageModels));
    }
    if (storedNavyVideoModels.length) {
      setNavyVideoModels(sanitizeModelOptions(storedNavyVideoModels));
    }
    if (storedNavyTtsModels.length) {
      setNavyTtsModels(sanitizeModelOptions(storedNavyTtsModels));
    }
    if (storedChutesChatModels.length) {
      setChutesChatModels(sanitizeModelOptions(storedChutesChatModels));
    }
    if (storedChutesChatModel) {
      setChutesChatModels((prev) => ensureModelOption(prev, storedChutesChatModel));
      setChutesChatModel(storedChutesChatModel);
    }
    if (storedChutesToolImageModel) {
      setChutesToolImageModel(storedChutesToolImageModel);
    }
    setChutesChatKey(storedChutesKey);
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
        setErrorMessage("IndexedDB is unavailable. Gallery saves may be limited.");
        return;
      }
      const entries: StoredMedia[] = [];
      for (const item of storedMedia) {
        try {
          let blob = await getGalleryBlob(item.id);
          if (!blob && item.dataUrl) {
            const response = await fetch(item.dataUrl);
            if (!response.ok) {
              throw new Error("Unable to migrate gallery item.");
            }
            blob = await response.blob();
            await putGalleryBlob(item.id, blob);
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
        } catch (error) {
          if (item.dataUrl) {
            entries.push({
              id: item.id,
              dataUrl: item.dataUrl,
              prompt: item.prompt,
              model: item.model,
              provider: item.provider,
              createdAt: item.createdAt,
              kind: item.kind ?? "image",
              mimeType: item.mimeType,
            });
            continue;
          }
          setErrorMessage(
            error instanceof Error ? error.message : "Unable to load saved items."
          );
        }
      }
      setSavedMedia(entries);
    };

    void loadSavedMedia();
  }, [idbAvailable]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(STORAGE_KEYS.provider, JSON.stringify(provider));
  }, [provider, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(STORAGE_KEYS.mode, JSON.stringify(mode));
  }, [mode, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const storedModel = readLocalStorage<string | null>(
      getModelStorageKey(provider, mode),
      null
    );
    const nextModel = storedModel || DEFAULT_MODELS[provider][mode];
    if (provider === "openrouter") {
      setOpenRouterImageModels((prev) => ensureModelOption(prev, nextModel));
    } else if (provider === "navy") {
      if (mode === "video") {
        setNavyVideoModels((prev) => ensureModelOption(prev, nextModel));
      } else if (mode === "tts") {
        setNavyTtsModels((prev) => ensureModelOption(prev, nextModel));
      } else {
        setNavyImageModels((prev) => ensureModelOption(prev, nextModel));
      }
    }
    setModel(nextModel);
  }, [mode, provider, hydrated]);

  useEffect(() => {
    if (mode === "video" && !supportsVideo) {
      setMode("image");
    }
    if (mode === "tts" && !supportsTts) {
      setMode("image");
    }
  }, [mode, supportsVideo, supportsTts]);

  useEffect(() => {
    if (!hydrated) return;
    const storedKey = readLocalStorage<string>(getKeyStorage(provider), "");
    setApiKey(storedKey);
  }, [provider, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (provider !== "chutes") return;
    if (chutesChatKey !== apiKey) {
      setChutesChatKey(apiKey);
    }
  }, [apiKey, provider, hydrated, chutesChatKey]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshStorageEstimate();
  }, [hydrated, savedMedia, refreshStorageEstimate]);

  useEffect(() => {
    if (!hydrated) return;
    if (provider !== "navy") {
      setNavyUsage(null);
      setNavyUsageError(null);
      setNavyUsageUpdatedAt(null);
      return;
    }
    if (!apiKey.trim()) {
      setNavyUsage(null);
      setNavyUsageError(null);
      setNavyUsageUpdatedAt(null);
      return;
    }
    void refreshNavyUsage();
    const interval = window.setInterval(() => {
      void refreshNavyUsage();
    }, 60000);
    return () => window.clearInterval(interval);
  }, [provider, apiKey, hydrated, refreshNavyUsage]);

  useEffect(() => {
    setModelsError(null);
  }, [provider, mode]);

  useEffect(() => {
    if (!hydrated) return;
    const storageKey = getKeyStorage(provider);
    if (apiKey) {
      writeLocalStorage(storageKey, JSON.stringify(apiKey));
    } else {
      window.localStorage.removeItem(storageKey);
    }
  }, [apiKey, provider, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (chutesChatKey) {
      writeLocalStorage(STORAGE_KEYS.keyChutes, JSON.stringify(chutesChatKey));
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.keyChutes);
    }
  }, [chutesChatKey, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(getModelStorageKey(provider, mode), JSON.stringify(model));
  }, [model, provider, mode, hydrated]);

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
        ...(!idbAvailable || !item.dataUrl.startsWith("blob:")
          ? { dataUrl: item.dataUrl }
          : {}),
      }));
      writeLocalStorage(STORAGE_KEYS.images, JSON.stringify(storedMedia));
    } catch {
      setErrorMessage("Local storage is full. Clear some saved items.");
    }
  }, [savedMedia, hydrated, idbAvailable]);

  useEffect(() => {
    const previous = prevSavedMediaRef.current;
    const currentIds = new Set(savedMedia.map((image) => image.id));
    const removed = previous.filter((image) => !currentIds.has(image.id));
    if (removed.length) {
      removed.forEach((image) => {
        const url = galleryUrlsRef.current.get(image.id);
        if (url?.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
        galleryUrlsRef.current.delete(image.id);
        if (idbAvailable) {
          void deleteGalleryBlob(image.id);
        }
      });
    }
    prevSavedMediaRef.current = savedMedia;
  }, [savedMedia, idbAvailable]);

  useEffect(() => {
    if (!hydrated || !openRouterImageModels.length) return;
    writeLocalStorage(
      STORAGE_KEYS.openRouterModels,
      JSON.stringify(sanitizeModelOptions(openRouterImageModels))
    );
  }, [openRouterImageModels, hydrated]);

  useEffect(() => {
    if (!hydrated || !navyImageModels.length) return;
    writeLocalStorage(
      STORAGE_KEYS.navyImageModels,
      JSON.stringify(sanitizeModelOptions(navyImageModels))
    );
  }, [navyImageModels, hydrated]);

  useEffect(() => {
    if (!hydrated || !chutesChatModels.length) return;
    writeLocalStorage(
      STORAGE_KEYS.chutesChatModels,
      JSON.stringify(sanitizeModelOptions(chutesChatModels))
    );
  }, [chutesChatModels, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(
      STORAGE_KEYS.chutesChatModel,
      JSON.stringify(chutesChatModel)
    );
  }, [chutesChatModel, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(
      STORAGE_KEYS.chutesToolImageModel,
      JSON.stringify(chutesToolImageModel)
    );
  }, [chutesToolImageModel, hydrated]);

  useEffect(() => {
    if (!hydrated || !navyVideoModels.length) return;
    writeLocalStorage(
      STORAGE_KEYS.navyVideoModels,
      JSON.stringify(sanitizeModelOptions(navyVideoModels))
    );
  }, [navyVideoModels, hydrated]);

  useEffect(() => {
    if (!hydrated || !navyTtsModels.length) return;
    writeLocalStorage(
      STORAGE_KEYS.navyTtsModels,
      JSON.stringify(sanitizeModelOptions(navyTtsModels))
    );
  }, [navyTtsModels, hydrated]);

  useEffect(() => {
    const galleryUrls = galleryUrlsRef.current;
    return () => {
      if (activeVideoUrl.current?.startsWith("blob:")) {
        URL.revokeObjectURL(activeVideoUrl.current);
      }
      galleryUrls.forEach((url) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
      galleryUrls.clear();
    };
  }, []);

  const updateVideoUrl = (url: string) => {
    if (activeVideoUrl.current?.startsWith("blob:")) {
      URL.revokeObjectURL(activeVideoUrl.current);
    }
    activeVideoUrl.current = url;
    setVideoUrl(url);
  };

  const closeViewer = (open: boolean) => {
    if (!open) {
      setViewerImage(null);
    }
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
          entries.push({
            id,
            dataUrl: item.url,
            prompt: metadata.prompt,
            model: metadata.model,
            provider: metadata.provider,
            createdAt: new Date().toISOString(),
            kind: metadata.kind,
            mimeType,
          });
          continue;
        }

        if (!blob) {
          try {
            const response = await fetch(item.url);
            if (!response.ok) {
              throw new Error("Unable to save generated media.");
            }
            blob = await response.blob();
            mimeType = mimeType ?? blob.type;
          } catch {
            entries.push({
              id,
              dataUrl: item.url,
              prompt: metadata.prompt,
              model: metadata.model,
              provider: metadata.provider,
              createdAt: new Date().toISOString(),
              kind: metadata.kind,
              mimeType,
            });
            continue;
          }
        }

        await putGalleryBlob(id, blob);
        const url = URL.createObjectURL(blob);
        galleryUrlsRef.current.set(id, url);
        entries.push({
          id,
          dataUrl: url,
          prompt: metadata.prompt,
          model: metadata.model,
          provider: metadata.provider,
          createdAt: new Date().toISOString(),
          kind: metadata.kind,
          mimeType: mimeType ?? blob.type,
        });
      }

      if (entries.length) {
        setSavedMedia((prev) => [...entries, ...prev].slice(0, MAX_SAVED_MEDIA));
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Unable to save to local gallery."
      );
    }
  };

  const clearGallery = () => {
    galleryUrlsRef.current.forEach((url) => {
      if (url.startsWith("blob:")) {
        URL.revokeObjectURL(url);
      }
    });
    galleryUrlsRef.current.clear();
    prevSavedMediaRef.current = [];
    setSavedMedia([]);
    window.localStorage.removeItem(STORAGE_KEYS.images);
    if (idbAvailable) {
      void clearGalleryStore().catch((error) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to clear saved items."
        );
      });
    }
  };

  const clearKey = () => setApiKey("");

  const refreshModels = async () => {
    if (modelsLoading) return;
    setModelsError(null);
    if (!apiKey.trim()) {
      setModelsError("Add your API key to fetch models.");
      return;
    }
    setModelsLoading(true);
    try {
      if (provider === "openrouter") {
        const response = await fetch("/api/openrouter/models", {
          headers: { "x-user-api-key": apiKey },
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          const errorMessage = isRecord(payload.error)
            ? getString(payload.error.message, "Unable to fetch OpenRouter models.")
            : getString(payload.error, "Unable to fetch OpenRouter models.");
          throw new Error(errorMessage);
        }
        const rawModels = Array.isArray(payload.data) ? payload.data : [];
        if (!rawModels.length) {
          throw new Error("No models returned by OpenRouter.");
        }

        const normalizedModels = asRecordArray(rawModels)
          .map((item) => {
            const id = getString(item.id);
            if (!id) return null;
            const label = getString(item.name, id);
            return { id, label, raw: item };
          })
          .filter(
            (
              item
            ): item is { id: string; label: string; raw: Record<string, unknown> } =>
              item !== null
          );

        const filtered = normalizedModels.filter((item) =>
          isOpenRouterModelForMode(item.raw, mode)
        );
        const fallbackModels = OPENROUTER_IMAGE_MODELS;
        const models = (filtered.length ? filtered : fallbackModels).map(
          (item) => ({
            id: item.id,
            label: item.label ?? item.id,
          })
        );

        if (!filtered.length) {
          setModelsError("No OpenRouter image models detected. Showing defaults.");
        }

        setOpenRouterImageModels(models);
        if (!models.some((m: ModelOption) => m.id === model)) {
          setModel(models[0].id);
        }
        return;
      }

      if (provider === "navy") {
        const response = await fetch("/api/navy/models", {
          headers: { "x-user-api-key": apiKey },
        });
        const payload = (await response.json()) as Record<string, unknown>;
        if (!response.ok) {
          const errorMessage = isRecord(payload.error)
            ? getString(payload.error.message, "Unable to fetch NavyAI models.")
            : getString(payload.error, "Unable to fetch NavyAI models.");
          throw new Error(errorMessage);
        }
        const rawModels = Array.isArray(payload.data) ? payload.data : [];
        if (!rawModels.length) {
          throw new Error("No models returned by NavyAI.");
        }

        const normalizedModels = asRecordArray(rawModels)
          .map((item) => {
            const id =
              getString(item.id) || getString(item.model) || getString(item.name);
            if (!id) return null;
            const label =
              getString(item.name) || getString(item.id) || getString(item.model) || "Unknown";
            return { id, label, raw: item };
          })
          .filter(
            (
              item
            ): item is { id: string; label: string; raw: Record<string, unknown> } =>
              item !== null
          );

        const filtered = normalizedModels.filter((item) =>
          isNavyModelForMode(item.raw, mode)
        );
        const fallbackModels =
          mode === "video"
            ? NAVY_VIDEO_MODELS
            : mode === "tts"
              ? NAVY_TTS_MODELS
              : NAVY_IMAGE_MODELS;
        const models = (filtered.length ? filtered : fallbackModels).map(
          (item) => ({
            id: item.id,
            label: item.label ?? item.id,
          })
        );

        if (!filtered.length) {
          setModelsError("Unable to detect model types. Showing defaults.");
        }

        if (mode === "video") {
          setNavyVideoModels(models);
        } else if (mode === "tts") {
          setNavyTtsModels(models);
        } else {
          setNavyImageModels(models);
        }

        if (!models.some((m: ModelOption) => m.id === model)) {
          setModel(models[0].id);
        }
      }
    } catch (error) {
      setModelsError(
        error instanceof Error ? error.message : "Unable to fetch models."
      );
    } finally {
      setModelsLoading(false);
    }
  };

  const refreshChutesChatModels = async () => {
    if (chutesChatModelsLoading) return;
    setChutesChatModelsError(null);
    if (!chutesChatKey.trim()) {
      setChutesChatModelsError("Add your Chutes API key to fetch models.");
      return;
    }
    setChutesChatModelsLoading(true);
    try {
      const response = await fetch("/api/chutes/models", {
        headers: { "x-user-api-key": chutesChatKey },
      });
      const payload = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        const errorMessage = isRecord(payload.error)
          ? getString(payload.error.message, "Unable to fetch Chutes models.")
          : getString(payload.error, "Unable to fetch Chutes models.");
        throw new Error(errorMessage);
      }
      const rawModels = Array.isArray(payload.data) ? payload.data : [];
      if (!rawModels.length) {
        throw new Error("No models returned by Chutes.");
      }
      const models = asRecordArray(rawModels)
        .map((item) => {
          const id = getString(item.id);
          if (!id) return null;
          const label = getString(item.id, getString(item.name, "Unknown"));
          return { id, label };
        })
        .filter((item): item is ModelOption => item !== null);

      setChutesChatModels(models);
      if (!models.some((entry: ModelOption) => entry.id === chutesChatModel)) {
        setChutesChatModel(models[0].id);
      }
    } catch (error) {
      setChutesChatModelsError(
        error instanceof Error ? error.message : "Unable to fetch models."
      );
    } finally {
      setChutesChatModelsLoading(false);
    }
  };

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

  const updateJobs = (updater: (prev: GenerationJob[]) => GenerationJob[]) => {
    setJobs((prev) => trimJobHistory(updater(prev)));
  };

  const updateJob = (id: string, updates: Partial<GenerationJob>) => {
    updateJobs((prev) =>
      prev.map((job) => (job.id === id ? { ...job, ...updates } : job))
    );
  };

  const startJob = (job: GenerationJob, message: string) => {
    updateJob(job.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      progress: message,
    });
    setStatusMessage(message);
    setErrorMessage(null);
  };

  const setJobProgress = (jobId: string, message: string) => {
    updateJob(jobId, { progress: message });
    setStatusMessage(message);
  };

  const completeJob = (jobId: string, message = "Ready.") => {
    updateJob(jobId, {
      status: "success",
      finishedAt: new Date().toISOString(),
      progress: "Completed",
    });
    setStatusMessage(message);
  };

  const failJob = (jobId: string, message: string) => {
    updateJob(jobId, {
      status: "error",
      finishedAt: new Date().toISOString(),
      error: message,
      progress: "Failed",
    });
    setErrorMessage(message);
    setStatusMessage("");
  };

  const getImageRequestFlags = (job: GenerationJob) => {
    const isImagenModel = job.model.startsWith("imagen-");
    const isOpenRouterGemini =
      job.provider === "openrouter" && job.model.includes("gemini");
    const allowCount = job.provider === "navy" || isImagenModel;
    const allowSize =
      job.provider === "gemini"
        ? job.model.includes("gemini-3-pro") || isImagenModel
        : job.provider === "navy" || isOpenRouterGemini;
    const allowAspect = job.provider === "gemini" || isOpenRouterGemini;
    return { allowCount, allowSize, allowAspect };
  };

  // Generation Functions
  const generateImages = async (job: GenerationJob) => {
    startJob(job, "Generating images...");
    try {
      let images: GeneratedImage[] = [];
      const { allowAspect, allowSize, allowCount } = getImageRequestFlags(job);

      if (job.provider === "gemini") {
        const response = await fetch("/api/gemini/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: job.apiKey,
            model: job.model,
            prompt: job.prompt,
            aspectRatio: allowAspect ? job.imageAspect : undefined,
            imageSize: allowSize ? job.imageSize : undefined,
            numberOfImages: allowCount ? job.imageCount : undefined,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Image generation failed.");
        images = buildGeneratedImages(payload);
        if (!images.length) {
          throw new Error("No images were returned by the model.");
        }
      } else if (job.provider === "navy") {
        const response = await fetch("/api/navy/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: job.apiKey,
            model: job.model,
            prompt: job.prompt,
            size: job.navyImageSize,
            numberOfImages: allowCount ? job.imageCount : undefined,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Image generation failed.");
        for (const image of payload.images) {
          const dataUrl = await fetchAsDataUrl(image.url);
          images.push({ id: createId(), dataUrl, mimeType: "image/png" });
        }
      } else if (job.provider === "openrouter") {
        const response = await fetch("/api/openrouter/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: job.apiKey,
            model: job.model,
            prompt: job.prompt,
            aspectRatio: allowAspect ? job.imageAspect : undefined,
            imageSize: allowSize ? job.imageSize : undefined,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Image generation failed.");
        images = buildGeneratedImages(payload);
        if (!images.length) {
          throw new Error("No images were returned by the model.");
        }
      } else {
        const guidanceScale = Number(job.chutesGuidanceScale);
        const width = Number(job.chutesWidth);
        const height = Number(job.chutesHeight);
        const numInferenceSteps = Number(job.chutesSteps);
        const resolution = job.chutesResolution.trim();
        const seedValue = job.chutesSeed.trim();
        const seed = seedValue.length ? Number(seedValue) : null;
        const response = await fetch("/api/chutes/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: job.apiKey,
            model: job.model,
            prompt: job.prompt,
            negativePrompt: job.negativePrompt || undefined,
            guidanceScale: Number.isFinite(guidanceScale) ? guidanceScale : undefined,
            width: Number.isFinite(width) ? width : undefined,
            height: Number.isFinite(height) ? height : undefined,
            numInferenceSteps: Number.isFinite(numInferenceSteps)
              ? numInferenceSteps
              : undefined,
            resolution: resolution.length ? resolution : undefined,
            seed: seed !== null && Number.isFinite(seed) ? seed : null,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Image generation failed.");
        images = buildGeneratedImages(payload);
        if (!images.length) {
          throw new Error("No images were returned by the model.");
        }
      }

      setGeneratedImages(images);
      await addMediaToGallery(
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
      });
      completeJob(job.id);
    } catch (error) {
      failJob(
        job.id,
        error instanceof Error ? error.message : "Image generation failed."
      );
    }
  };

  const generateGeminiVideo = async (job: GenerationJob) => {
    startJob(job, "Starting video generation...");
    try {
      const response = await fetch("/api/gemini/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: job.apiKey,
          model: job.model,
          prompt: job.prompt,
          aspectRatio: job.videoAspect,
          resolution: job.videoResolution,
          durationSeconds: job.videoDuration,
          negativePrompt: job.negativePrompt || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Video generation failed.");

      const operationName = payload.name as string;
      let pollCount = 0;
      while (pollCount < 120) {
        pollCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        setJobProgress(job.id, "Rendering on Veo... (about a minute)");

        const poll = await fetch(
          `/api/gemini/video?name=${encodeURIComponent(operationName)}`,
          {
            headers: { "x-user-api-key": job.apiKey },
          }
        );
        const pollPayload = await poll.json();
        if (!poll.ok) throw new Error(pollPayload.error ?? "Video generation failed.");

        if (pollPayload.done) {
          if (pollPayload.error) throw new Error(pollPayload.error);

          const download = await fetch("/api/gemini/video/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey: job.apiKey, uri: pollPayload.videoUri }),
          });
          if (!download.ok) throw new Error("Unable to download the rendered video.");

          const blob = await download.blob();
          const url = URL.createObjectURL(blob);
          updateVideoUrl(url);
          await addMediaToGallery(
            [{ url, mimeType: blob.type, blob }],
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
          });
          completeJob(job.id, "Video ready.");
          return;
        }
      }
      throw new Error("Video generation timed out.");
    } catch (error) {
      failJob(
        job.id,
        error instanceof Error ? error.message : "Video generation failed."
      );
    }
  };

  const generateNavyVideo = async (job: GenerationJob) => {
    startJob(job, "Queueing video...");
    try {
      const response = await fetch("/api/navy/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: job.apiKey, model: job.model, prompt: job.prompt }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Video generation failed.");

      const jobId = payload.id as string;
      let pollCount = 0;
      while (pollCount < 120) {
        pollCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        setJobProgress(job.id, "Rendering on NavyAI...");

        const poll = await fetch(
          `/api/navy/video?id=${encodeURIComponent(jobId)}`,
          {
            headers: { "x-user-api-key": job.apiKey },
          }
        );
        const pollPayload = await poll.json();
        if (!poll.ok) throw new Error(pollPayload.error ?? "Video generation failed.");

        if (pollPayload.done) {
          if (pollPayload.error) throw new Error(pollPayload.error);
          const remoteUrl = pollPayload.videoUrl as string;
          if (job.saveToGallery) {
            let blob: Blob | null = null;
            let displayUrl = remoteUrl;
            try {
              const download = await fetch("/api/navy/video/download", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-user-api-key": job.apiKey,
                },
                body: JSON.stringify({ url: remoteUrl }),
              });
              if (!download.ok) {
                throw new Error("Unable to download the rendered video.");
              }
              blob = await download.blob();
              displayUrl = URL.createObjectURL(blob);
            } catch {
              blob = null;
              displayUrl = remoteUrl;
            }

            updateVideoUrl(displayUrl);
            await addMediaToGallery(
              [
                {
                  url: displayUrl,
                  mimeType: blob?.type,
                  blob: blob ?? undefined,
                },
              ],
              {
                prompt: job.prompt,
                model: job.model,
                provider: job.provider,
                saveToGallery: job.saveToGallery,
                kind: "video",
              }
            );
          } else {
            updateVideoUrl(remoteUrl);
          }
          setLastOutput({
            mode: "video",
            prompt: job.prompt,
            model: job.model,
            provider: job.provider,
          });
          completeJob(job.id, "Video ready.");
          return;
        }
      }
      throw new Error("Video generation timed out.");
    } catch (error) {
      failJob(
        job.id,
        error instanceof Error ? error.message : "Video generation failed."
      );
    }
  };

  const generateTts = async (job: GenerationJob) => {
    startJob(job, "Synthesizing speech...");
    try {
      const speedValue = Number(job.ttsSpeed);
      const response = await fetch("/api/navy/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: job.apiKey,
          model: job.model,
          input: job.prompt,
          voice: job.ttsVoice,
          speed: Number.isFinite(speedValue) ? speedValue : undefined,
          responseFormat: job.ttsFormat,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Speech generation failed.");
      const audio = payload.audio;
      if (!audio?.data || !audio?.mimeType) {
        throw new Error("No audio data returned.");
      }
      const dataUrl = dataUrlFromBase64(audio.data, audio.mimeType);
      const audioBlob = await fetch(dataUrl).then((response) => response.blob());
      setAudioUrl(dataUrl);
      setAudioMimeType(audio.mimeType);
      await addMediaToGallery(
        [{ url: dataUrl, mimeType: audio.mimeType, blob: audioBlob }],
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
      });
      completeJob(job.id, "Audio ready.");
    } catch (error) {
      failJob(
        job.id,
        error instanceof Error ? error.message : "Speech generation failed."
      );
    }
  };

  const runJob = async (job: GenerationJob) => {
    if (job.mode === "image") {
      await generateImages(job);
      return;
    }
    if (job.mode === "video") {
      if (job.provider === "gemini") {
        await generateGeminiVideo(job);
        return;
      }
      if (job.provider === "navy") {
        await generateNavyVideo(job);
        return;
      }
      failJob(job.id, "Video generation is not available for this provider.");
      return;
    }
    if (job.provider === "navy") {
      await generateTts(job);
      return;
    }
    failJob(job.id, "Text-to-speech is only available for NavyAI.");
  };

  useEffect(() => {
    if (!hydrated) return;
    if (processingRef.current) return;
    const nextJob = jobs.find((job) => job.status === "queued");
    if (!nextJob) return;
    processingRef.current = true;
    runJob(nextJob).finally(() => {
      processingRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, hydrated]);

  const handleGenerate = () => {
    const trimmedKey = apiKey.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedKey) {
      setErrorMessage("Add your API key to start generating.");
      return;
    }
    if (!trimmedPrompt) {
      setErrorMessage("Write a prompt first.");
      return;
    }
    if (mode === "video" && !supportsVideo) {
      setErrorMessage("Video generation is not available for this provider.");
      return;
    }
    if (mode === "tts" && !supportsTts) {
      setErrorMessage("Text-to-speech is only available for NavyAI.");
      return;
    }

    const job: GenerationJob = {
      id: createId(),
      status: "queued",
      mode,
      provider,
      model,
      prompt: trimmedPrompt,
      apiKey: trimmedKey,
      createdAt: new Date().toISOString(),
      negativePrompt: negativePrompt.trim() || undefined,
      imageCount,
      imageAspect,
      imageSize,
      navyImageSize,
      chutesGuidanceScale,
      chutesWidth,
      chutesHeight,
      chutesSteps,
      chutesResolution,
      chutesSeed,
      videoAspect,
      videoResolution,
      videoDuration,
      ttsVoice,
      ttsFormat,
      ttsSpeed,
      saveToGallery,
    };

    updateJobs((prev) => [...prev, job]);
    setErrorMessage(null);
    if (runningJobs.length === 0) {
      setStatusMessage(`Queued ${mode} generation.`);
    }
  };

  if (!hydrated) return null; // Avoid hydration mismatch

  return (
    <div className="container mx-auto max-w-[1600px] animate-in fade-in slide-in-from-bottom-4 duration-700 space-y-8 p-4 md:p-6 lg:p-12 pb-32">
      <Header />

      <main className="grid grid-cols-1 gap-8 lg:gap-12 lg:grid-cols-12 items-start">
        {/* Left Column: Controls - Sticky on Desktop */}
        <div className="space-y-6 lg:col-span-4 lg:sticky lg:top-24 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto no-scrollbar rounded-2xl">
          <ImgGenSettings
            provider={provider}
            setProvider={setProvider}
            mode={mode}
            setMode={setMode}
            apiKey={apiKey}
            setApiKey={setApiKey}
            model={model}
            setModel={setModel}
            clearKey={clearKey}
            imageAspect={imageAspect}
            setImageAspect={setImageAspect}
            imageSize={imageSize}
            setImageSize={setImageSize}
            imageCount={imageCount}
            setImageCount={setImageCount}
            chutesGuidanceScale={chutesGuidanceScale}
            setChutesGuidanceScale={setChutesGuidanceScale}
            chutesWidth={chutesWidth}
            setChutesWidth={setChutesWidth}
            chutesHeight={chutesHeight}
            setChutesHeight={setChutesHeight}
            chutesSteps={chutesSteps}
            setChutesSteps={setChutesSteps}
            chutesResolution={chutesResolution}
            setChutesResolution={setChutesResolution}
            chutesSeed={chutesSeed}
            setChutesSeed={setChutesSeed}
            videoAspect={videoAspect}
            setVideoAspect={setVideoAspect}
            videoResolution={videoResolution}
            setVideoResolution={setVideoResolution}
            videoDuration={videoDuration}
            setVideoDuration={setVideoDuration}
            ttsVoice={ttsVoice}
            setTtsVoice={setTtsVoice}
            ttsFormat={ttsFormat}
            setTtsFormat={setTtsFormat}
            ttsSpeed={ttsSpeed}
            setTtsSpeed={setTtsSpeed}
            saveToGallery={saveToGallery}
            setSaveToGallery={setSaveToGallery}
            modelSuggestions={modelSuggestions}
            supportsVideo={supportsVideo}
            supportsTts={supportsTts}
            onRefreshModels={
              provider === "openrouter" || provider === "navy"
                ? refreshModels
                : undefined
            }
            modelsLoading={modelsLoading}
            modelsError={modelsError}
            navyUsage={navyUsage}
            navyUsageError={navyUsageError}
            navyUsageLoading={navyUsageLoading}
            navyUsageUpdatedAt={navyUsageUpdatedAt}
            onRefreshUsage={provider === "navy" ? refreshNavyUsage : undefined}
          />

          {/* Storage Snapshot Mini-Card */}
          <div className="glass-card rounded-xl p-4 text-xs">
            <div className="flex items-center justify-between gap-4 mb-2">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider">Local Storage</span>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={refreshStorageEstimate}>
                Refresh
              </Button>
            </div>
            {storageError ? (
              <p className="text-destructive">{storageError}</p>
            ) : storageSnapshot ? (
              <div className="space-y-2">
                <div className="w-full bg-secondary h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-primary h-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (storageSnapshot.usage / storageSnapshot.quota) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{formatBytes(storageSnapshot.usage)} used</span>
                  <span>{formatBytes(storageSnapshot.quota)} total</span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground">Checking...</p>
            )}
          </div>
        </div>

        {/* Right Column: Prompt & Preview */}
        <div className="space-y-8 lg:col-span-8 min-h-[50vh]">
          <div className="glass-card rounded-2xl shadow-xl transition-all duration-300 hover:shadow-2xl hover:border-primary/20">
            <div className="p-6 lg:p-8 space-y-8">
              <PromptInput
                prompt={prompt}
                setPrompt={setPrompt}
                negativePrompt={negativePrompt}
                setNegativePrompt={setNegativePrompt}
                onGenerate={handleGenerate}
                busy={hasActiveJobs}
                mode={mode}
                showNegativePrompt={mode !== "tts"}
              />

              {/* Status & Errors */}
              <div className="min-h-[24px] text-center">
                {errorMessage ? (
                  <p className="text-sm font-semibold text-destructive animate-in fade-in">{errorMessage}</p>
                ) : statusMessage ? (
                  <p className="text-sm text-muted-foreground animate-in fade-in flex items-center justify-center gap-2">
                    {hasActiveJobs && <Loader2 className="h-3 w-3 animate-spin" />}
                    {statusMessage}
                  </p>
                ) : null}
              </div>

              {jobs.length > 0 && (
                <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">Background queue</span>
                    <span className="text-muted-foreground">
                      {runningJobs.length} running · {queuedJobs.length} queued
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {recentJobs.map((job) => {
                      const statusLabel =
                        job.status === "running"
                          ? job.progress ?? "Running"
                          : job.status === "queued"
                            ? "Queued"
                            : job.status === "success"
                              ? "Completed"
                              : "Failed";
                      return (
                        <div key={job.id} className="flex items-center justify-between gap-3">
                          <span className="truncate">
                            {job.mode.toUpperCase()} · {job.provider} · {job.prompt}
                          </span>
                          <span
                            className="text-muted-foreground"
                            title={job.status === "error" ? job.error : undefined}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Output Preview Area */}
          {hasOutput && (
            <section className="animate-in slide-in-from-bottom-4 fade-in duration-500">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight">Latest Generation</h2>
              </div>

              {lastOutput?.mode === "image" && generatedImages.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {generatedImages.map((img) => (
                    <div key={img.id} className="relative rounded-xl overflow-hidden border shadow-lg group">
                      <img src={img.dataUrl} alt="Generated" className="w-full h-auto object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                        <button
                          type="button"
                          onClick={() =>
                            setViewerImage({
                              dataUrl: img.dataUrl,
                              prompt: lastOutput?.prompt ?? "",
                              model: lastOutput?.model ?? "",
                              provider: lastOutput?.provider ?? provider,
                            })
                          }
                          className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform"
                          aria-label="View full screen"
                        >
                          <Maximize2 className="h-5 w-5" />
                        </button>
                        <a href={img.dataUrl} download={`generated-${img.id}.png`} className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform">
                          <Download className="h-5 w-5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : lastOutput?.mode === "video" && videoUrl ? (
                <div className="rounded-xl overflow-hidden border shadow-lg bg-black">
                  <video src={videoUrl} controls className="w-full aspect-video" />
                  <div className="p-4 bg-card flex justify-between items-center">
                    <span className="text-sm text-muted-foreground font-mono">
                      {lastOutput?.model ?? model}
                    </span>
                    <Button variant="outline" size="sm" asChild>
                      <a href={videoUrl} download="generated-video.mp4">
                        <Download className="mr-2 h-4 w-4" /> Download
                      </a>
                    </Button>
                  </div>
                </div>
              ) : lastOutput?.mode === "tts" && audioUrl ? (
                <div className="rounded-xl overflow-hidden border shadow-lg bg-card">
                  <div className="p-4">
                    <audio src={audioUrl} controls className="w-full" />
                  </div>
                  <div className="p-4 border-t flex justify-between items-center">
                    <span className="text-sm text-muted-foreground font-mono">
                      {lastOutput?.model ?? model} · {lastOutput?.ttsVoice ?? ttsVoice}
                    </span>
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={audioUrl}
                        download={`generated-audio.${audioMimeType?.includes("opus")
                          ? "opus"
                          : audioMimeType?.includes("aac")
                            ? "aac"
                            : audioMimeType?.includes("flac")
                              ? "flac"
                              : "mp3"
                          }`}
                      >
                        <Download className="mr-2 h-4 w-4" /> Download
                      </a>
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          )}

          <ChutesChat
            apiKey={provider === "chutes" ? apiKey : chutesChatKey}
            models={chutesChatModels}
            model={chutesChatModel}
            setModel={setChutesChatModel}
            imageModels={CHUTES_IMAGE_MODELS}
            toolImageModel={chutesToolImageModel}
            setToolImageModel={setChutesToolImageModel}
            onRefreshModels={refreshChutesChatModels}
            modelsLoading={chutesChatModelsLoading}
            modelsError={chutesChatModelsError}
          />
        </div>
      </main>

      <section className="space-y-8 pt-24 pb-12">
        <div className="flex items-center gap-4">
          <h2 className="text-3xl font-serif text-gradient font-bold tracking-tight">Gallery</h2>
          <div className="h-px flex-1 bg-border/60" />
          <Button variant="ghost" size="sm" className="hidden lg:flex" onClick={clearGallery}>
            Clear All
          </Button>
        </div>
        <GalleryGrid items={savedMedia} onClear={clearGallery} />
      </section>
      <ImageViewer
        open={!!viewerImage}
        onOpenChange={closeViewer}
        imageUrl={viewerImage?.dataUrl ?? null}
        prompt={viewerImage?.prompt ?? ""}
        model={viewerImage?.model ?? ""}
        provider={viewerImage?.provider ?? ""}
      />

    </div>
  );
}
