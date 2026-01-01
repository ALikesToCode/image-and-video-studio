"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_MODELS,
  GEMINI_IMAGE_MODELS,
  GEMINI_VIDEO_MODELS,
  CHUTES_IMAGE_MODELS,
  OPENROUTER_IMAGE_MODELS,
  NAVY_IMAGE_MODELS,
  NAVY_VIDEO_MODELS,
  IMAGE_ASPECTS,
  IMAGE_SIZES,
  IMAGEN_SIZES,
  VIDEO_ASPECTS,
  VIDEO_RESOLUTIONS,
  VIDEO_DURATIONS,
  type Provider,
  type Mode,
} from "@/lib/constants";
import { type GeneratedImage, type StoredImage } from "@/lib/types";
import { cn, dataUrlFromBase64, fetchAsDataUrl } from "@/lib/utils";
import { Header } from "./Header";
import { ImgGenSettings } from "./img-gen-settings";
import { PromptInput } from "./prompt-input";
import { GalleryGrid } from "./gallery-grid";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Download, Film, Image as ImageIcon, Loader2 } from "lucide-react";

const STORAGE_KEYS = {
  provider: "studio_provider",
  mode: "studio_mode",
  keyGemini: "studio_api_key_gemini",
  keyNavy: "studio_api_key_navy",
  keyChutes: "studio_api_key_chutes",
  keyOpenRouter: "studio_api_key_openrouter",
  images: "studio_saved_images",
};

const MAX_SAVED_IMAGES = 12;

const getKeyStorage = (provider: Provider) => {
  if (provider === "gemini") return STORAGE_KEYS.keyGemini;
  if (provider === "navy") return STORAGE_KEYS.keyNavy;
  if (provider === "openrouter") return STORAGE_KEYS.keyOpenRouter;
  return STORAGE_KEYS.keyChutes;
};

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

export default function Studio() {
  const [hydrated, setHydrated] = useState(false);
  const [provider, setProvider] = useState<Provider>("gemini");
  const [mode, setMode] = useState<Mode>("image");
  const [apiKey, setApiKey] = useState("");

  const [model, setModel] = useState(DEFAULT_MODELS.gemini.image);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [imageAspect, setImageAspect] = useState(IMAGE_ASPECTS[0]);
  const [imageSize, setImageSize] = useState(IMAGE_SIZES[0]);
  const [navyImageSize, setNavyImageSize] = useState("1024x1024"); // Default
  const [videoAspect, setVideoAspect] = useState(VIDEO_ASPECTS[0]);
  const [videoResolution, setVideoResolution] = useState(VIDEO_RESOLUTIONS[0]);
  const [videoDuration, setVideoDuration] = useState(VIDEO_DURATIONS[2]);
  const [saveToGallery, setSaveToGallery] = useState(true);

  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [savedImages, setSavedImages] = useState<StoredImage[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeVideoUrl = useRef<string | null>(null);

  const isChutesProvider = provider === "chutes";
  const isOpenRouterProvider = provider === "openrouter";
  const supportsVideo = provider === "gemini" || provider === "navy";
  const isImagenModel = model.startsWith("imagen-");
  const isOpenRouterGemini = isOpenRouterProvider && model.includes("gemini");
  const showImageCount = provider === "navy" || isImagenModel;
  const showImageSize =
    provider === "gemini"
      ? model.includes("gemini-3-pro") || isImagenModel
      : provider === "navy" || (isOpenRouterProvider && isOpenRouterGemini);
  const showImageAspect = provider === "gemini" || isOpenRouterGemini;

  // Hydration & Persistence
  useEffect(() => {
    setHydrated(true);
    const storedProvider = readLocalStorage<Provider | null>(STORAGE_KEYS.provider, null);
    const storedMode = readLocalStorage<Mode | null>(STORAGE_KEYS.mode, null);
    const storedImages = readLocalStorage<StoredImage[]>(STORAGE_KEYS.images, []);

    if (storedProvider) {
      setProvider(storedProvider);
      // Ensure model is valid for the provider/mode
      setModel(DEFAULT_MODELS[storedProvider][storedMode ?? "image"]);
    }
    if (storedMode) {
      setMode(storedMode);
    }
    setSavedImages(storedImages);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(STORAGE_KEYS.provider, JSON.stringify(provider));
  }, [provider, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeLocalStorage(STORAGE_KEYS.mode, JSON.stringify(mode));
    // When mode changes or provider changes, reset model to default if not set manually
    // But here we just respect the user selection, logic below handles switch
    if (!model) setModel(DEFAULT_MODELS[provider][mode]);
  }, [mode, provider, hydrated, model]);

  useEffect(() => {
    if (!hydrated) return;
    // When switching modes, ensure model is correct if needed
    setModel(DEFAULT_MODELS[provider][mode]);
  }, [mode, provider]);

  useEffect(() => {
    if (!hydrated) return;
    const storedKey = readLocalStorage<string>(getKeyStorage(provider), "");
    setApiKey(storedKey);
  }, [provider, hydrated]);

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
    try {
      writeLocalStorage(STORAGE_KEYS.images, JSON.stringify(savedImages));
    } catch {
      setErrorMessage("Local storage is full. Clear some saved images.");
    }
  }, [savedImages, hydrated]);

  useEffect(() => {
    return () => {
      if (activeVideoUrl.current?.startsWith("blob:")) {
        URL.revokeObjectURL(activeVideoUrl.current);
      }
    };
  }, []);

  const updateVideoUrl = (url: string) => {
    if (activeVideoUrl.current?.startsWith("blob:")) {
      URL.revokeObjectURL(activeVideoUrl.current);
    }
    activeVideoUrl.current = url;
    setVideoUrl(url);
  };

  const clearVideoUrl = () => {
    if (activeVideoUrl.current?.startsWith("blob:")) {
      URL.revokeObjectURL(activeVideoUrl.current);
    }
    activeVideoUrl.current = null;
    setVideoUrl(null);
  };

  const addImagesToGallery = (newImages: GeneratedImage[]) => {
    if (!saveToGallery) return;
    const entries: StoredImage[] = newImages.map((image) => ({
      id: createId(),
      dataUrl: image.dataUrl,
      prompt,
      model,
      provider,
      createdAt: new Date().toISOString(),
    }));
    setSavedImages((prev) => [...entries, ...prev].slice(0, MAX_SAVED_IMAGES));
  };

  const clearGallery = () => {
    setSavedImages([]);
    window.localStorage.removeItem(STORAGE_KEYS.images);
  };

  const clearKey = () => setApiKey("");

  const resetStatus = () => {
    setErrorMessage(null);
    setStatusMessage("");
  };

  // Generation Functions
  const generateImages = async () => {
    resetStatus();
    setBusy(true);
    setGeneratedImages([]);
    try {
      let images: GeneratedImage[] = [];

      if (provider === "gemini") {
        const response = await fetch("/api/gemini/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            model,
            prompt,
            aspectRatio: showImageAspect ? imageAspect : undefined,
            imageSize: showImageSize ? imageSize : undefined,
            numberOfImages: showImageCount ? imageCount : undefined,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Image generation failed.");
        images = payload.images.map((image: any) => ({
          id: createId(),
          dataUrl: dataUrlFromBase64(image.data, image.mimeType),
          mimeType: image.mimeType,
        }));
      } else if (provider === "navy") {
        const response = await fetch("/api/navy/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            model,
            prompt,
            size: navyImageSize, // Assuming this is handled somewhere or we rely on default
            numberOfImages: showImageCount ? imageCount : undefined,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Image generation failed.");
        for (const image of payload.images) {
          const dataUrl = await fetchAsDataUrl(image.url);
          images.push({ id: createId(), dataUrl, mimeType: "image/png" });
        }
      } else if (provider === "openrouter") {
        const response = await fetch("/api/openrouter/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            model,
            prompt,
            aspectRatio: showImageAspect ? imageAspect : undefined,
            imageSize: showImageSize ? imageSize : undefined,
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
        // Chutes
        const response = await fetch("/api/chutes/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, prompt }),
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
      addImagesToGallery(images);
      setStatusMessage("Ready.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const generateGeminiVideo = async () => {
    resetStatus();
    setBusy(true);
    clearVideoUrl();
    setStatusMessage("Starting video generation...");
    try {
      const response = await fetch("/api/gemini/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          model,
          prompt,
          aspectRatio: videoAspect,
          resolution: videoResolution,
          durationSeconds: videoDuration,
          negativePrompt: negativePrompt || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Video generation failed.");

      const operationName = payload.name as string;
      let pollCount = 0;
      while (pollCount < 120) {
        pollCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        setStatusMessage("Rendering on Veo... (about a minute)");

        const poll = await fetch(`/api/gemini/video?name=${encodeURIComponent(operationName)}`, {
          headers: { "x-user-api-key": apiKey },
        });
        const pollPayload = await poll.json();
        if (!poll.ok) throw new Error(pollPayload.error ?? "Video generation failed.");

        if (pollPayload.done) {
          if (pollPayload.error) throw new Error(pollPayload.error);

          const download = await fetch("/api/gemini/video/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, uri: pollPayload.videoUri }),
          });
          if (!download.ok) throw new Error("Unable to download the rendered video.");

          const blob = await download.blob();
          const url = URL.createObjectURL(blob);
          updateVideoUrl(url);
          setStatusMessage("Video ready.");
          return;
        }
      }
      throw new Error("Video generation timed out.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Video generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const generateNavyVideo = async () => {
    resetStatus();
    setBusy(true);
    clearVideoUrl();
    setStatusMessage("Queueing video...");
    try {
      const response = await fetch("/api/navy/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, model, prompt }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Video generation failed.");

      const jobId = payload.id as string;
      let pollCount = 0;
      while (pollCount < 120) {
        pollCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        setStatusMessage("Rendering on NavyAI...");

        const poll = await fetch(`/api/navy/video?id=${encodeURIComponent(jobId)}`, {
          headers: { "x-user-api-key": apiKey },
        });
        const pollPayload = await poll.json();
        if (!poll.ok) throw new Error(pollPayload.error ?? "Video generation failed.");

        if (pollPayload.done) {
          if (pollPayload.error) throw new Error(pollPayload.error);
          updateVideoUrl(pollPayload.videoUrl as string);
          setStatusMessage("Video ready.");
          return;
        }
      }
      throw new Error("Video generation timed out.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Video generation failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    if (!apiKey.trim()) {
      setErrorMessage("Add your API key to start generating.");
      return;
    }
    if (!prompt.trim()) {
      setErrorMessage("Write a prompt first.");
      return;
    }
    if (mode === "image") {
      await generateImages();
    } else {
      if (provider === "gemini") await generateGeminiVideo();
      else if (provider === "navy") await generateNavyVideo();
      else setErrorMessage("Video generation is not available for this provider.");
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
            saveToGallery={saveToGallery}
            setSaveToGallery={setSaveToGallery}
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
                busy={busy}
                mode={mode}
              />

              {/* Status & Errors */}
              <div className="min-h-[24px] text-center">
                {errorMessage ? (
                  <p className="text-sm font-semibold text-destructive animate-in fade-in">{errorMessage}</p>
                ) : statusMessage ? (
                  <p className="text-sm text-muted-foreground animate-in fade-in flex items-center justify-center gap-2">
                    {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                    {statusMessage}
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Output Preview Area */}
          {(generatedImages.length > 0 || videoUrl) && (
            <section className="animate-in slide-in-from-bottom-4 fade-in duration-500">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold tracking-tight">Latest Generation</h2>
              </div>

              {mode === "image" && generatedImages.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {generatedImages.map((img) => (
                    <div key={img.id} className="relative rounded-xl overflow-hidden border shadow-lg group">
                      <img src={img.dataUrl} alt="Generated" className="w-full h-auto object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
                        <a href={img.dataUrl} download={`generated-${img.id}.png`} className="p-3 bg-white text-black rounded-full hover:scale-110 transition-transform">
                          <Download className="h-5 w-5" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : videoUrl ? (
                <div className="rounded-xl overflow-hidden border shadow-lg bg-black">
                  <video src={videoUrl} controls className="w-full aspect-video" />
                  <div className="p-4 bg-card flex justify-between items-center">
                    <span className="text-sm text-muted-foreground font-mono">{model}</span>
                    <Button variant="outline" size="sm" asChild>
                      <a href={videoUrl} download="generated-video.mp4">
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
      <GalleryGrid images={savedImages} onClear={clearGallery} />

    </div>
  );
}
