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
  title: "Hollow Creek — Night of the Strigoi",
  description:
    "A 2D multiplayer social-deduction horror. Walk the whole valley — farm, chapel rise, sawmill, creek and cemetery — finish the wards, ring the bell, and cage the Hollow before it wears your face.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}