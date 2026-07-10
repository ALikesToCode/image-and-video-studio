import type { ModelOption } from "./constants.ts";

const hasOwn = (value: object | undefined, key: string) =>
  Boolean(value && Object.prototype.hasOwnProperty.call(value, key));

const includesImage = (modalities: string[] | null | undefined) =>
  modalities?.some((entry) => entry.toLowerCase() === "image") === true;

const hasKnownMediaMetadata = (model: ModelOption) =>
  model.metadataStatus === "known" ||
  model.inputModalities !== undefined ||
  model.maxReferenceImages !== undefined ||
  Boolean(model.supports && Object.keys(model.supports).length);

export const modelAcceptsImageReferences = (model?: ModelOption) => {
  if (!model) return true;
  if (model.maxReferenceImages === 0) return false;
  if (hasOwn(model.supports, "referenceImages")) {
    return model.supports?.referenceImages === true;
  }
  if (typeof model.maxReferenceImages === "number") {
    return model.maxReferenceImages > 0;
  }
  if (model.supports?.imageEdit === true) return true;
  if (includesImage(model.inputModalities)) return true;
  return !hasKnownMediaMetadata(model);
};

export const modelAcceptsSourceImage = (model?: ModelOption) => {
  if (!model) return true;
  if (hasOwn(model.supports, "sourceImage")) {
    return model.supports?.sourceImage === true;
  }
  if (model.supports?.firstFrame === true || model.supports?.imageEdit === true) {
    return true;
  }
  if (includesImage(model.inputModalities)) return true;
  return !hasKnownMediaMetadata(model);
};

export const getModelReferenceLimit = (model?: ModelOption) => {
  if (!model) return undefined;
  if (typeof model.maxReferenceImages === "number") {
    return Math.max(0, Math.floor(model.maxReferenceImages));
  }
  return modelAcceptsImageReferences(model) ? undefined : 0;
};
