import { pgTable, serial, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

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