import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0710",
};

export const metadata: Metadata = {
  title: "Hollow Creek · Nyx's Nightwatch",
  description:
    "A multiplayer night of wards, locked houses and things wearing human faces — kept by Nyx, catgirl of the night watch.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}