import test from "node:test";
import assert from "node:assert/strict";
import type { GenerationJob } from "../jobs/types.ts";
import { requestGeneratedImages } from "./image-generation.ts";
import { buildImageRequest } from "./image-request-body.ts";

const job: GenerationJob = {
    id: "image-test", mode: "image", status: "queued", provider: "multillm",
    model: "nanogpt:example", prompt: "A blue cup", apiKey: "synthetic-test-key",
    createdAt: "2026-09-05T00:00:00Z", saveToGallery: false, imageRetryAttempts: 3,
};

test("standalone image polling resumes an accepted job without submitting again", async (t) => {
    const updates: Partial<GenerationJob>[] = [];
    const requests: string[] = [];
    t.mock.method(globalThis, "fetch", async (input: unknown) => {
        requests.push(String(input));
        assert.equal(input, "/api/multillm/image?id=accepted-job&source=nanogpt");
        return requests.length === 1
            ? Response.json({ status: "rate_limited", retryAfterMs: 1000 }, { status: 429 })
            : Response.json({ done: true, images: [{ url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgSDvzHwADzgIyupqDXwAAAABJRU5ErkJggg==" }] });
    });
    const result = await requestGeneratedImages({ ...job, remoteJobId: "accepted-job" }, {
        referenceImages: [], nanoGptImageModels: [], sleep: async () => undefined,
        updateJob: (_id, patch) => updates.push(patch),
    });
    assert.equal(requests.length, 2);
    assert.equal(result.images.length, 1);
    assert.ok(updates.some((patch) => patch.remoteStatus === "rate_limited"));
});

test("standalone image polling failures retain the accepted job and do not resubmit", async (t) => {
    const updates: Partial<GenerationJob>[] = [];
    let submissions = 0;
    let polls = 0;
    t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
        if (init.method === "POST") {
            submissions += 1;
            return Response.json({ id: "accepted-job", status: "pending" });
        }
        polls += 1;
        return Response.json({ error: "Temporary polling failure" }, { status: 503 });
    });
    await assert.rejects(requestGeneratedImages(job, {
        referenceImages: [], nanoGptImageModels: [], sleep: async () => undefined,
        updateJob: (_id, patch) => updates.push(patch),
    }), /Temporary polling failure/);
    assert.equal(submissions, 1);
    assert.equal(polls, 1);
    assert.ok(updates.some((patch) => patch.remoteJobId === "accepted-job"));
});

test("standalone MultiLLM input serialization retains the queued references and model settings", () => {
    const { endpoint, body } = buildImageRequest({
        ...job, model: "linkapi:gpt-image-2-c", imageCount: 2,
        navyImageQuality: "high", modelParameters: { seed: 0 },
    }, [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgSDvzHwADzgIyupqDXwAAAABJRU5ErkJggg==", role: "source_image" }], []);
    assert.equal(endpoint, "/api/multillm/image");
    assert.deepEqual(body.imageDataUrls, ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgSDvzHwADzgIyupqDXwAAAABJRU5ErkJggg=="]);
    assert.equal(body.numberOfImages, 2);
    assert.equal(body.quality, "high");
    assert.deepEqual(body.parameters, { seed: 0 });
});

test("standalone NanoGPT serialization respects capabilities and seed zero", () => {
    const { body } = buildImageRequest({ ...job, provider: "nanogpt", chutesSeed: "0", imageSize: "unsupported" }, [
        { dataUrl: "data:first" }, { dataUrl: "data:second" },
    ], [{
        id: job.model, label: "Example", supports: { seed: true, referenceImages: true },
        supportedResolutions: ["1024x1024"], maxReferenceImages: 1,
    }]);
    assert.equal(body.seed, 0);
    assert.equal(body.resolution, "1024x1024");
    assert.deepEqual(body.input_references, ["data:first"]);
});
