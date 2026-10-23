export type View = "home" | "tutorial" | "night" | "records" | "bestiary";

export type MinigameId = "lantern" | "well" | "candles" | "crow";

export interface Ward {
  id: MinigameId;
  noun: string;
  title: string;
  station: string;
  action: string;
  game: string;
  blurb: string;
  glyph: string;
  difficulty: string;
  duration: string;
  accent: string;
  how: string;
}

export const WARDS: Ward[] = [
  {
    id: "lantern",
    noun: "The street lantern",
    title: "Relight the street lanterns",
    station: "Old Lamp Post",
    action: "Relight",
    game: "Lantern Rites",
    blurb:
      "Three brass bands guard a drowned wick. Turn each band until its sigil meets the wick, and the lane remembers its light.",
    glyph: "✦",
    difficulty: "Easy",
    duration: "~40 sec",
    accent: "#d9a05b",
    how: "Turn the three brass bands. Every ring is cut into eight faces. Bring all three bright sigils beneath the wick at the top.",
  },
  {
    id: "well",
    noun: "The old well",
    title: "Draw water from the old well",
    station: "Marrow Well",
    action: "Draw",
    game: "The Long Draw",
    blurb:
      "The rope is older than the town and twice as stubborn. Catch the bucket inside the pale band three times before it slips.",
    glyph: "◉",
    difficulty: "Measured",
    duration: "~50 sec",
    accent: "#8eaa9a",
    how: "The crank marker will climb and fall. Press Draw when the bucket is inside the pale band. Land three draws before four misses sink you.",
  },
  {
    id: "candles",
    noun: "The chapel",
    title: "Light the chapel candles",
    station: "Chapel of Saint Orra",
    action: "Light",
    game: "Nine Candles",
    blurb:
      "The altar has nine wicks and a contrary draught. Every candle you touch changes its neighbours. Light every wick at once.",
    glyph: "✧",
    difficulty: "Tricky",
    duration: "~60 sec",
    accent: "#e2b96c",
    how: "Each tap changes a candle and its shared neighbours. It can take a few tries; the altar will remember. Reset if you corner yourself.",
  },
  {
    id: "crow",
    noun: "The scarecrow",
    title: "Mend the scarecrow",
    station: "Briar Patch",
    action: "Mend",
    game: "Crow Call",
    blurb:
      "The crows have learned the scarecrow's old name. Listen to the pattern they answer with — then give it back exactly.",
    glyph: "⌁",
    difficulty: "Hearing",
    duration: "~50 sec",
    accent: "#a6a3c9",
    how: "Watch the runes the crows light, then repeat them in order. The pattern grows by one each round. Four rounds mend the field.",
  },
];

export const getWard = (id: MinigameId) => WARDS.find((w) => w.id === id) as Ward;

export interface Suspect {
  id: string;
  name: string;
  role: string;
  initials: string;
  tell: string;
  quote: string;
  colour: string;
  note: string;
}

export const SUSPECTS: Suspect[] = [
  {
    id: "silas",
    name: "Silas Pike",
    role: "the bell-ringer",
    initials: "SP",
    tell: "Lampblack in the creases of his hands. Only Silas trims the chapel wicks.",
    quote: "The bell rings when the town asks it to. Never before.",
    colour: "#c9854a",
    note: "Keeps the bell rope and the lamp wicks. Walks with a long, uneven stride.",
  },
  {
    id: "mara",
    name: "Mara Voss",
    role: "the well-keeper",
    initials: "MV",
    tell: "A rain-wet hem, though the well-house is dry as tinder.",
    quote: "Water rising in October is a poor omen. Ask the well, not me.",
    colour: "#789a91",
    note: "Has the only key to the pump-house. Sleeps beside the well.",
  },
  {
    id: "tobias",
    name: "Tobias Reed",
    role: "the gravedigger",
    initials: "TR",
    tell: "Grave loam packed beneath his nails, even on chapel days.",
    quote: "I only dig where the ground has been measured. Mostly.",
    colour: "#8d7b63",
    note: "Knows every buried name by heart. Says the new graves were too shallow.",
  },
  {
    id: "hester",
    name: "Hester Finch",
    role: "the seamstress",
    initials: "HF",
    tell: "Green sewing thread, snagged on her sleeve like a small thorn.",
    quote: "A town is a stitch. Pull one loose and the whole hem goes.",
    colour: "#9a8099",
    note: "Repaired every coat in the creek. Has not been seen at the chapel since harvest.",
  },
];

export interface Clue {
  id: string;
  text: string;
  about: string | null;
  kind: "tell" | "trace" | "omen";
}

export const CLUES: Clue[] = [
  {
    id: "lampblack",
    text: "A thumbprint of lampblack on the lantern latch. Only the wick-trimmer works the black oil.",
    about: "silas",
    kind: "tell",
  },
  {
    id: "button",
    text: "A sexton's pewter button, torn loose beside the meeting-house door. The bell-ringer's coat is missing one.",
    about: "silas",
    kind: "trace",
  },
  {
    id: "hem",
    text: "A rain-wet trail of small footprints crosses the lane. No rain has touched Hollow Creek in nine days.",
    about: "mara",
    kind: "tell",
  },
  {
    id: "loam",
    text: "Grave loam scattered up the chapel steps, packed into the shape of a boot heel.",
    about: "tobias",
    kind: "tell",
  },
  {
    id: "thread",
    text: "A length of green sewing thread, snagged on the cage hinge as if someone had tried the lock.",
    about: "hester",
    kind: "tell",
  },
  {
    id: "cold",
    text: "The Hollow leaves a cold smear where it passes. Every soul in the creek could make one.",
    about: null,
    kind: "omen",
  },
  {
    id: "crows",
    text: "The crows will not land where the Hollow has stood. Tonight they circle only the chapel.",
    about: null,
    kind: "omen",
  },
  {
    id: "handed",
    text: "The bell rope was cut left-handed, low and neat. A working hand, unafraid of the dark.",
    about: null,
    kind: "trace",
  },
];

export const TUTORIAL_CHAPTERS = [
  { id: 0, kicker: "Before you walk", title: "The lantern is yours", short: "Lantern" },
  { id: 1, kicker: "Chapter I", title: "Learn the lane", short: "Lane" },
  { id: 2, kicker: "Chapter II", title: "Earn your keep", short: "Ward" },
  { id: 3, kicker: "Chapter III", title: "Read the dark", short: "Body" },
  { id: 4, kicker: "Chapter IV", title: "Call the question", short: "Vote" },
  { id: 5, kicker: "Dawn", title: "A name in the ledger", short: "Dawn" },
];

export interface NightRecord {
  id: string;
  date: string;
  name: string;
  culprit: string;
  accused: string;
  won: boolean;
  wards: number;
  seconds: number;
}

export interface Progress {
  name: string;
  tutorialDone: boolean;
  tutorialStep: number;
  seals: MinigameId[];
  practices: number;
  lanternsLit: number;
  nights: NightRecord[];
}

export const EMPTY_PROGRESS: Progress = {
  name: "Wren",
  tutorialDone: false,
  tutorialStep: 0,
  seals: [],
  practices: 0,
  lanternsLit: 0,
  nights: [],
};

const STORAGE_KEY = "hollowcreek_gloamwing_v1";

export function loadProgress(): Progress {
  if (typeof window === "undefined") return { ...EMPTY_PROGRESS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<Progress>;
    return { ...EMPTY_PROGRESS, ...parsed, nights: parsed.nights ?? [] };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveProgress(progress: Progress) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* a full ledger is still a ledger */
  }
}

export function randomOf<T>(items: T[]): T {
  if (items.length === 0) throw new Error("Cannot draw from an empty hand.");
  const values = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(values);
    return items[values[0] % items.length];
  }
  return items[Math.floor(Math.random() * items.length)];
}

export function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const values = new Uint32Array(1);
    const j =
      typeof crypto !== "undefined" && crypto.getRandomValues
        ? (crypto.getRandomValues(values), values[0] % (i + 1))
        : Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export interface Deal {
  culprit: Suspect;
  victim: string;
  clues: Clue[];
}

/** Deals a culprit uniformly at random, then assembles four clues — one decisive. */
export function dealNight(): Deal {
  const culprit = randomOf(SUSPECTS);
  const tells = CLUES.filter((clue) => clue.about === culprit.id);
  const decisive = randomOf(tells);
  const collected = [decisive];
  // Only the Hollow's own tell names a trade. The rest are omens and traces,
  // so a careful reader can never be punished by two contradictory "explicit" clues.
  const others = shuffled(CLUES.filter((clue) => clue.about === null));
  for (const clue of others) {
    if (collected.length >= 4) break;
    collected.push(clue);
  }
  const victims = ["Pip Marlow, the cooper", "Nell Gray, the milkmaid", "Abel Stone, the tinker"];
  return { culprit, victim: randomOf(victims), clues: shuffled(collected) };
}

export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export const SEALS_META = [
  { id: "lantern" as MinigameId, name: "Keeper of the Wick", mark: "✦" },
  { id: "well" as MinigameId, name: "Rope and Patience", mark: "◉" },
  { id: "candles" as MinigameId, name: "The Lit Altar", mark: "✧" },
  { id: "crow" as MinigameId, name: "Crow's Grammar", mark: "⌁" },
];

export type Phase = "setup" | "street" | "report" | "accuse" | "dawn";
