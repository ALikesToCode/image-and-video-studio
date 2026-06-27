import { useEffect, useMemo } from "react";
import { useStudio } from "@/app/contexts/StudioContext";
import { ChutesChat } from "../chutes-chat";
import {
    CHUTES_IMAGE_MODELS,
    CHUTES_TTS_MODELS,
    CHUTES_VIDEO_MODELS,
    NANOGPT_IMAGE_MODELS,
    type ModelOption,
} from "@/lib/constants";

type ChatViewProps = {
    initialInput?: string | null;
};

const appendUniqueModels = (primary: ModelOption[], extra: ModelOption[]) => {
    const seen = new Set(primary.map((model) => model.id));
    return [
        ...primary,
        ...extra.filter((model) => {
            if (seen.has(model.id)) return false;
            seen.add(model.id);
            return true;
        }),
    ];
};

export function ChatView({ initialInput }: ChatViewProps) {
    const {
        apiKeys,
        chatProvider,
        setChatProvider,
        chutesChatModels,
        chutesChatModel,
        setChutesChatModel,
        chutesToolImageModel,
        setChutesToolImageModel,
        chutesChatModelsLoading,
        chutesChatModelsError,
        refreshChutesChatModels,
        navyChatModels,
        navyChatModel,
        setNavyChatModel,
        navyToolImageModel,
        setNavyToolImageModel,
        navyChatModelsLoading,
        navyChatModelsError,
        refreshNavyChatModels,
        navyImageModels,
        navyVideoModels,
        navyTtsModels,
        navyUsage,
        navyUsageError,
        navyUsageLoading,
        navyUsageUpdatedAt,
        refreshNavyUsage,
        saveChatImages,
        saveToGallery,
        imagePipelineEnabled,
        setImagePipelineEnabled,
        imageModelOrder,
        setImageModelOrder,
        imageRetryAttempts,
        setImageRetryAttempts,
        videoImage,
        videoAspect,
        videoDuration,
        ttsVoice,
        ttsFormat,
        ttsSpeed,
    } = useStudio();

    const isNavyChat = chatProvider === "navy";
    const chatApiKey = isNavyChat ? apiKeys.navy : apiKeys.chutes;
    const navyChatModelsFiltered = useMemo(() => {
        if (!navyChatModels.length) return [];
        const exclude = new Set([
            ...navyImageModels.map((model) => model.id),
            ...navyVideoModels.map((model) => model.id),
            ...navyTtsModels.map((model) => model.id),
        ]);
        return navyChatModels.filter((model) => !exclude.has(model.id));
    }, [navyChatModels, navyImageModels, navyVideoModels, navyTtsModels]);
    const resolvedNavyChatModels = navyChatModelsFiltered.length ? navyChatModelsFiltered : navyChatModels;
    const chatModels = isNavyChat ? resolvedNavyChatModels : chutesChatModels;
    const chatModel = isNavyChat ? navyChatModel : chutesChatModel;
    const setChatModel = isNavyChat ? setNavyChatModel : setChutesChatModel;
    const chutesImageToolModels = useMemo(
        () => appendUniqueModels(CHUTES_IMAGE_MODELS, NANOGPT_IMAGE_MODELS),
        []
    );
    const navyImageToolModels = useMemo(
        () => appendUniqueModels(navyImageModels, NANOGPT_IMAGE_MODELS),
        [navyImageModels]
    );
    const imageModels = isNavyChat ? navyImageToolModels : chutesImageToolModels;
    const videoModels = isNavyChat ? navyVideoModels : CHUTES_VIDEO_MODELS;
    const audioModels = isNavyChat ? navyTtsModels : CHUTES_TTS_MODELS;
    const toolImageModel = isNavyChat ? navyToolImageModel : chutesToolImageModel;
    const setToolImageModel = isNavyChat ? setNavyToolImageModel : setChutesToolImageModel;
    const modelsLoading = isNavyChat ? navyChatModelsLoading : chutesChatModelsLoading;
    const modelsError = isNavyChat ? navyChatModelsError : chutesChatModelsError;
    const onRefreshModels = isNavyChat ? refreshNavyChatModels : refreshChutesChatModels;
    const handleSaveImages = (payload: { images: { id: string; dataUrl: string; mimeType: string }[]; prompt: string; model: string }) =>
        saveChatImages({ ...payload, provider: chatProvider });

    useEffect(() => {
        if (!isNavyChat) return;
        if (!resolvedNavyChatModels.length) return;
        if (!navyChatModel) {
            setNavyChatModel(resolvedNavyChatModels[0].id);
        }
    }, [isNavyChat, navyChatModel, resolvedNavyChatModels, setNavyChatModel]);

    useEffect(() => {
        if (!isNavyChat) return;
        if (!navyImageModels.length) return;
        if (!navyToolImageModel) {
            setNavyToolImageModel(navyImageModels[0].id);
        }
    }, [isNavyChat, navyImageModels, navyToolImageModel, setNavyToolImageModel]);

    useEffect(() => {
        if (!isNavyChat) return;
        if (!apiKeys.navy.trim()) return;
        void refreshNavyUsage();
    }, [apiKeys.navy, isNavyChat, refreshNavyUsage]);

    return (
        <div className="h-full w-full flex flex-col">
            <ChutesChat
                apiKey={chatApiKey}
                provider={chatProvider}
                setProvider={setChatProvider}
                models={chatModels}
                model={chatModel}
                setModel={setChatModel}
                imageModels={imageModels}
                imageApiKeys={apiKeys}
                videoModels={videoModels}
                audioModels={audioModels}
                toolImageModel={toolImageModel}
                setToolImageModel={setToolImageModel}
                imagePipelineEnabled={imagePipelineEnabled}
                setImagePipelineEnabled={setImagePipelineEnabled}
                imageModelOrder={imageModelOrder}
                setImageModelOrder={setImageModelOrder}
                imageRetryAttempts={imageRetryAttempts}
                setImageRetryAttempts={setImageRetryAttempts}
                modelsLoading={modelsLoading}
                modelsError={modelsError}
                onRefreshModels={onRefreshModels}
                navyUsage={isNavyChat ? navyUsage : null}
                navyUsageError={isNavyChat ? navyUsageError : null}
                navyUsageLoading={isNavyChat ? navyUsageLoading : false}
                navyUsageUpdatedAt={isNavyChat ? navyUsageUpdatedAt : null}
                onRefreshUsage={isNavyChat ? refreshNavyUsage : undefined}
                saveToGallery={saveToGallery}
                videoImage={videoImage}
                videoAspect={videoAspect}
                videoDuration={videoDuration}
                ttsVoice={ttsVoice}
                ttsFormat={ttsFormat}
                ttsSpeed={ttsSpeed}
                initialInput={initialInput}
                onSaveImages={handleSaveImages}
            />
        </div>
    );
}
