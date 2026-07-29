import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/theme-provider";
import { cn } from "@/lib/utils";

const display = DM_Serif_Display({
  subsets: ["latin"],
  variable: "--font-display",
  weight: "400",
  display: "swap",
  preload: false,
});

const text = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-text",
  weight: ["400", "500", "600", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  applicationName: "Studio",
  title: "Studio — Create anything",
  description:
    "Ask one creative agent to develop ideas and make images, videos, or audio.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Studio",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/studio-icon.svg", type: "image/svg+xml" },
      { url: "/studio-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/studio-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-visual",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7ef" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1917" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          "min-h-screen bg-background font-sans antialiased",
          display.variable,
          text.variable
        )}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
