import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hollow Creek — an autumn horror of townsfolk and things",
  description:
    "A 1D multiplayer social-deduction horror. Walk the autumn street, do your chores, ring the bell — and cage the Hollow before it wears your face.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}