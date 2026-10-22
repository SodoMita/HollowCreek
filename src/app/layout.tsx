import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Hollow Creek Bell — a 1D horror town",
  description:
    "A side-scrolling social deduction horror game. Server-authoritative movement, speech bubbles, a bell, and cages in the town square.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // required for env(safe-area-inset-*) to report the notch / home bar
  viewportFit: "cover",
  themeColor: "#05070c",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#05070c] text-[#efe3d0] antialiased">{children}</body>
    </html>
  );
}
