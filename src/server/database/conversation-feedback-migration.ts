import type { DatabaseSync } from "node:sqlite";

/** Adds durable end-of-session state and normalized coaching feedback tables. */
export function createConversationFeedbackSchema(database: DatabaseSync): void {
  createFeedbackSchema(database, "");
}

/** Equivalent migration for the historical single-file database. */
export function createCombinedConversationFeedbackSchema(
  database: DatabaseSync,
): void {
  createFeedbackSchema(database, "conversation_");
}

function createFeedbackSchema(
  database: DatabaseSync,
  prefix: "" | "conversation_",
): void {
  database.exec(`
    ALTER TABLE ${prefix}sessions
      ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'ended'));
    ALTER TABLE ${prefix}sessions
      ADD COLUMN ended_at TEXT;

    CREATE TABLE ${prefix}feedback_reports (
      conversation_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      locale TEXT NOT NULL CHECK (locale IN ('en', 'zh')),
      overall_assessment TEXT CHECK (
        overall_assessment IS NULL OR length(overall_assessment) <= 2000
      ),
      overall_score INTEGER CHECK (
        overall_score IS NULL OR overall_score BETWEEN 0 AND 100
      ),
      model TEXT CHECK (model IS NULL OR length(trim(model)) BETWEEN 1 AND 200),
      prompt_version TEXT NOT NULL
        CHECK (length(trim(prompt_version)) BETWEEN 1 AND 100),
      error_code TEXT CHECK (
        error_code IS NULL OR length(trim(error_code)) BETWEEN 1 AND 100
      ),
      error_message TEXT CHECK (
        error_message IS NULL OR length(error_message) <= 2000
      ),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES ${prefix}sessions(id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE ${prefix}feedback_strengths (
      conversation_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000),
      PRIMARY KEY (conversation_id, position),
      FOREIGN KEY (conversation_id) REFERENCES ${prefix}feedback_reports(conversation_id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE ${prefix}feedback_improvement_areas (
      conversation_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 1000),
      PRIMARY KEY (conversation_id, position),
      FOREIGN KEY (conversation_id) REFERENCES ${prefix}feedback_reports(conversation_id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE ${prefix}feedback_coaching_tips (
      conversation_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
      advice TEXT NOT NULL CHECK (length(trim(advice)) BETWEEN 1 AND 1500),
      PRIMARY KEY (conversation_id, position),
      FOREIGN KEY (conversation_id) REFERENCES ${prefix}feedback_reports(conversation_id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE ${prefix}feedback_criterion_scores (
      conversation_id INTEGER NOT NULL,
      criterion_position INTEGER NOT NULL CHECK (criterion_position >= 0),
      score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
      rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 1500),
      PRIMARY KEY (conversation_id, criterion_position),
      FOREIGN KEY (conversation_id) REFERENCES ${prefix}feedback_reports(conversation_id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id, criterion_position)
        REFERENCES ${prefix}scenario_scoring_criteria(conversation_id, position)
        ON DELETE CASCADE
    ) STRICT;

    CREATE UNIQUE INDEX ${prefix}messages_feedback_owner_idx
      ON ${prefix}messages(conversation_id, id);

    CREATE TABLE ${prefix}feedback_moments (
      conversation_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      message_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('strength', 'improvement')),
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
      assessment TEXT NOT NULL CHECK (length(trim(assessment)) BETWEEN 1 AND 1500),
      suggested_approach TEXT NOT NULL DEFAULT ''
        CHECK (length(suggested_approach) <= 1500),
      PRIMARY KEY (conversation_id, position),
      FOREIGN KEY (conversation_id) REFERENCES ${prefix}feedback_reports(conversation_id) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id, message_id)
        REFERENCES ${prefix}messages(conversation_id, id)
        ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX ${prefix}feedback_reports_status_idx
      ON ${prefix}feedback_reports(status, updated_at);
    CREATE INDEX ${prefix}feedback_moments_message_id_idx
      ON ${prefix}feedback_moments(message_id);
  `);
}
