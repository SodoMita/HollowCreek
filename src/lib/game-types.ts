// Types shared between the authoritative server and the client renderer.

export type Phase = "lobby" | "playing" | "meeting" | "ended";
export type MeetingStage = "travel" | "discuss" | "vote" | "reveal";
export type Role = "crew" | "impostor";

export type TaskState = {
  id: string;
  name: string;
  icon: string;
  where: string;
  x: number;
  done: boolean;
  progress: number; // 0..1
  active: boolean;
};

export type PublicPlayer = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  x: number;
  facing: 1 | -1;
  moving: boolean;
  alive: boolean;
  caged: boolean;
  ghost: boolean;
  isYou: boolean;
  isHost: boolean;
  /** present when the viewer may know it (self, ended game, or dead viewer) */
  role?: Role;
  busy: number; // 0..1 task progress if visible
  hasKey: boolean;
  lantern: boolean;
  connected: boolean;
};

export type PublicBody = {
  id: string;
  name: string;
  color: string;
  x: number;
  found: boolean;
};

export type Bubble = {
  id: number;
  playerId: string;
  name: string;
  color: string;
  text: string;
  ghost: boolean;
  at: number;
};

export type ChatLine = {
  id: number;
  name: string;
  color: string;
  text: string;
  ghost: boolean;
  at: number;
};

export type LogLine = {
  id: number;
  at: number;
  text: string;
  kind: "info" | "task" | "kill" | "meeting" | "cage" | "end";
};

export type MeetingState = {
  stage: MeetingStage;
  endsAt: number;
  calledBy: string | null;
  calledByName: string | null;
  reason: string;
  options: { id: string; name: string; color: string; caged: boolean; dead: boolean }[];
  votes: Record<string, string>; // voterId -> targetId | 'skip'
  myVote: string | null;
  outcome: string | null;
};

export type You = {
  id: string;
  name: string;
  color: string;
  colorName: string;
  role: Role | null;
  alive: boolean;
  caged: boolean;
  ghost: boolean;
  isHost: boolean;
  x: number;
  facing: 1 | -1;
  vision: number;
  tasks: TaskState[];
  tasksDone: number;
  tasksTotal: number;
  hasKey: boolean;
  connected: boolean;
  blackoutCooldownMs: number;
  prompt: { kind: "task" | "cage" | "report"; label: string; sub?: string; progress: number } | null;
  cooldowns: {
    kill: number;
    snuff: number;
    hedge: number;
    flare: number;
  };
  dark: boolean;
};

export type Snapshot = {
  t: number;
  now: number;
  code: string;
  phase: Phase;
  round: number;
  phaseEndsAt: number | null;
  you: You;
  players: PublicPlayer[];
  bodies: PublicBody[];
  cages: { x: number; occupant: string | null }[];
  keyX: number | null;
  keyTakenUntil: number | null;
  /** server-computed 0..1 dread: how close the nearest one of them is */
  danger: number;
  /** absolute ms when the snuffed lanterns come back (0 if lit) */
  blackoutUntil: number;
  taskProgress: number;
  aliveCrew: number;
  aliveImpostors: number;
  totalImpostors: number;
  meeting: MeetingState | null;
  bubbles: Bubble[];
  chat: ChatLine[];
  log: LogLine[];
  events: EngineEvent[];
  winner: Role | null;
  endText: string | null;
};

export type EventPayload =
  | { type: "bell" }
  | { type: "kill"; x: number }
  | { type: "report"; x: number }
  | { type: "snuff" }
  | { type: "flare"; x: number }
  | { type: "cage"; x: number }
  | { type: "free"; x: number }
  | { type: "end"; winner: Role }
  | { type: "task"; x: number }
  | { type: "start" };

export type EngineEvent = { id: number } & EventPayload;

export type InputAction =
  | { type: "move"; dir: -1 | 0 | 1 }
  | { type: "face"; dir: -1 | 1 }
  | { type: "interactStart" }
  | { type: "interactStop" }
  | { type: "report" }
  | { type: "kill" }
  | { type: "snuff" }
  | { type: "hedge"; dir: -1 | 1 }
  | { type: "flare" }
  | { type: "say"; text: string }
  | { type: "vote"; target: string }
  | { type: "start" }
  | { type: "leave" };
