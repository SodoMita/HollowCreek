import type { Metadata } from "next";
import TutorialClient from "./TutorialClient";

export const metadata: Metadata = {
  title: "Singleplayer Tutorial — Hollow Creek",
  description:
    "Learn the autumn street: push the supply cart, deliver repair kits, solve ward minigames, unlock iron cages, and survive the Hollow.",
};

export default function TutorialPage() {
  return <TutorialClient />;
}
