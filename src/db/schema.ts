import { pgTable, serial, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  hostName: text("host_name").notNull().default("host"),
  phase: text("phase").notNull().default("lobby"),
  round: integer("round").notNull().default(0),
  winner: text("winner"),
  endText: text("end_text"),
  settings: jsonb("settings").$type<{ impostors: number }>().notNull().default({ impostors: 1 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const gamePlayers = pgTable(
  "game_players",
  {

    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    playerId: text("player_id").notNull().unique(),
    name: text("name").notNull(),
    colorName: text("color_name").notNull().default("Rust"),
    role: text("role"),
    alive: boolean("alive").notNull().default(true),
    caged: boolean("caged").notNull().default(false),
    tasksDone: integer("tasks_done").notNull().default(0),
    kills: integer("kills").notNull().default(0),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("game_players_code_idx").on(t.code)],
);

/** Every authoritative action a player takes is recorded here. */
export const actionLog = pgTable(
  "action_log",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    playerId: text("player_id").notNull(),
    playerName: text("player_name").notNull().default("?"),
    type: text("type").notNull(),
    x: integer("x"),
    round: integer("round").notNull().default(0),
    secret: boolean("secret").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("action_log_code_idx").on(t.code)],
);

export const chatLog = pgTable(
  "chat_log",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    playerId: text("player_id").notNull(),
    name: text("name").notNull(),
    text: text("text").notNull(),
    ghost: boolean("ghost").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_log_code_idx").on(t.code)],
);
