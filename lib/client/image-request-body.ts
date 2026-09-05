import { AUTO_IMAGE_OPTION, type ModelOption } from "../constants.ts";
import type { GenerationJob } from "../jobs/types.ts";
import { resolveImageSizingOptions } from "../studio-generation.ts";
import { buildNavyImageUrlPayload, parseOptionalSeed, type GenerationReference } from "./generation-inputs.ts";

export const buildImageRequest = (
    job: GenerationJob,
    referenceImages: GenerationReference[],
    nanoGptImageModels: ModelOption[],
) => {
    const imageSizing = resolveImageSizingOptions(job.provider, {
        imageAspect: job.imageAspect,
        imageSize: job.imageSize,
        navyImageSize: job.navyImageSize,
    });
    let endpoint = `/api/${job.provider}/image`;
    let body: Record<string, unknown> = {
        model: job.model,
        prompt: job.prompt,
    };

    if (job.provider === "gemini") {
        body = {
            ...body,
            ...imageSizing,
            numberOfImages: job.imageCount,
            referenceImages,
        };
    } else if (job.provider === "openrouter") {
        body = {
            ...body,
            ...imageSizing,
            outputModalities: job.outputModalities,
            referenceImages,
        };
    } else if (job.provider === "navy") {
        const imageUrl = buildNavyImageUrlPayload(referenceImages);
        body = {
            ...body,
            ...imageSizing,
            quality: job.navyImageQuality,
            negativePrompt: job.negativePrompt,
            promptAgentModel: job.promptAgentModel,
            modelEndpoint: job.modelEndpoint,
            outputModalities: job.outputModalities,
            imageUrl,
            sync: false,
        };
    } else if (job.provider === "multillm") {
        body = {
            ...body,
            ...imageSizing,
            numberOfImages: job.imageCount,
            quality: job.navyImageQuality,
            negativePrompt: job.negativePrompt,
            modelEndpoint: job.modelEndpoint,
            outputModalities: job.outputModalities,
            imageDataUrls: referenceImages.map(
                (reference) => reference.dataUrl
            ),
            parameters: job.modelParameters,
            sync: false,
        };
    } else if (job.provider === "nanogpt") {
        const selectedNanoGptModel = nanoGptImageModels.find(
            (entry) => entry.id === job.model
        );
        const catalogParameters = job.modelParameters ?? {};
        const supportsReferenceImages =
            selectedNanoGptModel?.supports?.referenceImages === true;
        const maxReferenceImages = supportsReferenceImages
            ? selectedNanoGptModel?.maxReferenceImages ?? 1
            : 0;
        const catalogResolution =
            typeof catalogParameters.resolution === "string"
                ? catalogParameters.resolution
                : "";
        const requestedResolution =
            catalogResolution ||
            (job.imageSize && job.imageSize !== AUTO_IMAGE_OPTION
                ? job.imageSize
                : job.chutesResolution ?? "");
        const supportedResolutions =
            selectedNanoGptModel?.supportedResolutions ?? [];
        const resolution =
            !supportedResolutions.length ||
                supportedResolutions.includes(requestedResolution)
                ? requestedResolution
                : supportedResolutions.includes(AUTO_IMAGE_OPTION)
                    ? AUTO_IMAGE_OPTION
                    : supportedResolutions[0];
        body = {
            ...body,
            parameters: catalogParameters,
            resolution,
            numberOfImages: job.imageCount,
            input_references: referenceImages
                .slice(0, maxReferenceImages)
                .map((reference) => reference.dataUrl),
            seed: selectedNanoGptModel?.supports?.seed
                ? typeof catalogParameters.seed === "number"
                    ? catalogParameters.seed
                    : parseOptionalSeed(job.chutesSeed)
                : null,
            modelCapabilities: {
                supportedResolutions,
                maxOutputImages: selectedNanoGptModel?.maxOutputImages,
                fixedOutputImages: selectedNanoGptModel?.fixedOutputImages,
                maxReferenceImages,
                supportsReferenceImages,
            },
        };
    } else {
        endpoint = "/api/chutes/image";
        body = {
            ...body,
            negativePrompt: job.negativePrompt,
            guidanceScale: Number(job.chutesGuidanceScale),
            width: Number(job.chutesWidth),
            height: Number(job.chutesHeight),
            numInferenceSteps: Number(job.chutesSteps),
            resolution: job.chutesResolution,
            seed: parseOptionalSeed(job.chutesSeed),
        };
    }
    return { endpoint, body };
};
