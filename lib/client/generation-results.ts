import type { GeneratedImage, GenerationBilling } from "../types.ts";
import { dataUrlFromBase64, fetchAsDataUrl } from "../utils.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;
const getString = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const createId = () => typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const buildGeneratedImages = (payload: unknown): GeneratedImage[] => {
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

export const generationMetadataFromPayload = (payload: unknown) => {
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

export const buildPolledImages = async (payload: Record<string, unknown>): Promise<GeneratedImage[]> => {
    const rawImages = Array.isArray(payload.images) ? payload.images : [];
    const images: GeneratedImage[] = [];
    for (const image of rawImages) {
        if (!isRecord(image)) continue;
        const data = getString(image.data) || getString(image.b64_json);
        const mimeType = getString(image.mimeType) || getString(image.mime_type) || "image/png";
        if (data) {
            images.push({ id: createId(), dataUrl: dataUrlFromBase64(data, mimeType), mimeType });
        } else if (typeof image.url === "string" && image.url) {
            images.push({ id: createId(), dataUrl: await fetchAsDataUrl(image.url), mimeType: "image/png" });
        }
    }
    return images;
};
