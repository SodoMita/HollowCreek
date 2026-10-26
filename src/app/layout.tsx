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
  title: "Hollow Creek — an autumn horror of townsfolk and things",
  description:
    "A multiplayer social-deduction horror. Walk the autumn creek, mend the wards, and open the locked houses with the iron key.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}