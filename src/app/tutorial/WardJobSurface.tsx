import { useLayoutEffect, useRef } from "react";
import { morphHtml } from "@/game/ward-ui";

/** The practice board morphs in place so a pressed key is never torn out. */
export function WardJobSurface({ html, onMove }: { html: string; onMove: (index: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (ref.current) morphHtml(ref.current, html); }, [html]);
  return (
    <div
      className="w-full"
      ref={ref}
      onClick={(event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-ward-move]");
        if (button && !button.disabled) onMove(Number(button.dataset.wardMove));
      }}
    />
  );
}
