import type { ModelOption } from "@/lib/constants";

export function ModelMetadataDetails({ model: selectedModel }: { model?: ModelOption }) {
    const formatCount = (value?: number | null) => typeof value === "number" ? value.toLocaleString() : value === null ? "unknown" : "-";
    const formatFlag = (value?: boolean | null) =>
        typeof value === "boolean" ? (value ? "yes" : "no") : value === null ? "unknown" : "-";
    const selectedInputModalities = selectedModel?.inputModalities;
    const selectedOutputModalities = selectedModel?.outputModalities;
    const hasSelectedModelMetadata = Boolean(
        selectedModel?.endpoint ||
        selectedModel?.upstreamEndpoint ||
        selectedModel?.upstreamOwner ||
        selectedModel?.requiredPlan ||
        typeof selectedModel?.tokenMultiplier === "number" ||
        selectedModel?.contextWindow !== undefined ||
        selectedModel?.maxOutputTokens !== undefined ||
        selectedModel?.metadataStatus ||
        selectedModel?.metadataSource !== undefined ||
        selectedModel?.metadataResolvedFrom !== undefined ||
        selectedModel?.modality !== undefined ||
        selectedModel?.tokenizer !== undefined ||
        selectedModel?.supportsVision !== undefined ||
        selectedModel?.supportsTools !== undefined ||
        selectedModel?.supportsFunctionCalling !== undefined ||
        selectedModel?.supportsReasoning !== undefined ||
        selectedModel?.supportsJsonMode !== undefined ||
        selectedModel?.supportsAudioInput !== undefined ||
        selectedModel?.supportsImageOutput !== undefined ||
        selectedModel?.supportsStreaming !== undefined ||
        selectedModel?.maxReferenceImages !== undefined ||
        selectedModel?.supportedResolutions !== undefined ||
        selectedModel?.maxOutputImages !== undefined ||
        selectedModel?.fixedOutputImages !== undefined ||
        selectedModel?.dynamicParameters !== undefined ||
        selectedModel?.pricing !== undefined ||
        selectedInputModalities !== undefined ||
        selectedOutputModalities !== undefined
    );
    return <>
                    {hasSelectedModelMetadata ? (
                        <div className="space-y-1 rounded-lg border border-border/50 bg-secondary/20 p-2 text-[11px] text-muted-foreground">
                            {selectedModel?.upstreamEndpoint || selectedModel?.endpoint ? (
                                <div>Provider endpoint: {selectedModel.upstreamEndpoint ?? selectedModel.endpoint}</div>
                            ) : null}
                            {selectedModel?.upstreamEndpoint && selectedModel?.endpoint !== selectedModel.upstreamEndpoint ? (
                                <div>Studio transport: {selectedModel.endpoint}</div>
                            ) : null}
                            {selectedModel?.upstreamOwner ? <div>Model owner: {selectedModel.upstreamOwner}</div> : null}
                            {selectedModel?.requiredPlan ? <div>Plan: {selectedModel.requiredPlan}</div> : null}
                            {typeof selectedModel?.tokenMultiplier === "number" ? <div>Token multiplier: {selectedModel.tokenMultiplier}</div> : null}
                            {selectedModel?.contextWindow !== undefined ? <div>Context: {formatCount(selectedModel.contextWindow)}</div> : null}
                            {selectedModel?.maxOutputTokens !== undefined ? <div>Max output: {formatCount(selectedModel.maxOutputTokens)}</div> : null}
                            {selectedInputModalities !== undefined ? (
                                <div>Input: {selectedInputModalities?.length ? selectedInputModalities.join(", ") : "unknown"}</div>
                            ) : null}
                            {selectedOutputModalities !== undefined ? (
                                <div>Output: {selectedOutputModalities?.length ? selectedOutputModalities.join(", ") : "unknown"}</div>
                            ) : null}
                            {selectedModel?.modality !== undefined ? <div>Modality: {selectedModel.modality ?? "unknown"}</div> : null}
                            {selectedModel?.tokenizer !== undefined ? <div>Tokenizer: {selectedModel.tokenizer ?? "unknown"}</div> : null}
                            {selectedModel?.metadataStatus ? <div>Metadata: {selectedModel.metadataStatus}{selectedModel.metadataSource ? ` via ${selectedModel.metadataSource}` : ""}</div> : null}
                            {selectedModel?.metadataResolvedFrom ? <div>Metadata resolved from: {selectedModel.metadataResolvedFrom}</div> : null}
                            {selectedModel?.maxReferenceImages !== undefined ? <div>Reference images: up to {selectedModel.maxReferenceImages}</div> : null}
                            {selectedModel?.supportedResolutions?.length ? <div>Resolutions: {selectedModel.supportedResolutions.join(", ")}</div> : null}
                            {selectedModel?.fixedOutputImages !== undefined ? <div>Output images: fixed at {selectedModel.fixedOutputImages}</div> : null}
                            {selectedModel?.fixedOutputImages === undefined && selectedModel?.maxOutputImages !== undefined ? <div>Output images: up to {selectedModel.maxOutputImages}</div> : null}
                            {selectedModel?.dynamicParameters ? <div>Model controls: {Object.keys(selectedModel.dynamicParameters).length}</div> : null}
                            {selectedModel?.supportsVision !== undefined ? <div>Vision: {formatFlag(selectedModel.supportsVision)}</div> : null}
                            {selectedModel?.supportsTools !== undefined ? <div>Tools: {formatFlag(selectedModel.supportsTools)}</div> : null}
                            {selectedModel?.supportsFunctionCalling !== undefined ? <div>Function calling: {formatFlag(selectedModel.supportsFunctionCalling)}</div> : null}
                            {selectedModel?.supportsReasoning !== undefined ? <div>Reasoning: {formatFlag(selectedModel.supportsReasoning)}</div> : null}
                            {selectedModel?.supportsJsonMode !== undefined ? <div>JSON mode: {formatFlag(selectedModel.supportsJsonMode)}</div> : null}
                            {selectedModel?.supportsAudioInput !== undefined ? <div>Audio input: {formatFlag(selectedModel.supportsAudioInput)}</div> : null}
                            {selectedModel?.supportsImageOutput !== undefined ? <div>Image output: {formatFlag(selectedModel.supportsImageOutput)}</div> : null}
                            {selectedModel?.supportsStreaming !== undefined ? <div>Streaming: {formatFlag(selectedModel.supportsStreaming)}</div> : null}
                            {selectedModel?.pricing !== undefined ? (
                                <details>
                                    <summary className="cursor-pointer text-foreground">Provider pricing</summary>
                                    <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[10px]">
                                        {JSON.stringify(selectedModel.pricing, null, 2)}
                                    </pre>
                                </details>
                            ) : null}
                        </div>
                    ) : null}
    </>;
}
