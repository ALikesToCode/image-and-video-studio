export type StudioGenerationMode = "image" | "video" | "tts";

const generationMedium = (mode: StudioGenerationMode) =>
  mode === "tts" ? "audio" : mode;

export const resolveGenerationSubmitState = ({
  prompt,
  busy,
  mode,
}: {
  prompt: string;
  busy: boolean;
  mode: StudioGenerationMode;
}) => {
  const medium = generationMedium(mode);
  return {
    disabled: !prompt.trim(),
    label: busy ? `Add ${medium} to queue` : `Generate ${medium}`,
    hint: busy
      ? "Current jobs keep running; this request will be queued."
      : "Press Cmd/Ctrl+Enter to generate.",
  };
};
