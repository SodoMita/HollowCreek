// Chapter script for the singleplayer school: titles, instructions and guide notes.

export interface Chapter {
  id: number;
  title: string;
  summary: string;
  instruction: string;
  guideNote: string;
}

export const CHAPTERS: Chapter[] = [
  {
    id: 1,
    title: "Chapter I: The Autumn Lane",
    summary: "Movement, Facing & Vigor",
    instruction: "Walk along the street with A / D or ◀ ▶. Run a few steps, then stand still to feel your vigor return.",
    guideNote:
      "Hollow Creek is one long autumn road. Walking is easy, but deeds drain your vigor. When spent, you must stand still and catch your breath.",
  },
  {
    id: 2,
    title: "Chapter II: The Single Supply Cart",
    summary: "Cooperative Pushing & Hauling",
    instruction: "Walk to the heavy wooden cart at x=900. Hold Shift + A/D to push it. Then press E to take a repair kit.",
    guideNote:
      "The nine street wards start in ruins; houses hold smaller ready-to-repair jobs. The town shares one heavy cart of timber and iron. Hauling a kit slows you down and drains vigor. Press G to drop a kit if danger nears.",
  },
  {
    id: 3,
    title: "Chapter III: Mending a Ruined Ward",
    summary: "Delivery & The Puzzle Workbench",
    instruction: "Carry your kit to the Well (x=680) and press E to deliver it. Then press E again to open the repair workbench and solve the winch puzzle!",
    guideNote:
      "Wards are not key-holds. Each structure has its own mechanical challenge. Once supplied, open the board and solve it to restore the ward.",
  },
  {
    id: 4,
    title: "Chapter IV: The Condemned & The Key",
    summary: "Iron Cages & Realistic Depth",
    instruction: "Walk east to x=1550, pick up the iron key with E. Walk to the cage at x=1940 and unlock Nils. Notice he steps outside the bars!",
    guideNote:
      "Free souls walk in front of the iron bars; only prisoners stand behind them. Caging suspects does NOT end the night — you still have to mend the wards!",
  },
  {
    id: 5,
    title: "Chapter V: The Square & The Bell",
    summary: "Meetings, Accusations & Votes",
    instruction: "Walk into the town square (x=2200) and press E beside the bell tower to toll the bell, then cast your practice verdict.",
    guideNote:
      "When the bell tolls, all living souls must walk into the square. Vote to cage a suspect, free a prisoner, or abstain.",
  },
  {
    id: 6,
    title: "Chapter VI: The Hollow in the Dark",
    summary: "Survival, Dread & Sabotage",
    instruction: "Feel the darkness fall: lanterns snuff out and proximity dread beats in your chest. The Hollow can strike and ruin repaired wards (R).",
    guideNote:
      "One or two among you wear human faces. When dread rises, find a lantern, stick together, and finish every ward before dawn.",
  },
  {
    id: 7, title: "Chapter VII: The Houses Beyond", summary: "Separate Keys & Side Doors",
    instruction: "Walk west beyond the harvest shed. Find the tollhouse key, open its side door with E, and walk inside. Stand by the hearth and press E to repair it.",
    guideNote: "Each house has its own key and an indoor job with supplies on site. E closes a door without locking it; L locks or unlocks with its matching key.",
  },
  {
    id: 8, title: "Chapter VIII: A Minute Borrowed", summary: "The Timepiece",
    instruction: "Find the timepiece east of the cart at x=1260. Take it with E, then press M and choose a recorded moment.",
    guideNote: "Solo practice shows your own recorded movement. In multiplayer, recorded player commands are replayed against changes in the past.",
  },
];
