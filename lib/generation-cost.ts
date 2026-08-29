export const resolveImageGenerationCallCeiling = ({
  imageToolEnabled,
  activeModelCount,
  maxAttemptsPerModel,
}: {
  imageToolEnabled: boolean;
  activeModelCount: number;
  maxAttemptsPerModel: number;
}) => {
  if (!imageToolEnabled || activeModelCount < 1) return 0;
  const attempts = Math.max(1, Math.floor(maxAttemptsPerModel));
  return Math.max(1, Math.floor(activeModelCount)) * attempts;
};
