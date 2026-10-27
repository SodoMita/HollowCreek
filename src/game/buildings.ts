// The road remains one continuous coordinate space. Houses occupy new ground
// beyond the original 0–4200 town; their thresholds never move a player.
export const WORLD_MIN = -1500;
export const WORLD_MAX = 5750;
export const DOOR_REACH = 58;
const KEY_REACH = 44;

export interface Building {
  id: string;
  name: string;
  keyName: string;
  x: number;
  width: number;
  side: -1 | 1; // doorway on the left or right gable, seen in profile
  keySpawn: number;
}

export const BUILDINGS: Building[] = [
  { id: "tollhouse", name: "Tollhouse", keyName: "brass tollhouse key", x: -470, width: 300, side: 1, keySpawn: -190 },
  { id: "orchard", name: "Orchard House", keyName: "iron orchard key", x: -1100, width: 330, side: 1, keySpawn: -840 },
  { id: "foreman", name: "Foreman's Office", keyName: "steel office key", x: 4700, width: 330, side: -1, keySpawn: 4440 },
  { id: "quarry", name: "Quarry Cottage", keyName: "forged cottage key", x: 5350, width: 340, side: -1, keySpawn: 5070 },
];

export interface DoorState {
  id: string;
  locked: boolean;
  open: boolean;
  keyX: number | null;
  holder: string | null;
}

export const doorX = (b: Building) => b.x + b.side * (b.width / 2 - 18);
export const clampWorld = (x: number, inset = 30) => Math.max(WORLD_MIN + inset, Math.min(WORLD_MAX - inset, x));
export const newDoors = (): DoorState[] => BUILDINGS.map((b) => ({ id: b.id, locked: true, open: false, keyX: b.keySpawn, holder: null }));

/** Mutates only the authoritative room's door states (or a cloned tutorial copy). */
export function interactWithBuilding(doors: DoorState[], playerId: string, x: number, inside: string | null, action: "interact" | "lock") {
  if (action === "interact" && !inside) {
    const loose = doors.filter((d) => d.keyX !== null && Math.abs(d.keyX - x) <= KEY_REACH)
      .sort((a, b) => Math.abs(a.keyX! - x) - Math.abs(b.keyX! - x))[0];
    if (loose) {
      loose.keyX = null;
      loose.holder = playerId;
      return { handled: true, message: `You found the ${BUILDINGS.find((b) => b.id === loose.id)!.keyName}.` };
    }
  }
  const building = BUILDINGS.filter((b) => (!inside || inside === b.id) && Math.abs(doorX(b) - x) <= DOOR_REACH)
    .sort((a, b) => Math.abs(doorX(a) - x) - Math.abs(doorX(b) - x))[0];
  if (!building) return { handled: false };
  const door = doors.find((d) => d.id === building.id);
  if (!door) return { handled: false };
  const ownsKey = door.holder === playerId;
  if (action === "lock") {
    if (!ownsKey) return { handled: true, error: `This lock needs the ${building.keyName}.` };
    door.locked = !door.locked;
    if (door.locked) door.open = false;
    return { handled: true, message: `${building.name} is ${door.locked ? "locked" : "unlocked"}.` };
  }
  if (door.locked) {
    // A person inside can always release the latch to leave, even if locked outside.
    if (!ownsKey && inside !== building.id) return { handled: true, error: `${building.name} is locked. Find its ${building.keyName}.` };
    door.locked = false;
    door.open = true;
    return { handled: true, message: `${building.name} opens. Walk through the doorway.` };
  }
  door.open = !door.open;
  return { handled: true, message: `${building.name} door ${door.open ? "opens" : "closes"}.` };
}

/** Crossing changes only the layer, never x. A closed door only bounds occupants;
 * pedestrians on the road can still pass a closed house on the foreground path. */
export function walkThroughBuildings(x: number, nextX: number, inside: string | null, doors: DoorState[]) {
  let next = clampWorld(nextX);
  if (inside) {
    const b = BUILDINGS.find((item) => item.id === inside);
    const d = doors.find((item) => item.id === inside);
    if (!b || !d) return { x: next, inside: null };
    const threshold = doorX(b);
    const farWall = b.x - b.side * (b.width / 2 - 25);
    next = b.side === 1 ? Math.max(farWall, next) : Math.min(farWall, next);
    if ((next - threshold) * b.side >= 0) {
      if (d.open) return { x: next, inside: null };
      next = threshold - b.side * 0.01;
    }
    return { x: next, inside };
  }
  for (const b of BUILDINGS) {
    const d = doors.find((item) => item.id === b.id);
    const threshold = doorX(b);
    if (d?.open && (x - threshold) * b.side >= 0 && (next - threshold) * b.side < 0) {
      return { x: next, inside: b.id };
    }
  }
  return { x: next, inside: null };
}

export function dropBuildingKeys(doors: DoorState[], playerId: string, x: number, inside: string | null) {
  for (const d of doors) {
    if (d.holder !== playerId) continue;
    const b = BUILDINGS.find((item) => item.id === inside);
    d.holder = null;
    d.keyX = clampWorld(b ? doorX(b) + b.side * 50 : x);
  }
}

export function buildingHint(doors: DoorState[], playerId: string, x: number, inside: string | null): string | null {
  if (!inside) {
    const key = doors.find((d) => d.keyX !== null && Math.abs(d.keyX - x) <= KEY_REACH);
    if (key) return `E — take ${BUILDINGS.find((b) => b.id === key.id)!.keyName}`;
  }
  const b = BUILDINGS.find((item) => (!inside || inside === item.id) && Math.abs(doorX(item) - x) <= DOOR_REACH);
  if (!b) return inside ? `Inside ${BUILDINGS.find((item) => item.id === inside)?.name ?? "the house"} — walk back to the door` : null;
  const d = doors.find((item) => item.id === b.id);
  if (!d) return null;
  if (d.locked && d.holder !== playerId && inside !== b.id) return `${b.name} locked — find its key`;
  return `E — ${d.open ? "close" : d.locked ? "unlock & open" : "open"} door${d.holder === playerId ? " · L — lock" : ""}`;
}
