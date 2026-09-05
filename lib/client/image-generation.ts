import type { ModelOption } from "../constants.ts";
import type { GenerationJob } from "../jobs/types.ts";
import { DEFAULT_IMAGE_RETRY_ATTEMPTS, retryAsyncOperation } from "../image-retry.ts";
import { resolveImageSubmissionAttempts } from "../image-submission-policy.ts";
import { NAVY_JOB_POLL_INTERVAL_MS, NAVY_JOB_POLL_MAX_ATTEMPTS, resolveNavyJobPollDelayMs } from "../studio-generation.ts";
import type { GenerationReference } from "./generation-inputs.ts";
import { buildGeneratedImages, buildPolledImages, generationMetadataFromPayload } from "./generation-results.ts";
import { buildImageRequest } from "./image-request-body.ts";
import { isRetryableImageSubmissionError, submitImageRequest, waitForImageSubmissionRetry } from "./image-submission.ts";
import { formatProviderErrorForDisplay } from "./provider-error.ts";

type ImageGenerationOptions = {
    referenceImages: GenerationReference[];
    nanoGptImageModels: ModelOption[];
    updateJob: (id: string, patch: Partial<GenerationJob>) => void;
    sleep?: (ms: number) => Promise<void>;
};

const pollImageResult = async (
    job: GenerationJob,
    initialPayload: Record<string, unknown>,
    attemptLabel: string,
    options: ImageGenerationOptions,
) => {
    let payload = initialPayload;
    const jobId = typeof payload.id === "string" ? payload.id : job.remoteJobId;
    if (!jobId) return payload;
    const providerName = job.provider === "navy" ? "Navy" : "MultiLLM";
    options.updateJob(job.id, {
        remoteJobId: jobId,
        remoteStatus: typeof payload.status === "string" ? payload.status : undefined,
    });
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    let delayMs = NAVY_JOB_POLL_INTERVAL_MS;
    let done = Boolean(payload.done);
    for (let attempt = 0; attempt < NAVY_JOB_POLL_MAX_ATTEMPTS && !done; attempt += 1) {
        options.updateJob(job.id, {
            progress: `Waiting for ${providerName} image render${attemptLabel} (${attempt + 1}/${NAVY_JOB_POLL_MAX_ATTEMPTS})...`,
        });
        await sleep(delayMs);
        const source = job.model.startsWith("nanogpt:") ? "nanogpt" : "navyai";
        const endpoint = job.provider === "multillm"
            ? `/api/multillm/image?id=${encodeURIComponent(jobId)}&source=${source}`
            : `/api/navy/image?id=${encodeURIComponent(jobId)}`;
        const response = await fetch(endpoint, { headers: { "x-user-api-key": job.apiKey } });
        payload = await response.json();
        if (!response.ok && response.status !== 429) {
            throw new Error(formatProviderErrorForDisplay(payload, {
                fallback: `Unable to poll ${providerName} image job.`, status: response.status,
            }));
        }
        done = Boolean(payload.done);
        delayMs = resolveNavyJobPollDelayMs({ payload, responseStatus: response.status, currentDelayMs: delayMs });
        if (!done && (response.status === 429 || payload.status === "rate_limited")) {
            options.updateJob(job.id, {
                remoteStatus: "rate_limited",
                progress: `${providerName} is rate limiting polls; retrying in ${Math.ceil(delayMs / 1000)}s...`,
            });
        }
    }
    if (!done) throw new Error(`Timed out waiting for the ${providerName} image job.`);
    return payload;
};

export const requestGeneratedImages = async (job: GenerationJob, options: ImageGenerationOptions) => {
    const { endpoint, body } = buildImageRequest(job, options.referenceImages, options.nanoGptImageModels);
    return await retryAsyncOperation({
        maxAttempts: resolveImageSubmissionAttempts({
            provider: job.provider,
            model: job.model,
            remoteJobId: job.remoteJobId,
            configuredAttempts: job.imageRetryAttempts ?? DEFAULT_IMAGE_RETRY_ATTEMPTS,
        }),
        shouldRetry: (error) => job.provider !== "multillm" || isRetryableImageSubmissionError(error),
        beforeRetry: ({ error, attempt }) => waitForImageSubmissionRetry(error, attempt),
        onAttempt: ({ attempt, maxAttempts }) => {
            if (maxAttempts > 1) options.updateJob(job.id, {
                progress: `Generating image with ${job.model} (try ${attempt}/${maxAttempts})...`,
            });
        },
        onError: ({ attempt, maxAttempts, error, final }) => {
            if (!final) options.updateJob(job.id, {
                progress: `Retrying ${job.model} after try ${attempt}/${maxAttempts}: ${error instanceof Error ? error.message : "Image generation failed."}`,
            });
        },
        run: async ({ attempt, maxAttempts }) => {
            const attemptLabel = maxAttempts > 1 ? ` (try ${attempt}/${maxAttempts})` : "";
            const usesPolling = job.provider === "navy" || job.provider === "multillm";
            let payload: Record<string, unknown>;
            if (usesPolling && job.remoteJobId) {
                options.updateJob(job.id, {
                    progress: `Resuming ${job.provider === "navy" ? "Navy" : "MultiLLM"} image job ${job.remoteJobId}...`,
                });
                payload = { id: job.remoteJobId };
            } else {
                options.updateJob(job.id, { progress: `Submitting image request to ${job.model}${attemptLabel}...` });
                payload = await submitImageRequest(endpoint, {
                    headers: { "Content-Type": "application/json", "x-user-api-key": job.apiKey },
                    body: JSON.stringify(body),
                });
            }
            if (usesPolling) payload = await pollImageResult(job, payload, attemptLabel, options);
            const images = usesPolling ? await buildPolledImages(payload) : buildGeneratedImages(payload);
            if (!images.length) throw new Error("No images were returned by the model.");
            const metadata = generationMetadataFromPayload(job.provider === "nanogpt" ? payload : {});
            return { images, ...metadata };
        },
    });
};
