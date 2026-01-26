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
        saveChatImages,
        saveToGallery,
    } = useStudio();

    const isNavyChat = chatProvider === "navy";
    const chatApiKey = isNavyChat ? apiKeys.navy : apiKeys.chutes;
    const chatModels = isNavyChat ? navyChatModels : chutesChatModels;
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
