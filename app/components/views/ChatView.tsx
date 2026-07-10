import { useEffect, useMemo } from "react";
import { useStudio } from "@/app/contexts/StudioContext";
import { ChutesChat } from "../chutes-chat";
import {
    CHUTES_IMAGE_MODELS,
    CHUTES_TTS_MODELS,
    CHUTES_VIDEO_MODELS,
    type ModelOption,
    type Provider,
} from "@/lib/constants";
import { isChatVideoModelSupported, type ChatImageAsset } from "@/lib/chat-tooling";

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
        nanoGptImageModels,
        nanoGptVideoModels,
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
        () => appendUniqueModels(CHUTES_IMAGE_MODELS, nanoGptImageModels),
        [nanoGptImageModels]
    );
    const navyImageToolModels = useMemo(
        () => appendUniqueModels(navyImageModels, nanoGptImageModels),
        [navyImageModels, nanoGptImageModels]
    );
    const imageModels = isNavyChat ? navyImageToolModels : chutesImageToolModels;
    const videoModels = useMemo(
        () =>
            appendUniqueModels(
                isNavyChat ? navyVideoModels : CHUTES_VIDEO_MODELS,
                nanoGptVideoModels
            ).filter(isChatVideoModelSupported),
        [isNavyChat, navyVideoModels, nanoGptVideoModels]
    );
    const audioModels = isNavyChat ? navyTtsModels : CHUTES_TTS_MODELS;
    const toolImageModel = isNavyChat ? navyToolImageModel : chutesToolImageModel;
    const setToolImageModel = isNavyChat ? setNavyToolImageModel : setChutesToolImageModel;
    const modelsLoading = isNavyChat ? navyChatModelsLoading : chutesChatModelsLoading;
    const modelsError = isNavyChat ? navyChatModelsError : chutesChatModelsError;
    const onRefreshModels = isNavyChat ? refreshNavyChatModels : refreshChutesChatModels;
    const handleSaveImages = (payload: {
        images: ChatImageAsset[];
        prompt: string;
        model: string;
        provider: Provider;
    }) => saveChatImages(payload);

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
                videoApiKeys={apiKeys}
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
