import { pgTable, serial, text, jsonb, timestamp, integer, index } from "drizzle-orm/pg-core";

/** Every player action is recorded here — the town chronicle. */
export const gameEvents = pgTable(
  "game_events",
  {
    id: serial("id").primaryKey(),
    roomCode: text("room_code").notNull(),
    playerId: text("player_id"),
    playerName: text("player_name"),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("game_events_room_idx").on(t.roomCode, t.id)]
);

/** A town outlives the process, so the same group can come back to the same code. */
export const roomRows = pgTable("rooms", {
  code: text("code").primaryKey(),
  phase: text("phase").notNull().default("lobby"),
  round: integer("round").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** The roster of a town — a seat is re-adopted by the same browser or same name. */
export const roomPlayers = pgTable(
  "room_players",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("room_players_code_idx").on(t.code)]
);

/** Lifetime ledger of every soul that ever walked into a town. */
export const playerStats = pgTable("player_stats", {
  playerId: text("player_id").primaryKey(),
  name: text("name").notNull(),
  games: integer("games").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  kills: integer("kills").notNull().default(0),
  deaths: integer("deaths").notNull().default(0),
  tasksDone: integer("tasks_done").notNull().default(0),
  chatChars: integer("chat_chars").notNull().default(0),
  cagings: integer("cagings").notNull().default(0),
  reports: integer("reports").notNull().default(0),
  unlocks: integer("unlocks").notNull().default(0),
  blackouts: integer("blackouts").notNull().default(0),
  bells: integer("bells").notNull().default(0),
  playtimeSec: integer("playtime_sec").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});