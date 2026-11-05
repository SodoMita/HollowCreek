CREATE TABLE "game_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_code" text NOT NULL,
	"player_id" text,
	"player_name" text,
	"type" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"player_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"kills" integer DEFAULT 0 NOT NULL,
	"deaths" integer DEFAULT 0 NOT NULL,
	"tasks_done" integer DEFAULT 0 NOT NULL,
	"chat_chars" integer DEFAULT 0 NOT NULL,
	"cagings" integer DEFAULT 0 NOT NULL,
	"reports" integer DEFAULT 0 NOT NULL,
	"unlocks" integer DEFAULT 0 NOT NULL,
	"blackouts" integer DEFAULT 0 NOT NULL,
	"bells" integer DEFAULT 0 NOT NULL,
	"playtime_sec" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_players" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"code" text PRIMARY KEY NOT NULL,
	"phase" text DEFAULT 'lobby' NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "game_events_room_idx" ON "game_events" USING btree ("room_code","id");--> statement-breakpoint
CREATE INDEX "room_players_code_idx" ON "room_players" USING btree ("code");