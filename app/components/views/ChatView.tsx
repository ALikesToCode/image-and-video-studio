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
import type { ChatImageAsset } from "@/lib/chat-media-persistence";
import { isChatVideoModelSupported } from "@/lib/chat-media-tool-requests";
import { sortModelOptionsByProviderAndName } from "@/lib/model-options";

type ChatViewProps = {
    initialInput?: string | null;
};

const EMPTY_MODELS: ModelOption[] = [];

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
        nanoGptChatModels,
        nanoGptChatModel,
        setNanoGptChatModel,
        nanoGptToolImageModel,
        setNanoGptToolImageModel,
        nanoGptChatModelsLoading,
        nanoGptChatModelsError,
        refreshNanoGptChatModels,
        multiLlmChatModels,
        multiLlmChatModel,
        setMultiLlmChatModel,
        multiLlmToolImageModel,
        setMultiLlmToolImageModel,
        multiLlmChatModelsLoading,
        multiLlmChatModelsError,
        refreshMultiLlmChatModels,
        navyImageModels,
        navyVideoModels,
        navyTtsModels,
        nanoGptImageModels,
        nanoGptVideoModels,
        multiLlmImageModels,
        multiLlmVideoModels,
        multiLlmAudioModels,
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
        preferMaximumImageQuality,
        setPreferMaximumImageQuality,
        videoImage,
        videoAspect,
        videoDuration,
        ttsVoice,
        ttsFormat,
        ttsSpeed,
    } = useStudio();

    const isNavyChat = chatProvider === "navy";
    const isNanoGptChat = chatProvider === "nanogpt";
    const isMultiLlmChat = chatProvider === "multillm";
    const chatApiKey = isNavyChat
        ? apiKeys.navy
        : isNanoGptChat
            ? apiKeys.nanogpt
            : isMultiLlmChat
                ? apiKeys.multillm
                : apiKeys.chutes;
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
    const chatModels = isNavyChat
        ? resolvedNavyChatModels
        : isNanoGptChat
            ? nanoGptChatModels
            : isMultiLlmChat
                ? multiLlmChatModels
                : chutesChatModels;
    const chatModel = isNavyChat
        ? navyChatModel
        : isNanoGptChat
            ? nanoGptChatModel
            : isMultiLlmChat
                ? multiLlmChatModel
                : chutesChatModel;
    const setChatModel = isNavyChat
        ? setNavyChatModel
        : isNanoGptChat
            ? setNanoGptChatModel
            : isMultiLlmChat
                ? setMultiLlmChatModel
                : setChutesChatModel;
    const chutesImageToolModels = useMemo(
        () =>
            sortModelOptionsByProviderAndName(
                appendUniqueModels(CHUTES_IMAGE_MODELS, nanoGptImageModels)
            ),
        [nanoGptImageModels]
    );
    const navyImageToolModels = useMemo(
        () =>
            sortModelOptionsByProviderAndName(
                appendUniqueModels(navyImageModels, nanoGptImageModels)
            ),
        [navyImageModels, nanoGptImageModels]
    );
    const nanoGptImageToolModels = useMemo(
        () =>
            sortModelOptionsByProviderAndName(
                appendUniqueModels(
                    nanoGptImageModels,
                    [...navyImageModels, ...CHUTES_IMAGE_MODELS]
                )
            ),
        [nanoGptImageModels, navyImageModels]
    );
    const imageModels = isNavyChat
        ? navyImageToolModels
        : isNanoGptChat
            ? nanoGptImageToolModels
            : isMultiLlmChat
                ? multiLlmImageModels
                : chutesImageToolModels;
    const videoModels = useMemo(
        () => {
            if (isMultiLlmChat) {
                return multiLlmVideoModels.filter(isChatVideoModelSupported);
            }
            if (isNanoGptChat) {
                return appendUniqueModels(
                    nanoGptVideoModels,
                    [...navyVideoModels, ...CHUTES_VIDEO_MODELS]
                ).filter(isChatVideoModelSupported);
            }
            return appendUniqueModels(
                isNavyChat ? navyVideoModels : CHUTES_VIDEO_MODELS,
                nanoGptVideoModels
            ).filter(isChatVideoModelSupported);
        },
        [
            isMultiLlmChat,
            isNanoGptChat,
            isNavyChat,
            multiLlmVideoModels,
            navyVideoModels,
            nanoGptVideoModels,
        ]
    );
    const audioModels = isMultiLlmChat
        ? multiLlmAudioModels
        : isNanoGptChat
        ? EMPTY_MODELS
        : isNavyChat
            ? navyTtsModels
            : CHUTES_TTS_MODELS;
    const toolImageModel = isNavyChat
        ? navyToolImageModel
        : isNanoGptChat
            ? nanoGptToolImageModel
            : isMultiLlmChat
                ? multiLlmToolImageModel
                : chutesToolImageModel;
    const setToolImageModel = isNavyChat
        ? setNavyToolImageModel
        : isNanoGptChat
            ? setNanoGptToolImageModel
            : isMultiLlmChat
                ? setMultiLlmToolImageModel
                : setChutesToolImageModel;
    const modelsLoading = isNavyChat
        ? navyChatModelsLoading
        : isNanoGptChat
            ? nanoGptChatModelsLoading
            : isMultiLlmChat
                ? multiLlmChatModelsLoading
                : chutesChatModelsLoading;
    const modelsError = isNavyChat
        ? navyChatModelsError
        : isNanoGptChat
            ? nanoGptChatModelsError
            : isMultiLlmChat
                ? multiLlmChatModelsError
                : chutesChatModelsError;
    const onRefreshModels = isNavyChat
        ? refreshNavyChatModels
        : isNanoGptChat
            ? refreshNanoGptChatModels
            : isMultiLlmChat
                ? refreshMultiLlmChatModels
                : refreshChutesChatModels;
    const handleSaveImages = (payload: {
        images: ChatImageAsset[];
        prompt: string;
        model: string;
        provider: Provider;
    }) => saveChatImages(payload);

    useEffect(() => {
        if (!chatModels.length) return;
        if (!chatModels.some((entry) => entry.id === chatModel)) {
            setChatModel(chatModels[0].id);
        }
    }, [chatModel, chatModels, setChatModel]);

    useEffect(() => {
        if (!imageModels.length) return;
        if (!imageModels.some((entry) => entry.id === toolImageModel)) {
            setToolImageModel(imageModels[0].id);
        }
    }, [imageModels, setToolImageModel, toolImageModel]);

    useEffect(() => {
        if (!isNavyChat) return;
        if (!apiKeys.navy.trim()) return;
        void refreshNavyUsage();
    }, [apiKeys.navy, isNavyChat, refreshNavyUsage]);

    return (
        <div className="h-full w-full flex flex-col">
            <ChutesChat
                apiKey={chatApiKey}
                allowServerApiKey={isMultiLlmChat}
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
                preferMaximumImageQuality={preferMaximumImageQuality}
                setPreferMaximumImageQuality={setPreferMaximumImageQuality}
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
