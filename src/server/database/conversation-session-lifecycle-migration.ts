import type { DatabaseSync } from "node:sqlite";

/** Adds pause-aware active-duration accounting to the split conversation DB. */
export function addConversationSessionLifecycleColumns(
  database: DatabaseSync,
): void {
  addSessionLifecycleColumns(database, "");
}

/** Equivalent migration for the historical single-file database. */
export function addCombinedConversationSessionLifecycleColumns(
  database: DatabaseSync,
): void {
  addSessionLifecycleColumns(database, "conversation_");
}

function addSessionLifecycleColumns(
  database: DatabaseSync,
  prefix: "" | "conversation_",
): void {
  database.exec(`
    ALTER TABLE ${prefix}sessions ADD COLUMN paused_at TEXT;
    ALTER TABLE ${prefix}sessions
      ADD COLUMN active_duration_ms INTEGER NOT NULL DEFAULT 0
      CHECK (active_duration_ms >= 0);
    ALTER TABLE ${prefix}sessions ADD COLUMN active_started_at TEXT;

    UPDATE ${prefix}sessions
    SET active_duration_ms = CASE
          WHEN status = 'ended' AND ended_at IS NOT NULL THEN
            MAX(
              0,
              CAST(ROUND(
                (julianday(ended_at) - julianday(created_at)) * 86400000
              ) AS INTEGER)
            )
          ELSE 0
        END,
        paused_at = CASE
          WHEN status = 'active' THEN updated_at
          ELSE NULL
        END,
        active_started_at = NULL;
  `);
}
