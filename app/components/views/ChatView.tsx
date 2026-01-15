import { useStudio } from "@/app/contexts/StudioContext";
import { ChutesChat } from "../chutes-chat";
import { CHUTES_IMAGE_MODELS } from "@/lib/constants";

export function ChatView() {
    const {
        apiKey,
        chutesChatModels,
        chutesChatModel,
        setChutesChatModel,
        chutesToolImageModel,
        setChutesToolImageModel,
        chutesChatModelsLoading,
        chutesChatModelsError,
        refreshChutesChatModels
    } = useStudio();

    // Use global key if set, assuming Chutes provider
    // Ideally, we should check which provider is capable of chat or if Chat is always Chutes here?
    // The user request said "full screen chat dashboard where you can chat and create image... using chat and agent".
    // ChutesChat seems to be the agent component.

    return (
        <div className="h-full w-full flex flex-col">
            <ChutesChat
                apiKey={apiKey} // Or specific chutes key? logic in Studio.tsx synced them.
                models={chutesChatModels}
                model={chutesChatModel}
                setModel={setChutesChatModel}
                imageModels={CHUTES_IMAGE_MODELS}
                toolImageModel={chutesToolImageModel}
                setToolImageModel={setChutesToolImageModel}
                modelsLoading={chutesChatModelsLoading}
                modelsError={chutesChatModelsError}
                onRefreshModels={refreshChutesChatModels}
            />
        </div>
    );
}
