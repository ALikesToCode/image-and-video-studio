"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MODELS,
  GEMINI_IMAGE_MODELS,
  GEMINI_VIDEO_MODELS,
  CHUTES_IMAGE_MODELS,
  OPENROUTER_IMAGE_MODELS,
  NAVY_IMAGE_MODELS,
  NAVY_VIDEO_MODELS,
  NAVY_TTS_MODELS,
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  IMAGEN_SIZES,
  VIDEO_ASPECTS,
  VIDEO_RESOLUTIONS,
  VIDEO_DURATIONS,
  TTS_FORMATS,
  TTS_VOICES,
  type Provider,
  type Mode,
  type ModelOption,
} from "@/lib/constants";
import { type GeneratedImage, type StoredImage } from "@/lib/types";
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

type StoredImageRecord = Omit<StoredImage, "dataUrl"> & { dataUrl?: string };

type StorageSnapshot = {
  usage: number;
  quota: number;
  persistent: boolean | null;
};

type NavyUsageResponse = {
  plan: string;
  limits: {
    tokens_per_day: number;
    rpm: number;
  };
  usage: {
    tokens_used_today: number;
    tokens_remaining_today: number;
    percent_used: number;
    resets_at_utc: string;
    resets_in_ms: number;
  };
  rate_limits: {
    per_minute: {
      limit: number;
      used: number;
      remaining: number;
      resets_in_ms: number;
    };
  };
  server_time_utc: string;
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
};

const MAX_SAVED_IMAGES = 12;
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
  const [navyImageSize, setNavyImageSize] = useState("1024x1024"); // Default
  const [videoAspect, setVideoAspect] = useState(VIDEO_ASPECTS[0]);
  const [videoResolution, setVideoResolution] = useState(VIDEO_RESOLUTIONS[0]);
  const [videoDuration, setVideoDuration] = useState(VIDEO_DURATIONS[2]);
  const [ttsVoice, setTtsVoice] = useState(TTS_VOICES[0]);
  const [ttsFormat, setTtsFormat] = useState(TTS_FORMATS[0]);
  const [ttsSpeed, setTtsSpeed] = useState("1");
  const [saveToGallery, setSaveToGallery] = useState(true);

  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [savedImages, setSavedImages] = useState<StoredImage[]>([]);
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
  const prevSavedImagesRef = useRef<StoredImage[]>([]);

  const isOpenRouterProvider = provider === "openrouter";
  const supportsVideo = provider === "gemini" || provider === "navy";
  const supportsTts = provider === "navy";
  const isImagenModel = model.startsWith("imagen-");
  const isOpenRouterGemini = isOpenRouterProvider && model.includes("gemini");
  const showImageCount = provider === "navy" || isImagenModel;
  const showImageSize =
    provider === "gemini"
      ? model.includes("gemini-3-pro") || isImagenModel
      : provider === "navy" || (isOpenRouterProvider && isOpenRouterGemini);
  const showImageAspect = provider === "gemini" || isOpenRouterGemini;
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
    const storedImages = readLocalStorage<StoredImageRecord[]>(STORAGE_KEYS.images, []);
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
    const loadSavedImages = async () => {
      if (!storedImages.length) return;
      if (!idbAvailable) {
        const legacyEntries = storedImages.filter(
          (item): item is StoredImageRecord & { dataUrl: string } =>
            typeof item.dataUrl === "string" && item.dataUrl.length > 0
        );
        if (legacyEntries.length) {
          setSavedImages(
            legacyEntries.map((item) => ({
              id: item.id,
              dataUrl: item.dataUrl,
              prompt: item.prompt,
              model: item.model,
              provider: item.provider,
              createdAt: item.createdAt,
            }))
          );
        }
        setErrorMessage("IndexedDB is unavailable. Gallery saves may be limited.");
        return;
      }
      const entries: StoredImage[] = [];
      for (const item of storedImages) {
        try {
          let blob = await getGalleryBlob(item.id);
          if (!blob && item.dataUrl) {
            const response = await fetch(item.dataUrl);
            if (!response.ok) {
              throw new Error("Unable to migrate gallery image.");
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
          });
        } catch (error) {
          setErrorMessage(
            error instanceof Error ? error.message : "Unable to load saved images."
          );
        }
      }
      setSavedImages(entries);
    };

    void loadSavedImages();
  }, []);

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
    void refreshStorageEstimate();
  }, [hydrated, savedImages, refreshStorageEstimate]);

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
    writeLocalStorage(getModelStorageKey(provider, mode), JSON.stringify(model));
  }, [model, provider, mode, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const storedImages: StoredImageRecord[] = savedImages.map((image) => ({
        id: image.id,
        prompt: image.prompt,
        model: image.model,
        provider: image.provider,
        createdAt: image.createdAt,
        ...(idbAvailable ? {} : { dataUrl: image.dataUrl }),
      }));
      writeLocalStorage(STORAGE_KEYS.images, JSON.stringify(storedImages));
    } catch {
      setErrorMessage("Local storage is full. Clear some saved images.");
    }
  }, [savedImages, hydrated, idbAvailable]);

  useEffect(() => {
    const previous = prevSavedImagesRef.current;
    const currentIds = new Set(savedImages.map((image) => image.id));
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
    prevSavedImagesRef.current = savedImages;
  }, [savedImages, idbAvailable]);

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
    return () => {
      if (activeVideoUrl.current?.startsWith("blob:")) {
        URL.revokeObjectURL(activeVideoUrl.current);
      }
      galleryUrlsRef.current.forEach((url) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
        }
      });
      galleryUrlsRef.current.clear();
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

  const addImagesToGallery = async (
    newImages: GeneratedImage[],
    metadata: { prompt: string; model: string; provider: Provider; saveToGallery: boolean }
  ) => {
    if (!metadata.saveToGallery) return;
    try {
      if (!idbAvailable) {
        const entries: StoredImage[] = newImages.map((image) => ({
          id: createId(),
          dataUrl: image.dataUrl,
          prompt: metadata.prompt,
          model: metadata.model,
          provider: metadata.provider,
          createdAt: new Date().toISOString(),
        }));
        setSavedImages((prev) => [...entries, ...prev].slice(0, MAX_SAVED_IMAGES));
        return;
      }
      const entries: StoredImage[] = [];
      for (const image of newImages) {
        const id = createId();
        const response = await fetch(image.dataUrl);
        if (!response.ok) {
          throw new Error("Unable to save generated image.");
        }
        const blob = await response.blob();
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
        });
      }

      setSavedImages((prev) => [...entries, ...prev].slice(0, MAX_SAVED_IMAGES));
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
    prevSavedImagesRef.current = [];
    setSavedImages([]);
    window.localStorage.removeItem(STORAGE_KEYS.images);
    if (idbAvailable) {
      void clearGalleryStore().catch((error) => {
        setErrorMessage(
          error instanceof Error ? error.message : "Unable to clear saved images."
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
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to fetch OpenRouter models.");
        }
        const rawModels = Array.isArray(payload?.data) ? payload.data : [];
        if (!rawModels.length) {
          throw new Error("No models returned by OpenRouter.");
        }

        const normalizedModels = rawModels
          .map((item: any) => ({
            id: item?.id,
            label: item?.name ?? item?.id,
            raw: item,
          }))
          .filter((item: any) => typeof item.id === "string" && item.id.length > 0);

        const filtered = normalizedModels.filter((item: any) =>
          isOpenRouterModelForMode(item.raw as Record<string, unknown>, mode)
        );
        const fallbackModels = OPENROUTER_IMAGE_MODELS;
        const models = (filtered.length ? filtered : fallbackModels).map(
          (item: any) => ({
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
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to fetch NavyAI models.");
        }
        const rawModels = Array.isArray(payload?.data) ? payload.data : [];
        if (!rawModels.length) {
          throw new Error("No models returned by NavyAI.");
        }

        const normalizedModels = rawModels
          .map((item: any) => {
            const id = item?.id ?? item?.model ?? item?.name;
            const label = item?.name ?? item?.id ?? item?.model ?? "Unknown";
            return { id, label, raw: item };
          })
          .filter((item: any) => typeof item.id === "string" && item.id.length > 0);

        const filtered = normalizedModels.filter((item: any) =>
          isNavyModelForMode(item.raw as Record<string, unknown>, mode)
        );
        const fallbackModels =
          mode === "video"
            ? NAVY_VIDEO_MODELS
            : mode === "tts"
              ? NAVY_TTS_MODELS
              : NAVY_IMAGE_MODELS;
        const models = (filtered.length ? filtered : fallbackModels).map(
          (item: any) => ({
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
        images = payload.images.map((image: any) => ({
          id: createId(),
          dataUrl: dataUrlFromBase64(image.data, image.mimeType),
          mimeType: image.mimeType,
        }));
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
        images = payload.images.map((image: any) => ({
          id: createId(),
          dataUrl: dataUrlFromBase64(image.data, image.mimeType),
          mimeType: image.mimeType,
        }));
      } else {
        const response = await fetch("/api/chutes/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey: job.apiKey, prompt: job.prompt }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Image generation failed.");
        images = payload.images.map((image: any) => ({
          id: createId(),
          dataUrl: dataUrlFromBase64(image.data, image.mimeType),
          mimeType: image.mimeType,
        }));
      }

      setGeneratedImages(images);
      await addImagesToGallery(images, {
        prompt: job.prompt,
        model: job.model,
        provider: job.provider,
        saveToGallery: job.saveToGallery,
      });
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
          updateVideoUrl(pollPayload.videoUrl as string);
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
      setAudioUrl(dataUrl);
      setAudioMimeType(audio.mimeType);
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
  }, [jobs, hydrated, runJob]);

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
    <div className="container mx-auto max-w-7xl animate-in fade-in space-y-8 p-6 lg:p-12">
      <Header />

      <main className="grid grid-cols-1 gap-12 lg:grid-cols-12">
        {/* Left Column: Controls */}
        <div className="space-y-8 lg:col-span-4 lg:space-y-12">
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
          />
        </div>

        {/* Right Column: Prompt & Preview */}
        <div className="space-y-8 lg:col-span-8">
          <Card className="border-2 border-primary/10 shadow-xl bg-card/50 backdrop-blur-3xl">
            <CardContent className="p-6 lg:p-8 space-y-8">
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
            </CardContent>
          </Card>

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
        </div>
      </main>

      <div className="my-12 h-px bg-border/50" />

      {/* Gallery Section */}
      <div className="rounded-xl border bg-card/50 p-4 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="font-semibold">Storage usage</span>
          <Button variant="ghost" size="sm" onClick={refreshStorageEstimate}>
            Refresh
          </Button>
        </div>
        {storageError ? (
          <p className="mt-2 text-xs text-destructive">{storageError}</p>
        ) : storageSnapshot ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {formatBytes(storageSnapshot.usage)} of{" "}
              {formatBytes(storageSnapshot.quota)} used
            </span>
            {storageSnapshot.quota > 0 && (
              <span>
                ({Math.min(
                  100,
                  Math.round(
                    (storageSnapshot.usage / storageSnapshot.quota) * 100
                  )
                )}
                %)
              </span>
            )}
            {storageSnapshot.persistent !== null && (
              <span>
                Persistence: {storageSnapshot.persistent ? "granted" : "not granted"}
              </span>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Checking storage...</p>
        )}
      </div>

      <GalleryGrid images={savedImages} onClear={clearGallery} />
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
