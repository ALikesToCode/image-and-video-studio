import { useEffect, useMemo } from "react";
import { useStudio } from "@/app/contexts/StudioContext";
import { ChutesChat } from "../chutes-chat";
import { CHUTES_IMAGE_MODELS } from "@/lib/constants";

export function ChatView() {
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
        saveChatImages,
        saveToGallery,
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
    const imageModels = isNavyChat ? navyImageModels : CHUTES_IMAGE_MODELS;
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
        if (!resolvedNavyChatModels.some((model) => model.id === navyChatModel)) {
            setNavyChatModel(resolvedNavyChatModels[0].id);
        }
    }, [isNavyChat, navyChatModel, resolvedNavyChatModels, setNavyChatModel]);

    useEffect(() => {
        if (!isNavyChat) return;
        if (!navyImageModels.length) return;
        if (!navyImageModels.some((model) => model.id === navyToolImageModel)) {
            setNavyToolImageModel(navyImageModels[0].id);
        }
    }, [isNavyChat, navyImageModels, navyToolImageModel, setNavyToolImageModel]);

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
                toolImageModel={toolImageModel}
                setToolImageModel={setToolImageModel}
                modelsLoading={modelsLoading}
                modelsError={modelsError}
                onRefreshModels={onRefreshModels}
                saveToGallery={saveToGallery}
                onSaveImages={handleSaveImages}
            />
        </div>
    );
}
