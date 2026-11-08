import type { DoorState } from "@/game/buildings";
import type { WardPuzzle } from "@/game/wards";
import type { Snapshot, TaskView } from "@/game/types";

/** Tutorial time-travel bookkeeping: the visit window, recorded frames, and the parked future. */
export type TutorialVisit = { originAt: number; startedAt: number; endsAt: number };
export type TutorialFrame = { at: number; snapshot: Snapshot };
export type TutorialFuture = {
  tasks: TaskView[]; doors: DoorState[]; keyX: number | null; hasKey: boolean; hasSupply: boolean;
  supplyDrops: number[]; cartX: number; cagedNeighbor: boolean; puzzles: Map<string, WardPuzzle>;
  baselineTasks: TaskView[]; baselineDoors: DoorState[]; baselineCaged: boolean; baselineKeyX: number | null;
};
