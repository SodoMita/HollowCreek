// Balance knobs for HOLLOW CREEK — every gameplay number in one commented block.
// types.ts re-exports these, so existing `from "./types"` imports keep working.
// Game state uses NO floats for positions: world coordinates are integers (see ix).

// --- Movement (px per second) ---
export const SPEED = 190; // crew on foot
export const GHOST_SPEED = 260; // the dead drift faster
export const CARRY_SPEED = 122; // carrying a repair kit
export const CARRY_VIGOR_DRAIN = 0.045; // extra vigor drain per second while carrying

// --- Tick & time ---
export const TICK_RATE = 60; // authoritative server ticks per second
export const TICK_MS = 1000 / TICK_RATE; // one tick ≈ 16.7 ms; a state frame leaves right after each tick
export const JOURNAL_CAP = 90 * TICK_RATE; // tick/presence entries kept for replay: ~90 s of ticks whatever the rate
export const NIGHT_LENGTH_MS = 40 * 60_000; // one full night; drives the sky cycle (0=dusk, 1=deep night)
export const TIME_VISIT_MS = 60_000; // how long a time-travel visit lasts
export const HISTORY_SAMPLE_MS = 500; // snapshot sampling interval for the recorded night
export const MEETING_MS = 45000; // discussion phase length
export const BUBBLE_MS = 6000; // how long a chat bubble stays on screen

// --- The Hollow (killer) ---
export const KILL_RANGE = 75;
export const KILL_COOLDOWN_MS = 18000;
export const SABOTAGE_COOLDOWN_MS = 26000;
export const SABOTAGE_VIGOR_COST = 0.22;
export const BLACKOUT_MS = 9000;
export const BLACKOUT_CD_MS = 30000;

// --- Interaction ---
export const INTERACT_RANGE = 80;
export const NOTE_REACH = 90; // stand this close to a wall/tree to pin or read a page
export const NOTE_TEXT_MAX = 200;
export const CAGE_UNLOCK_RANGE = 125;

// --- The meeting bell & square ---
export const MEETING_FROM = 1880;
export const MEETING_TO = 2520;
export const BELL_X = 2200;
export const TASKS_PER_CREW = 4;
export const CELL_HALF = 30; // cage cell half-width

// --- Vision radii (px) ---
export const VISION_CREW = 420;
export const VISION_HOLLOW = 620;
export const VISION_BLACKOUT = 190;
// Culling reach = vision + this. The darkness overlay fades to opaque only at
// its rim, so a figure may be *partly* drawn out to the rim; and a wide window
// shows more world than the vision circle covers. Anything inside this reach is
// sent, everything outside is still invisible under the overlay.
export const VISION_MARGIN = 220;

// --- Vigor (stamina): work and deeds drain it; idling restores it ---
export const STAMINA_WORK_DRAIN = 0.10; // per second while working a ward
export const STAMINA_IDLE_REGEN = 0.09; // per second while idle
export const STAMINA_SLOW_THRESHOLD = 0.3; // below this, work slows linearly
export const STAMINA_KILL_COST = 0.35;
export const STAMINA_BLACKOUT_COST = 0.3;
export const STAMINA_BELL_COST = 0.15;
export const STAMINA_UNLOCK_COST = 0.1;

// --- The supply cart (one cart, pushed together; world units per second) ---
export const SUPPLY_CART_START = 900;
export const CART_PUSH_RANGE = 105;
export const CART_SOLO_SPEED = 38;
export const CART_HELPER_BONUS = 26;
export const CART_MAX_SPEED = 116;

// --- The timepiece ---
export const TIMEPIECE_X = 1260;
