import type { Metadata } from "next";
import { DM_Serif_Display, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const display = DM_Serif_Display({
  variable: "--font-display",
  weight: ["400"],
  subsets: ["latin"],
});

const text = IBM_Plex_Sans({
  variable: "--font-text",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Image & Video Studio",
  description:
    "Local-first studio for generating images and videos with Gemini and NavyAI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${text.variable}`}>
        {children}
      </body>
    </html>
  );
}
