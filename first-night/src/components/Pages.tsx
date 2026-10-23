import { useState } from "react";
import {
  ArrowRight,
  Award,
  Check,
  ChevronRight,
  Clock,
  Eye,
  Feather,
  Flame,
  Moon,
  Stamp,
  Trash2,
} from "lucide-react";
import { cn } from "../utils/cn";
import {
  SEALS_META,
  SUSPECTS,
  WARDS,
  formatTime,
  type Progress,
  type View,
} from "../lib/game";
import { MothMark } from "./Tutorial";
import { Button, Chip, Kicker, Ornament, Portrait, ProgressRing } from "./ui";

export function Bestiary({ go }: { go: (view: View) => void }) {
  return (
    <div>
      <div className="flex flex-col gap-4 border-b border-parchment/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Kicker>Field guide · edition of the Gloamwing</Kicker>
          <h1 className="mt-3 max-w-[640px] font-serif text-[34px] leading-[1.02] text-parchment sm:text-[46px]">
            The things that walk home
            <span className="italic text-amber-bright"> after the bell.</span>
          </h1>
          <p className="mt-2 max-w-[560px] text-[12.5px] leading-relaxed text-parchment-dim">
            A short, honest guide to Hollow Creek: one impostor, one town, and one creature no other edition of this
            guide thought to claim. Keep it close. The dark is not a role you can vote out.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Chip tone="amber"><Stamp className="h-2.5 w-2.5" /> kept by the Gloamwing</Chip>
        </div>
      </div>

      <div className="relative mt-6 overflow-hidden rounded-2xl border border-[#2b2519] bg-[#e9dfc8] text-[#20241b] shadow-[0_30px_90px_-50px_rgba(0,0,0,0.9)]">
        <div className="paper-grain absolute inset-0 opacity-60" aria-hidden />
        <div className="relative grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="relative min-h-[360px] border-b border-[#20241b]/15 lg:min-h-[560px] lg:border-b-0 lg:border-r">
            <img
              src="/images/gloamwing.jpg"
              alt="Archival plate of the Gloamwing, a large pale moth with lantern-glass wings"
              className="absolute inset-0 h-full w-full object-cover mix-blend-multiply saturate-[0.8]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#e9dfc8] via-transparent to-[#e9dfc8]/10" aria-hidden />
            <div className="absolute left-5 top-5 font-mono text-[8px] uppercase tracking-[0.2em] text-[#20241b]/60">
              Plate I · Lampyris memorialis
            </div>
            <div className="absolute right-5 top-5 grid h-12 w-12 -rotate-6 place-items-center rounded-full border-2 border-[#7d3f2c]/40 font-mono text-[6px] uppercase leading-tight tracking-[0.08em] text-[#7d3f2c]/65">
              neither
              <br />
              side
            </div>

            <div className="absolute left-[18%] top-[31%] hidden sm:block">
              <span className="absolute h-px w-20 -rotate-[28deg] bg-[#20241b]/35" aria-hidden />
              <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full border border-[#7d3f2c]/60 bg-[#e9dfc8]" aria-hidden />
              <span className="absolute -left-[84px] -top-14 w-[90px] font-serif text-[11px] italic leading-snug text-[#20241b]/65">
                four eyespots, each a small flame
              </span>
            </div>
            <div className="absolute bottom-[44%] right-[19%] hidden sm:block">
              <span className="absolute h-px w-16 rotate-[34deg] bg-[#20241b]/35" aria-hidden />
              <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full border border-[#7d3f2c]/60 bg-[#e9dfc8]" aria-hidden />
              <span className="absolute -right-[86px] -top-4 w-[88px] font-serif text-[11px] italic leading-snug text-[#20241b]/65">
                wing-glass, smoked amber
              </span>
            </div>
            <div className="absolute bottom-[24%] left-[28%] hidden sm:block">
              <span className="absolute h-px w-14 -rotate-[16deg] bg-[#20241b]/35" aria-hidden />
              <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full border border-[#7d3f2c]/60 bg-[#e9dfc8]" aria-hidden />
              <span className="absolute -left-[74px] top-2 w-[80px] text-right font-serif text-[11px] italic leading-snug text-[#20241b]/65">
                antennae, curled with listening
              </span>
            </div>

            <div className="absolute bottom-5 left-5 right-5 rounded-sm border border-[#20241b]/20 bg-[#f3ebd8]/85 p-3 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-[#7d3f2c]/35 font-serif text-[11px] text-[#7d3f2c]">✦</span>
                <p className="font-serif text-[12px] leading-relaxed text-[#2d3227]">
                  The only plate in this edition filed with no role, no faction, and no possible vote. The Gloamwing
                  keeps the record; it does not play the game.
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-8 lg:p-10">
            <div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.2em] text-[#7d3f2c]">
              <span className="h-px w-6 bg-[#7d3f2c]/50" /> the creature nobody claimed
            </div>
            <h2 className="mt-3 font-serif text-[42px] leading-[0.95] text-[#1c2119] sm:text-[58px]">The Gloamwing</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[8px] uppercase tracking-[0.16em] text-[#20241b]/55">
              <span>the lantern-moth</span>
              <span className="h-2 w-px bg-[#20241b]/20" />
              <span>no known nest</span>
              <span className="h-2 w-px bg-[#20241b]/20" />
              <span>never caged</span>
            </div>

            <p className="mt-5 font-serif text-[16px] leading-relaxed text-[#2d3227]">
              It comes after midnight, when the last lantern is snuffed. The smoke does not leave the wick so much as
              go looking for it. The Gloamwing drinks what the flame forgets and carries, folded in its wings, the
              last words of anyone who has lost them in the creek.
            </p>
            <p className="mt-3 font-serif text-[16px] leading-relaxed text-[#2d3227]">
              It has no part in the contest of Hollow and crew. It is not a secret role. It has never voted, never lied
              in a meeting, and never once been wrong about who came home. It is simply the night's own witness — and
              the keeper of this edition.
            </p>

            <div className="mt-6 border-t border-[#20241b]/15 pt-5">
              <div className="font-mono text-[8px] uppercase tracking-[0.18em] text-[#1c2119]/60">Observed habits</div>
              <div className="mt-3 divide-y divide-[#20241b]/10">
                {[
                  { n: "i", title: "It follows a lantern, not a person.", text: "Lure it with light, never a name. Names make it stay." },
                  { n: "ii", title: "It repeats only what was lost.", text: "If it speaks in your voice, you have already forgotten something." },
                  { n: "iii", title: "It cannot cross a lit threshold uninvited.", text: "The oldest houses in the creek leave one lamp burning for this reason." },
                  { n: "iv", title: "It will not enter the cage.", text: "Iron and moonlight are the one argument it respects." },
                ].map((note) => (
                  <div key={note.title} className="flex items-start gap-3 py-2.5">
                    <span className="mt-0.5 w-4 shrink-0 font-serif text-[13px] italic text-[#7d3f2c]/70">{note.n}</span>
                    <div>
                      <div className="font-serif text-[13.5px] leading-snug text-[#1c2119]">{note.title}</div>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[#2d3227]/75">{note.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#20241b]/15 pt-4">
              <span className="inline-flex items-center gap-1.5 font-mono text-[7.5px] uppercase tracking-[0.13em] text-[#20241b]/55">
                <MothMark className="h-4 w-4 text-[#7d3f2c]" /> witnessed in the solo prologue
              </span>
              <Button variant="dark" onClick={() => go("tutorial")} className="py-2.5 text-[8px]">
                Meet it on the first night <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <section className="mt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Kicker>Know your company</Kicker>
            <h2 className="mt-2 font-serif text-[28px] leading-tight text-parchment sm:text-[34px]">The three company-keepers.</h2>
          </div>
          <p className="max-w-[360px] text-[11.5px] leading-relaxed text-ash">
            Every figure in Hollow Creek is one of these at the start of the night. Only two are playable roles. The
            third keeps the book.
          </p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            {
              icon: Flame,
              title: "The town",
              label: "crew · 4–9 souls",
              text: "Finish every shared ward, or cage the Hollow before the lanterns die. Any living person may work any ward. Death cannot hold the work hostage.",
              accent: "#d7a35f",
            },
            {
              icon: Moon,
              title: "The Hollow",
              label: "impostor · 1–2 souls",
              text: "Wear a neighbour. Kill in the lane, snuff every lantern, and survive the question. The Hollow is always chosen uniformly at random — join order is not destiny.",
              accent: "#b8663f",
            },
            {
              icon: MothMark,
              title: "The Gloamwing",
              label: "witness · not a side",
              text: "Not playable. Not a secret faction. It drinks the smoke, keeps the names, and teaches the first night. The one creature the Hollow will not touch.",
              accent: "#9c9ac1",
            },
          ].map((entry) => (
            <div key={entry.title} className="relative overflow-hidden rounded-xl border border-parchment/12 bg-[#0d130f]/85 p-5">
              <div className="absolute right-0 top-0 h-20 w-20 rounded-full blur-2xl" style={{ background: `${entry.accent}18` }} aria-hidden />
              <span className="relative grid h-10 w-10 place-items-center rounded-full border" style={{ borderColor: `${entry.accent}55`, color: entry.accent }}>
                <entry.icon className="h-4 w-4" strokeWidth={1.5} />
              </span>
              <div className="mt-3 font-serif text-[23px] leading-tight text-parchment">{entry.title}</div>
              <div className="font-mono text-[7.5px] uppercase tracking-[0.14em] text-ash">{entry.label}</div>
              <p className="mt-2.5 text-[11px] leading-relaxed text-parchment-dim">{entry.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 overflow-hidden rounded-2xl border border-parchment/12 bg-[#0d130f]/80">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="p-5 sm:p-7">
            <Kicker>Solo rules of the house</Kicker>
            <h2 className="mt-2 font-serif text-[26px] leading-tight text-parchment sm:text-[31px]">What a night alone changes.</h2>
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {[
                { title: "Wards are won, not held", text: "Each chore is a different minigame. No timer punishes you for thinking." },
                { title: "Clues replace a crowd", text: "Every ward leaves one clue. The decisive clue is always drawn from the Hollow's own trade." },
                { title: "Random is actually random", text: "The culprit is drawn uniformly from four neighbours with the browser's cryptographic RNG." },
                { title: "The tutorial can be replayed", text: "Nothing is lost by walking the first night twice. The ledger remembers both." },
              ].map((rule) => (
                <div key={rule.title} className="rounded-lg border border-parchment/10 bg-parchment/[0.025] p-3.5">
                  <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-parchment">
                    <Check className="h-3 w-3 text-amber" /> {rule.title}
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ash">{rule.text}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="border-t border-parchment/10 p-5 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2">
              <Eye className="h-3.5 w-3.5 text-amber" />
              <span className="font-mono text-[8px] uppercase tracking-[0.17em] text-ash">What the Hollow knows</span>
            </div>
            <div className="mt-3 space-y-2.5">
              {SUSPECTS.map((suspect) => (
                <div key={suspect.id} className="flex items-start gap-2.5">
                  <Portrait initials={suspect.initials} colour={suspect.colour} size="sm" />
                  <div>
                    <div className="text-[11px] font-medium text-parchment">{suspect.name}</div>
                    <p className="text-[9.5px] leading-relaxed text-ash">{suspect.tell}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-parchment/10 pt-3 text-[9.5px] leading-relaxed text-ash/70">
              One of these tells belongs to the Hollow. The other three are simply how the people you love
              smell at midnight.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-10 flex flex-col items-center gap-3">
        <Ornament />
        <p className="max-w-[520px] text-center font-serif text-[15px] italic leading-relaxed text-parchment-dim">
          &ldquo;The creek keeps no saints. It keeps a record.&rdquo;
          <span className="mt-1 block font-sans text-[8px] not-italic uppercase tracking-[0.16em] text-ash/60">
            The Gloamwing · keeper of this edition
          </span>
        </p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          <Button onClick={() => go("tutorial")} className="py-3 text-[9.5px]">Begin the first night <ArrowRight className="h-3 w-3" /></Button>
          <Button variant="secondary" onClick={() => go("night")} className="py-3 text-[9.5px]">Walk a night alone</Button>
        </div>
      </div>
    </div>
  );
}

export function Records({
  progress,
  go,
  onReset,
}: {
  progress: Progress;
  go: (view: View) => void;
  onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const nights = progress.nights;
  const wins = nights.filter((night) => night.won).length;
  const best = nights.length ? Math.min(...nights.map((night) => night.seconds)) : 0;
  const recent = [...nights].reverse();

  return (
    <div>
      <div className="flex flex-col gap-4 border-b border-parchment/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Kicker>Hall of records · this device only</Kicker>
          <h1 className="mt-3 font-serif text-[34px] leading-[1.02] text-parchment sm:text-[46px]">
            The creek keeps <span className="italic text-amber-bright">a ledger.</span>
          </h1>
          <p className="mt-2 max-w-[540px] text-[12.5px] leading-relaxed text-parchment-dim">
            Every finished first night, every ward seal, every accusation and every time you were wrong. No account,
            no cloud, no town gossip — this is your copy of the book.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-xl border border-amber/20 bg-amber/[0.05] px-4 py-3">
          <ProgressRing value={progress.seals.length} total={4} size={52} label="seals" />
          <div>
            <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-amber">Keeper</div>
            <div className="font-serif text-[19px] leading-tight text-parchment">{progress.name || "Wren"}</div>
            <div className="font-mono text-[7.5px] uppercase tracking-[0.11em] text-ash">
              {progress.tutorialDone ? "first night kept" : "first night unclaimed"}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          { label: "nights walked", value: String(nights.length).padStart(2, "0"), icon: Moon },
          { label: "hollows named", value: String(wins).padStart(2, "0"), icon: Eye },
          { label: "wards sealed", value: String(progress.seals.length).padStart(2, "0"), icon: Flame },
          { label: "quickest dawn", value: best ? formatTime(best) : "—", icon: Clock },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-parchment/10 bg-[#0d130f]/80 p-3.5">
            <stat.icon className="h-3.5 w-3.5 text-amber/70" strokeWidth={1.5} />
            <div className="mt-2 font-serif text-[24px] leading-none text-parchment">{stat.value}</div>
            <div className="mt-1 font-mono text-[7px] uppercase tracking-[0.12em] text-ash">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="relative mt-5 overflow-hidden rounded-2xl border border-[#2b2519] bg-[#e9dfc8] text-[#20241b]">
        <div className="paper-grain absolute inset-0 opacity-50" aria-hidden />
        <div className="relative">
          <div className="flex flex-col gap-2 border-b border-[#20241b]/15 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <div>
              <div className="font-mono text-[8px] uppercase tracking-[0.22em] text-[#7d3f2c]">The ledger of Callow Lane</div>
              <div className="mt-1 font-serif text-[22px] leading-tight text-[#1c2119]">Nights, names &amp; small mercies</div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[7.5px] uppercase tracking-[0.13em] text-[#20241b]/55">
              <Stamp className="h-3 w-3" /> sealed locally
            </div>
          </div>

          {nights.length === 0 ? (
            <div className="px-5 py-12 text-center sm:px-7">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-[#20241b]/20">
                <Feather className="h-6 w-6 text-[#7d3f2c]/60" strokeWidth={1.2} />
              </div>
              <h3 className="mt-4 font-serif text-[24px] text-[#1c2119]">The first page is still blank.</h3>
              <p className="mx-auto mt-2 max-w-[360px] font-serif text-[13px] leading-relaxed text-[#2d3227]/75">
                No nights walked, no accusations made. A rare and enviable position in Hollow Creek. Keep it as long
                as you can.
              </p>
              <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <Button variant="dark" onClick={() => go("tutorial")} className="py-3 text-[9px]">
                  Begin the first night <ArrowRight className="h-3 w-3" />
                </Button>
                <button
                  type="button"
                  onClick={() => go("night")}
                  className="rounded-full border border-[#20241b]/25 px-4 py-3 font-mono text-[9px] uppercase tracking-[0.13em] text-[#20241b]/70 transition hover:border-[#20241b]/50"
                >
                  Deal a night
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[#20241b]/15 font-mono text-[7.5px] uppercase tracking-[0.14em] text-[#20241b]/50">
                    <th className="px-5 py-2.5 font-medium sm:px-7">Night</th>
                    <th className="px-3 py-2.5 font-medium">Keeper</th>
                    <th className="px-3 py-2.5 font-medium">The Hollow</th>
                    <th className="px-3 py-2.5 font-medium">You named</th>
                    <th className="px-3 py-2.5 font-medium">Wards</th>
                    <th className="px-3 py-2.5 text-right font-medium sm:pr-7">Dawn</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((night, index) => (
                    <tr key={night.id} className="border-b border-[#20241b]/10 last:border-0">
                      <td className="px-5 py-3 font-mono text-[9px] text-[#20241b]/55 sm:px-7">
                        {String(nights.length - index).padStart(2, "0")}
                        <div className="text-[7px] uppercase tracking-[0.1em] text-[#20241b]/40">
                          {new Date(night.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-serif text-[13px] text-[#1c2119]">{night.name}</td>
                      <td className="px-3 py-3 font-serif text-[13px] text-[#1c2119]">{night.culprit}</td>
                      <td className="px-3 py-3 font-serif text-[13px] text-[#2d3227]/75">{night.accused}</td>
                      <td className="px-3 py-3 font-mono text-[9px] text-[#2d3227]/65">{night.wards} / 4</td>
                      <td className="px-3 py-3 text-right sm:pr-7">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-1 font-mono text-[7px] uppercase tracking-[0.1em]",
                            night.won
                              ? "border-[#3e6650]/35 bg-[#3e6650]/10 text-[#3e6650]"
                              : "border-[#8c4630]/35 bg-[#8c4630]/10 text-[#8c4630]",
                          )}
                        >
                          {night.won ? <Check className="h-2.5 w-2.5" /> : <Moon className="h-2.5 w-2.5" />}
                          {night.won ? "dawn" : "lights out"}
                          <span className="ml-1 opacity-60">{formatTime(night.seconds)}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col gap-2 border-t border-[#20241b]/15 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <span className="font-serif text-[11px] italic text-[#20241b]/55">
              &ldquo;A record is not a verdict. It is only a better memory.&rdquo;
            </span>
            <div className="flex items-center gap-2">
              {!confirming ? (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 font-mono text-[7.5px] uppercase tracking-[0.12em] text-[#8c4630]/75 transition hover:text-[#8c4630]"
                >
                  <Trash2 className="h-2.5 w-2.5" /> clear ledger
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-[#8c4630]">Erase everything?</span>
                  <button type="button" onClick={() => { onReset(); setConfirming(false); }} className="rounded-sm border border-[#8c4630]/40 px-2 py-1 font-mono text-[7.5px] uppercase tracking-[0.1em] text-[#8c4630]">
                    yes
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="font-mono text-[7.5px] uppercase tracking-[0.1em] text-[#20241b]/60">
                    no
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="rounded-xl border border-parchment/10 bg-[#0d130f]/80 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-ash">Ward seals</span>
            <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-amber">{progress.seals.length} / 4</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEALS_META.map((seal) => {
              const owned = progress.seals.includes(seal.id);
              const ward = WARDS.find((item) => item.id === seal.id);
              return (
                <div key={seal.id} className={cn("rounded-lg border p-3", owned ? "border-amber/30 bg-amber/[0.055]" : "border-parchment/10 bg-parchment/[0.02]")}>
                  <div className={cn("font-serif text-2xl", owned ? "text-amber-bright" : "text-ash/25")}>{seal.mark}</div>
                  <div className={cn("mt-1.5 text-[10.5px] font-medium leading-snug", owned ? "text-parchment" : "text-ash/60")}>{seal.name}</div>
                  <div className="mt-0.5 font-mono text-[6.5px] uppercase tracking-[0.09em] text-ash/50">{ward?.game}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-parchment/[0.08] pt-3">
            <span className="font-mono text-[7.5px] uppercase tracking-[0.11em] text-ash/60">{progress.practices} practice rounds</span>
            <button type="button" onClick={() => go("home")} className="inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.11em] text-amber/80 hover:text-amber">
              Practice a ward <ChevronRight className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-xl border border-parchment/10 bg-[#0d130f]/80 p-4 sm:p-5">
          <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full border border-amber/10" aria-hidden />
          <div className="font-mono text-[8px] uppercase tracking-[0.16em] text-ash">The first-night seal</div>
          {progress.tutorialDone ? (
            <div className="mt-3 flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-amber/40 bg-amber/10 text-amber">
                <Award className="h-5 w-5" strokeWidth={1.4} />
              </span>
              <div>
                <div className="font-serif text-[19px] leading-tight text-parchment">Witnessed by the Gloamwing</div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ash">
                  You have carried a light, finished a ward, read a body, and named the right thing under the right
                  moon. Replay it whenever the creek feels too quiet.
                </p>
                <button type="button" onClick={() => go("tutorial")} className="mt-2 inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.11em] text-amber/80 hover:text-amber">
                  Walk it again <ChevronRight className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-parchment/15 text-ash/40">
                <MothMark className="h-5 w-5" />
              </span>
              <div>
                <div className="font-serif text-[19px] leading-tight text-parchment-dim">Still unclaimed</div>
                <p className="mt-1 text-[10.5px] leading-relaxed text-ash">
                  The tutorial ends with a field note in your name. No multiplayer, no waiting room, no stranger to
                  impress. Just one honest night.
                </p>
                <button type="button" onClick={() => go("tutorial")} className="mt-2 inline-flex items-center gap-1 font-mono text-[7.5px] uppercase tracking-[0.11em] text-amber/80 hover:text-amber">
                  Begin the first night <ChevronRight className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-col items-center gap-2">
        <Ornament />
        <p className="max-w-[460px] text-center text-[10px] leading-relaxed text-ash/60">
          The ledger lives in this browser&apos;s local storage. Clearing site data clears the record. Nothing is sent
          anywhere; the creek is not that kind of nosy.
        </p>
      </div>
    </div>
  );
}
