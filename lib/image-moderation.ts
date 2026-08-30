const GPT_IMAGE_MODEL_PATTERN =
  /(?:^|[:/])gpt-image-(?:2|1(?:\.5|-mini)?)(?:$|[-:/])/i;

export const supportsLowImageModeration = (model: string) =>
  GPT_IMAGE_MODEL_PATTERN.test(model.trim());

export const applyImageModerationDefault = <
  T extends Record<string, unknown>,
>(model: string, payload: T): T =>
  supportsLowImageModeration(model)
    ? ({ ...payload, moderation: "low" } as T)
    : payload;
