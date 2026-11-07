import {
  BELL_X,
  CAGE_UNLOCK_RANGE,
  CAGE_XS,
  CART_PUSH_RANGE,
  INTERACT_RANGE,
  type Snapshot,
  type TaskView,
} from "@/game/types";
import { buildingHint, type DoorState } from "@/game/buildings";
import { wardView, type WardPuzzle } from "@/game/wards";
import type { TutorialFrame, TutorialVisit } from "./tutorial-types";

/** Everything the simulated snapshot reads from the tutorial's live state. */
export interface TutorialSnapshotInputs {
  tasks: TaskView[];
  activeWardId: string | null;
  timeVisit: TutorialVisit | null;
  timepieceX: number | null;
  hasTimepiece: boolean;
  actionNotice: { text: string; until: number } | null;
  doors: DoorState[];
  inside: string | null;
  playerX: number;
  cartX: number;
  hasKey: boolean;
  cagedNeighbor: boolean;
  keyX: number | null;
  hasSupply: boolean;
  stamina: number;
  exhausted: boolean;
  myVote: string | null;
  facing: number;
  moving: boolean;
  supplyDrops: number[];
  cartPushers: number;
  meetingActive: boolean;
  bellAt: number;
  blackoutUntil: number;
  danger: number;
}

/** Builds the Snapshot the canvas renderer draws, from the tutorial's simulated state.
 *  Pure apart from reading the clock: no refs are touched except the two passed in. */
export function buildTutorialSnapshot(
  s: TutorialSnapshotInputs,
  puzzles: Map<string, WardPuzzle>,
  history: TutorialFrame[],
): Snapshot {
  const {
    tasks, activeWardId, timeVisit, timepieceX, hasTimepiece, actionNotice, doors, inside,
    playerX, cartX, hasKey, cagedNeighbor, keyX, hasSupply, stamina, exhausted, myVote,
    facing, moving, supplyDrops, cartPushers, meetingActive, bellAt, blackoutUntil, danger,
  } = s;
    const activeTask = tasks.find((t) => t.id === activeWardId);
    const pz = activeTask ? puzzles.get(activeTask.id) : null;
    const mini = activeTask && pz ? wardView(activeTask.id, activeTask.name, pz) : null;

    let hint: string | null = null;
    const nearbyWard = tasks.find((t) => !t.done && (t.inside ?? null) === inside && Math.abs(t.x - playerX) < INTERACT_RANGE);
    const atCart = !inside && Math.abs(cartX - playerX) < INTERACT_RANGE;
    const nearCart = !inside && Math.abs(cartX - playerX) <= CART_PUSH_RANGE;

    if (nearbyWard && nearbyWard.delivered) hint = "E — open repair puzzle";
    else if (nearbyWard && !nearbyWard.delivered && hasSupply) hint = "E — deliver kit to ward";
    else if (hasKey && cagedNeighbor && Math.abs(1940 - playerX) < CAGE_UNLOCK_RANGE) hint = "E — unlock Nils's cage";
    else if (keyX !== null && Math.abs(keyX - playerX) < INTERACT_RANGE) hint = "E — take the iron key";
    else if (!hasSupply && atCart) hint = "E — take kit · hold Shift+A/D to push";
    else if (nearCart && !hasSupply) hint = "Hold Shift + A/D to push cart";
    else if (hasSupply) hint = "G — drop carried kit";
    else if (Math.abs(BELL_X - playerX) < INTERACT_RANGE) hint = "E — ring the chapel bell";
    hint = buildingHint(doors, "me", playerX, inside) ?? hint;
    if (!inside && timepieceX !== null && Math.abs(timepieceX - playerX) < 55) hint = "E — take the timepiece";
    else if (hasTimepiece && !hint) hint = "M — choose a moment in the past";

    const result: Snapshot = {
      code: "TUTOR",
      phase: "playing",
      round: 1,
      now: Date.now(),
      self: {
        id: "me",
        role: "crew",
        alive: true,
        caged: false,
        hasKey,
        hasSupply,
        doorKeys: doors.filter((d) => d.holder === "me").map((d) => d.id),
        hasTimepiece,
        bellUsed: false,
        killCooldownMs: 0,
        canKill: false,
        stamina,
        exhausted,
        blackoutCooldownMs: 0,
        canBlackout: false,
        sabotageCooldownMs: 0,
        canSabotage: true,
        teammates: [],
        myVote,
      },
      players: [
        {
          id: "me",
          name: "You",
          color: "#3a7ca5",
          x: playerX,
          facing,
          moving,
          alive: true,
          caged: false,
          hasKey,
          hasSupply,
          inside,
          hasTimepiece,
          doorKeys: doors.filter((door) => door.holder === "me").map((door) => door.id),
          action: actionNotice && actionNotice.until > Date.now() ? actionNotice : null,
          voted: myVote !== null,
          bubble: null,
          isHost: true,
        },
        {
          id: "nils",
          name: "Nils",
          color: "#6b8e23",
          x: cagedNeighbor ? CAGE_XS[0] : CAGE_XS[0] + 55,
          facing: 1,
          moving: false,
          alive: true,
          caged: cagedNeighbor,
          hasKey: false,
          hasSupply: false,
          voted: false,
          bubble: cagedNeighbor ? { text: "The key is west of the square! Unlock me!", until: Date.now() + 5000 } : null,
          isHost: false,
        },
        {
          id: "silas",
          name: "Silas (Guide)",
          color: "#e0a52a",
          x: Math.max(90, cartX - 60),
          facing: 1,
          moving: false,
          alive: true,
          caged: false,
          hasKey: false,
          hasSupply: false,
          voted: false,
          bubble: null,
          isHost: false,
        },
      ],
      bodies: [],
      doors,
      keyX,
      timepieceX,
      supplyDrops,
      cartX,
      cartPushers,
      cages: [
        { x: CAGE_XS[0], occupant: cagedNeighbor ? "nils" : null },
        { x: CAGE_XS[1], occupant: null },
        { x: CAGE_XS[2], occupant: null },
        { x: CAGE_XS[3], occupant: null },
        { x: CAGE_XS[4], occupant: null },
        { x: CAGE_XS[5], occupant: null },
      ],
      tasks,
      taskBar: {
        done: tasks.filter((t) => t.done).length,
        total: tasks.length,
      },
      meeting: meetingActive
        ? {
            endsAt: Date.now() + 30000,
            reason: "Silas called a practice assembly in the square",
            inArea: Math.abs(playerX - BELL_X) < 300,
          }
        : null,
      feed: [
        { text: "Welcome to the school of Hollow Creek. Follow the chapter guide above.", at: Date.now() - 10000 },
      ],
      winner: null,
      winReason: null,
      results: null,
      bellAt,
      flickerAt: 0,
      blackoutUntil,
      danger,
      visionRadius: 420,
      hint,
      abilityLabel: "Ring Bell",
      abilityReady: Math.abs(playerX - BELL_X) < INTERACT_RANGE + 20,
      hostId: "me",
      playerCount: 3,
      nightT: 0.3,
      minigame: mini,
    };
    const first = history[0], last = history.at(-1);
    if (timeVisit) {
      const cursor = Math.min(Date.now(), timeVisit.originAt + Date.now() - timeVisit.startedAt);
      const historical = [...history].reverse().find((frame) => frame.at <= cursor) ?? first;
      if (historical) {
        const me = result.players[0];
        const shift = Date.now() - cursor;
        result.players = [me, ...historical.snapshot.players.map((player) => ({ ...player, id: `echo:${player.id}`, echo: true, isHost: false, bubble: null,
          action: player.action ? { ...player.action, until: player.action.until + shift } : null }))];
        result.cages = historical.snapshot.cages.map((cage) => ({ ...cage, occupant: cage.occupant ? `echo:${cage.occupant}` : null }));
      }
      result.time = { mode: "past", earliest: first?.at ?? timeVisit.originAt, latest: last?.at ?? timeVisit.originAt, cursor, endsAt: timeVisit.endsAt };
    } else result.time = { mode: "present", earliest: first?.at ?? Date.now(), latest: last?.at ?? Date.now() };
    return result;
}
