export type InstallPlatform =
  | "ios"
  | "android-chrome"
  | "desktop-chrome"
  | "generic";

export type InstallGuidance = {
  platform: InstallPlatform;
  primaryAction: string;
  title: string;
  description: string;
  steps: string[];
};

export const shouldShowInstallEntryPoint = (isStandalone: boolean) =>
  !isStandalone;

export const getInstallGuidance = (
  userAgent: string,
  hasNativePrompt = false
): InstallGuidance => {
  const normalized = userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(normalized);
  const isAndroid = normalized.includes("android");
  const isChromium =
    /(chrome|crios|chromium)/.test(normalized) &&
    !/(edg|opr|opera|samsungbrowser)/.test(normalized);

  if (hasNativePrompt) {
    return {
      platform: isAndroid && isChromium ? "android-chrome" : "desktop-chrome",
      primaryAction: "Install app",
      title: "Install Studio",
      description: "Chrome can install this app directly on this device.",
      steps: [
        "Tap Install app to open Chrome's native install prompt.",
        "Confirm Install when Chrome asks.",
        "Launch Studio from your home screen or app launcher.",
      ],
    };
  }

  if (isIos) {
    return {
      platform: "ios",
      primaryAction: "How to install",
      title: "Add Studio to your Home Screen",
      description: "iPhone and iPad do not expose Chrome's install prompt to web apps.",
      steps: [
        "Open this page in Safari.",
        "Tap the Share button in the browser toolbar.",
        "Choose Add to Home Screen, then tap Add.",
      ],
    };
  }

  if (isAndroid && isChromium) {
    return {
      platform: "android-chrome",
      primaryAction: "How to install",
      title: "Install Studio on Android",
      description: "If Chrome has not shown the install prompt yet, use the browser menu.",
      steps: [
        "Open Chrome's three-dot menu.",
        "Tap Add to Home screen or Install app.",
        "Confirm the install and launch Studio from your launcher.",
      ],
    };
  }

  if (isChromium) {
    return {
      platform: "desktop-chrome",
      primaryAction: "How to install",
      title: "Install Studio in Chrome",
      description: "Chrome can install eligible web apps from the address bar or menu.",
      steps: [
        "Look for the install icon in the address bar.",
        "Or open Chrome's menu and choose Install page.",
        "Confirm the install to open Studio as an app window.",
      ],
    };
  }

  return {
    platform: "generic",
    primaryAction: "Install help",
    title: "Install Studio",
    description: "Your browser may still support adding this app to the home screen.",
    steps: [
      "Open the browser menu or share sheet.",
      "Look for Add to Home Screen, Install, or Save to device.",
      "Use Chrome or Safari if your current browser does not expose install actions.",
    ],
  };
};
