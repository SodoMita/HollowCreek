/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { ArrowLeft, Download, ExternalLink, Palette } from "lucide-react";

const groups = [
  { title: "Houses & doors", note: "The frame and leaf are separate, so the open door no longer leaves a black panel behind.", files: [
    ["Tollhouse façade", "house/facade-tollhouse.svg"], ["Orchard façade", "house/facade-orchard.svg"],
    ["Office façade", "house/facade-foreman.svg"], ["Cottage façade", "house/facade-quarry.svg"],
    ["Interior wall & floor", "house/interior.svg"], ["Transparent windows", "house/windows.svg"],
    ["Door frame", "house/door-frame.svg"], ["Closed door leaf", "house/door-closed.svg"],
    ["Open door leaf", "house/door-open.svg"], ["Nameplate", "house/sign.svg"],
  ] },
  { title: "People & street objects", note: "The traveler is recolored in game; the SVG shows its default palette.", files: [
    ["Traveler", "characters/traveler.svg"], ["Autumn tree", "scenery/autumn-tree.svg"],
    ["Brass key", "props/key.svg"], ["Timepiece", "props/timepiece.svg"], ["Supply cart", "props/supply-cart.svg"], ["Repair kit", "props/supply-kit.svg"],
  ] },
  { title: "House furnishings", note: "Move or resize these in rooms.json, or edit each object in your SVG editor.", files: [
    ["Stone hearth", "furniture/hearth.svg"], ["Hearth flame", "furniture/fire.svg"],
    ["Preserves cupboard", "furniture/pantry.svg"], ["Clock", "furniture/clock.svg"],
    ["Fuse board", "furniture/fusebox.svg"], ["Restored fuse lights", "furniture/fuses-live.svg"],
    ["Table & lantern", "furniture/table.svg"], ["Desk & ledger", "furniture/desk.svg"],
    ["Cottage bed", "furniture/bed.svg"], ["Fruit crate", "furniture/crate.svg"],
    ["Shelf & crockery", "furniture/shelf.svg"], ["Woven rug", "furniture/rug.svg"], ["Entrance barrel", "furniture/barrel.svg"],
    ["Framed landscape", "furniture/frame.svg"],
  ] },
] as const;

export default function ArtLibrary() {
  return (
    <main className="min-h-screen bg-[#0d0a12] px-5 py-8 text-[#eadfce] sm:px-8 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#c0a88f] hover:text-[#ffd89c]"><ArrowLeft className="h-4 w-4" /> Back to town</Link>
        <div className="mt-9 flex flex-wrap items-end justify-between gap-5 border-b border-[#443038] pb-7">
          <div><p className="flex items-center gap-2 text-xs uppercase tracking-[.25em] text-[#d49b5b]"><Palette className="h-4 w-4" /> Editable game artwork</p><h1 className="mt-2 font-display text-5xl sm:text-6xl">The art library</h1><p className="mt-3 max-w-2xl text-[#bcae9f]">These are the SVG files used in the game. Open or download an object, edit it in your favorite vector editor, and share the changes.</p></div>
          <div className="flex flex-wrap gap-2"><a href="/art/rooms.json" target="_blank" rel="noreferrer" className="rounded border border-[#765846] px-3 py-2 text-sm text-[#efd0a3] hover:bg-[#2a1c22]">Room layout JSON</a><a href="/art/README.md" target="_blank" rel="noreferrer" className="rounded bg-[#8f4a2b] px-3 py-2 text-sm text-[#fff0d7] hover:bg-[#a85c35]">Editing guide</a></div>
        </div>
        {groups.map((group) => <section key={group.title} className="mt-10"><div className="mb-4"><h2 className="font-display text-3xl">{group.title}</h2><p className="mt-1 text-sm text-[#9d8a7e]">{group.note}</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{group.files.map(([name, path]) => <article key={path} className="overflow-hidden rounded-lg border border-[#443038] bg-[#19121b]"><div className="flex h-32 items-center justify-center bg-[linear-gradient(45deg,#211921_25%,transparent_25%,transparent_75%,#211921_75%),linear-gradient(45deg,#211921_25%,#30242c_25%,#30242c_75%,#211921_75%)] bg-[length:20px_20px] bg-[position:0_0,10px_10px] p-4"><img src={`/art/${path}`} alt={name} className="max-h-full max-w-full object-contain" /></div><div className="p-3"><h3 className="font-semibold text-[#ead9c1]">{name}</h3><p className="mt-1 truncate font-mono text-[10px] text-[#927d72]" title={path}>{path}</p><div className="mt-3 flex gap-3 text-xs text-[#dfad78]"><a href={`/art/${path}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-[#ffe3b4]"><ExternalLink className="h-3 w-3" /> Open</a><a href={`/art/${path}`} download className="inline-flex items-center gap-1 hover:text-[#ffe3b4]"><Download className="h-3 w-3" /> Download</a></div></div></article>)}</div></section>)}
        <p className="mt-12 border-t border-[#443038] pt-5 text-sm text-[#9d8a7e]">House geometry and game rules remain separate from the artwork. The editing guide explains the door anchor, transparent windows, and standalone build.</p>
      </div>
    </main>
  );
}
