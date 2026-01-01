"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Provider = "gemini" | "navy";

type Mode = "image" | "video";

type StoredImage = {
  id: string;
  dataUrl: string;
  prompt: string;
  model: string;
  provider: Provider;
  createdAt: string;
};

type GeneratedImage = {
  id: string;
  dataUrl: string;
  mimeType: string;
};

const STORAGE_KEYS = {
  provider: "studio_provider",
  mode: "studio_mode",
  keyGemini: "studio_api_key_gemini",
  keyNavy: "studio_api_key_navy",
  images: "studio_saved_images",
};

const MAX_SAVED_IMAGES = 12;

const GEMINI_IMAGE_MODELS = [
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

const GEMINI_VIDEO_MODELS = [
  {
    id: "veo-3.1-generate-preview",
    label: "Veo 3.1 Preview",
  },
  {
    id: "veo-3.1-fast-generate-preview",
    label: "Veo 3.1 Fast Preview",
  },
];

const NAVY_IMAGE_MODELS = [
  {
    id: "flux.1-schnell",
    label: "Flux 1 Schnell",
  },
  {
    id: "dall-e-3",
    label: "DALL-E 3",
  },
];

const NAVY_VIDEO_MODELS = [
  {
    id: "veo-3.1",
    label: "Veo 3.1",
  },
  {
    id: "cogvideox-flash",
    label: "CogVideoX Flash",
  },
];

const IMAGE_ASPECTS = ["1:1", "3:4", "4:3", "9:16", "16:9"];
const IMAGE_SIZES = ["1K", "2K", "4K"];
const IMAGEN_SIZES = ["1K", "2K"];
const VIDEO_ASPECTS = ["16:9", "9:16"];
const VIDEO_RESOLUTIONS = ["720p", "1080p"];
const VIDEO_DURATIONS = ["4", "6", "8"];

const DEFAULT_MODELS: Record<Provider, Record<Mode, string>> = {
  gemini: {
    image: GEMINI_IMAGE_MODELS[0].id,
    video: GEMINI_VIDEO_MODELS[0].id,
  },
  navy: {
    image: NAVY_IMAGE_MODELS[0].id,
    video: NAVY_VIDEO_MODELS[0].id,
  },
};

const getKeyStorage = (provider: Provider) =>
  provider === "gemini" ? STORAGE_KEYS.keyGemini : STORAGE_KEYS.keyNavy;

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

const dataUrlFromBase64 = (data: string, mimeType: string) =>
  `data:${mimeType};base64,${data}`;

const fetchAsDataUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Unable to fetch the generated asset.");
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Unable to read the asset."));
    reader.readAsDataURL(blob);
  });
};

export default function Studio() {
  const [hydrated, setHydrated] = useState(false);
  const [provider, setProvider] = useState<Provider>("gemini");
  const [mode, setMode] = useState<Mode>("image");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const [model, setModel] = useState(DEFAULT_MODELS.gemini.image);
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [imageAspect, setImageAspect] = useState(IMAGE_ASPECTS[0]);
  const [imageSize, setImageSize] = useState(IMAGE_SIZES[0]);
  const [navyImageSize, setNavyImageSize] = useState("1024x1024");
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

  const modelSuggestions = useMemo(() => {
    if (provider === "gemini") {
      return mode === "image" ? GEMINI_IMAGE_MODELS : GEMINI_VIDEO_MODELS;
    }
    return mode === "image" ? NAVY_IMAGE_MODELS : NAVY_VIDEO_MODELS;
  }, [provider, mode]);

  const isImagenModel = model.startsWith("imagen-");
  const showImageCount = provider === "navy" || isImagenModel;
  const showImageSize =
    provider === "gemini"
      ? model.includes("gemini-3-pro") || isImagenModel
      : true;
  const showImageAspect = provider === "gemini";
  const sizeOptions = isImagenModel ? IMAGEN_SIZES : IMAGE_SIZES;

  useEffect(() => {
    if (isImagenModel && imageSize === "4K") {
      setImageSize("2K");
    }
  }, [isImagenModel, imageSize]);

  useEffect(() => {
    setHydrated(true);
    const storedProvider = readLocalStorage<Provider | null>(
      STORAGE_KEYS.provider,
      null
    );
    const storedMode = readLocalStorage<Mode | null>(STORAGE_KEYS.mode, null);
    const storedImages = readLocalStorage<StoredImage[]>(
      STORAGE_KEYS.images,
      []
    );
    if (storedProvider) {
      setProvider(storedProvider);
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
    setModel(DEFAULT_MODELS[provider][mode]);
  }, [mode, provider, hydrated]);

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

  const clearKey = () => {
    setApiKey("");
  };

  const resetStatus = () => {
    setErrorMessage(null);
    setStatusMessage("");
  };

  const handleImageCountChange = (value: string) => {
    const next = Math.max(1, Math.min(4, Number(value || 1)));
    setImageCount(next);
  };

  const generateImages = async () => {
    resetStatus();
    setBusy(true);
    setGeneratedImages([]);
    try {
      if (provider === "gemini") {
        const response = await fetch("/api/gemini/image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
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
        if (!response.ok) {
          throw new Error(payload.error ?? "Image generation failed.");
        }
        const images: GeneratedImage[] = payload.images.map(
          (image: { data: string; mimeType: string }) => ({
            id: createId(),
            dataUrl: dataUrlFromBase64(image.data, image.mimeType),
            mimeType: image.mimeType,
          })
        );
        setGeneratedImages(images);
        addImagesToGallery(images);
      } else {
        const response = await fetch("/api/navy/image", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            apiKey,
            model,
            prompt,
            size: navyImageSize,
            numberOfImages: showImageCount ? imageCount : undefined,
          }),
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error ?? "Image generation failed.");
        }
        const urls: string[] = payload.images.map(
          (image: { url: string }) => image.url
        );
        const images: GeneratedImage[] = [];
        for (const url of urls) {
          const dataUrl = await fetchAsDataUrl(url);
          images.push({ id: createId(), dataUrl, mimeType: "image/png" });
        }
        setGeneratedImages(images);
        addImagesToGallery(images);
      }
      setStatusMessage("Ready.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Image generation failed."
      );
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
        headers: {
          "Content-Type": "application/json",
        },
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
      if (!response.ok) {
        throw new Error(payload.error ?? "Video generation failed.");
      }
      const operationName = payload.name as string;
      let pollCount = 0;
      while (pollCount < 120) {
        pollCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        setStatusMessage("Rendering on Veo... (about a minute)");
        const poll = await fetch(
          `/api/gemini/video?name=${encodeURIComponent(operationName)}`,
          {
            headers: {
              "x-user-api-key": apiKey,
            },
          }
        );
        const pollPayload = await poll.json();
        if (!poll.ok) {
          throw new Error(pollPayload.error ?? "Video generation failed.");
        }
        if (!pollPayload.done) {
          continue;
        }
        if (pollPayload.error) {
          throw new Error(pollPayload.error);
        }
        const download = await fetch("/api/gemini/video/download", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            apiKey,
            uri: pollPayload.videoUri,
          }),
        });
        if (!download.ok) {
          throw new Error("Unable to download the rendered video.");
        }
        const blob = await download.blob();
        const url = URL.createObjectURL(blob);
        updateVideoUrl(url);
        setStatusMessage("Video ready.");
        return;
      }
      throw new Error("Video generation timed out.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Video generation failed."
      );
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          apiKey,
          model,
          prompt,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "Video generation failed.");
      }
      const jobId = payload.id as string;
      let pollCount = 0;
      while (pollCount < 120) {
        pollCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 5000));
        setStatusMessage("Rendering on NavyAI...");
        const poll = await fetch(
          `/api/navy/video?id=${encodeURIComponent(jobId)}`,
          {
            headers: {
              "x-user-api-key": apiKey,
            },
          }
        );
        const pollPayload = await poll.json();
        if (!poll.ok) {
          throw new Error(pollPayload.error ?? "Video generation failed.");
        }
        if (!pollPayload.done) {
          continue;
        }
        if (pollPayload.error) {
          throw new Error(pollPayload.error);
        }
        updateVideoUrl(pollPayload.videoUrl as string);
        setStatusMessage("Video ready.");
        return;
      }
      throw new Error("Video generation timed out.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Video generation failed."
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGenerate = async () => {
    resetStatus();
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
      return;
    }
    if (provider === "gemini") {
      await generateGeminiVideo();
      return;
    }
    await generateNavyVideo();
  };

  return (
    <div className="page">
      <header className="hero">
        <div className="heroText">
          <p className="eyebrow">Local-first studio</p>
          <h1>Image & Video Studio</h1>
          <p className="lead">
            Generate polished images and cinematic clips with Gemini or NavyAI.
            Bring your own API key, keep assets in local storage, and ship on
            Cloudflare Workers.
          </p>
        </div>
        <div className="heroCard">
          <div>
            <span>Runtime</span>
            <strong>Edge-first</strong>
          </div>
          <div>
            <span>Storage</span>
            <strong>Local only</strong>
          </div>
          <div>
            <span>Providers</span>
            <strong>Gemini + Navy</strong>
          </div>
        </div>
      </header>

      <div className="layout">
        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Create</h2>
              <p>Use your key, tweak parameters, and generate.</p>
            </div>
            <div className="segmented">
              <button
                className={mode === "image" ? "seg active" : "seg"}
                onClick={() => setMode("image")}
                type="button"
              >
                Image
              </button>
              <button
                className={mode === "video" ? "seg active" : "seg"}
                onClick={() => setMode("video")}
                type="button"
              >
                Video
              </button>
            </div>
          </div>

          <div className="fields">
            <label className="field">
              <span>Provider</span>
              <select
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value as Provider)
                }
              >
                <option value="gemini">Google Gemini</option>
                <option value="navy">NavyAI</option>
              </select>
            </label>

            <label className="field">
              <span>API key</span>
              <div className="inputRow">
                <input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={
                    provider === "gemini"
                      ? "Paste Gemini API key"
                      : "Paste NavyAI API key"
                  }
                />
                <button
                  type="button"
                  className="buttonGhost"
                  onClick={() => setShowKey((prev) => !prev)}
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
              <span className="helper">
                Stored locally in your browser for quick reuse.
              </span>
            </label>

            <div className="inlineActions">
              <button type="button" className="buttonGhost" onClick={clearKey}>
                Forget key
              </button>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={saveToGallery}
                  onChange={(event) => setSaveToGallery(event.target.checked)}
                />
                Save images to local gallery
              </label>
            </div>

            <label className="field">
              <span>Model</span>
              <input
                list="model-options"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder="Model id"
              />
              <datalist id="model-options">
                {modelSuggestions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </datalist>
              <span className="helper">
                You can paste any model id supported by your provider.
              </span>
            </label>

            <label className="field">
              <span>Prompt</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  mode === "image"
                    ? "Describe the scene, style, and mood..."
                    : "Describe the action, camera movement, and mood..."
                }
                rows={6}
              />
            </label>

            {mode === "image" ? (
              <>
                {showImageAspect && (
                  <label className="field">
                    <span>Aspect ratio</span>
                    <select
                      value={imageAspect}
                      onChange={(event) => setImageAspect(event.target.value)}
                    >
                      {IMAGE_ASPECTS.map((ratio) => (
                        <option value={ratio} key={ratio}>
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {showImageSize && provider === "gemini" && (
                  <label className="field">
                    <span>Image size</span>
                    <select
                      value={imageSize}
                      onChange={(event) => setImageSize(event.target.value)}
                    >
                      {sizeOptions.map((size) => (
                        <option value={size} key={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {provider === "navy" && (
                  <label className="field">
                    <span>Image size</span>
                    <input
                      value={navyImageSize}
                      onChange={(event) => setNavyImageSize(event.target.value)}
                      placeholder="1024x1024"
                    />
                    <span className="helper">
                      Uses the NavyAI size format (ex: 1024x1024).
                    </span>
                  </label>
                )}

                {showImageCount && (
                  <label className="field">
                    <span>Image count</span>
                    <input
                      type="number"
                      min={1}
                      max={4}
                      value={imageCount}
                      onChange={(event) =>
                        handleImageCountChange(event.target.value)
                      }
                    />
                  </label>
                )}
              </>
            ) : (
              <>
                {provider === "gemini" && (
                  <>
                    <label className="field">
                      <span>Aspect ratio</span>
                      <select
                        value={videoAspect}
                        onChange={(event) => setVideoAspect(event.target.value)}
                      >
                        {VIDEO_ASPECTS.map((ratio) => (
                          <option value={ratio} key={ratio}>
                            {ratio}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Resolution</span>
                      <select
                        value={videoResolution}
                        onChange={(event) =>
                          setVideoResolution(event.target.value)
                        }
                      >
                        {VIDEO_RESOLUTIONS.map((size) => (
                          <option value={size} key={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Duration (seconds)</span>
                      <select
                        value={videoDuration}
                        onChange={(event) => setVideoDuration(event.target.value)}
                      >
                        {VIDEO_DURATIONS.map((duration) => (
                          <option value={duration} key={duration}>
                            {duration}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Negative prompt</span>
                      <input
                        value={negativePrompt}
                        onChange={(event) =>
                          setNegativePrompt(event.target.value)
                        }
                        placeholder="Optional exclusions"
                      />
                    </label>
                  </>
                )}
                {provider === "navy" && (
                  <div className="helperCard">
                    Navy video jobs run async. We poll until the video is ready.
                  </div>
                )}
              </>
            )}
          </div>

          <button
            type="button"
            className="buttonPrimary"
            onClick={handleGenerate}
            disabled={busy}
          >
            {busy ? "Generating..." : "Generate"}
          </button>
          <div className="status">
            {errorMessage ? (
              <span className="error">{errorMessage}</span>
            ) : (
              <span>{statusMessage}</span>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader">
            <div>
              <h2>Output</h2>
              <p>Preview the latest generation.</p>
            </div>
          </div>

          {mode === "image" ? (
            generatedImages.length ? (
              <div className="imageGrid">
                {generatedImages.map((image) => (
                  <figure className="imageCard" key={image.id}>
                    <img src={image.dataUrl} alt="Generated result" />
                    <figcaption>
                      <span>{model}</span>
                      <a href={image.dataUrl} download>
                        Download
                      </a>
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : (
              <div className="emptyState">
                <p>No images yet.</p>
                <span>Generated images show up here immediately.</span>
              </div>
            )
          ) : videoUrl ? (
            <div className="videoCard">
              <video src={videoUrl} controls preload="metadata" />
              <div className="videoMeta">
                <span>{model}</span>
                <a href={videoUrl} download>
                  Download
                </a>
              </div>
            </div>
          ) : (
            <div className="emptyState">
              <p>No video yet.</p>
              <span>Start a render to preview the clip here.</span>
            </div>
          )}
        </section>
      </div>

      <section className="panel galleryPanel">
        <div className="panelHeader">
          <div>
            <h2>Local gallery</h2>
            <p>Stored in your browser only. Clear anytime.</p>
          </div>
          <button type="button" className="buttonGhost" onClick={clearGallery}>
            Wipe gallery
          </button>
        </div>

        {savedImages.length ? (
          <div className="galleryGrid">
            {savedImages.map((image) => (
              <figure className="galleryCard" key={image.id}>
                <img src={image.dataUrl} alt="Saved generation" />
                <figcaption>
                  <div>
                    <strong>{image.provider}</strong>
                    <span>{new Date(image.createdAt).toLocaleString()}</span>
                  </div>
                  <span className="mono">{image.model}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="emptyState">
            <p>Gallery is empty.</p>
            <span>Generated images will be saved here automatically.</span>
          </div>
        )}
      </section>
    </div>
  );
}
