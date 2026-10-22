import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Hollow Creek Bell — a 1D horror town",
  description:
    "A side-scrolling social deduction horror game. Server-authoritative movement, speech bubbles, a bell, and cages in the town square.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#05070c] text-[#efe3d0] antialiased">{children}</body>
    </html>
  );
}
