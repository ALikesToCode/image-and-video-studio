import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { sanitizeMediaUrl } from "./media-url.ts";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const dataUrlFromBase64 = (data: string, mimeType: string) =>
  `data:${mimeType};base64,${data}`;

export const fetchAsDataUrl = async (url: string) => {
  const safeUrl = sanitizeMediaUrl(url, {
    kind: "image",
    allowBlob: true,
  });
  if (!safeUrl) {
    throw new Error("Generated asset URL is not a supported image URL.");
  }
  if (/^data:/i.test(safeUrl)) {
    return safeUrl;
  }
  const response = await fetch(safeUrl);
  if (!response.ok) {
    throw new Error("Unable to fetch the generated asset.");
  }
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = sanitizeMediaUrl(reader.result, { kind: "image" });
      if (!dataUrl) {
        reject(new Error("Generated asset is not a supported image."));
        return;
      }
      resolve(dataUrl);
    };
    reader.onerror = () => reject(new Error("Unable to read the asset."));
    reader.readAsDataURL(blob);
  });
};
