import { existsSync, rmSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { ApplicationDatabase } from "./database";
import { ALL_PRESET_TABLES } from "./preset-storage";
import {
  CATALOG_DATABASE_MIGRATIONS,
  CONVERSATION_DATABASE_MIGRATIONS,
  LEGACY_SPLIT_SOURCE_KEY,
} from "./split-database-migrations";

interface TableCopyMapping {
  source: string;
  target: string;
}

const CATALOG_TABLES: readonly string[] = [
  ...ALL_PRESET_TABLES.map(({ table }) => table),
  "personas",
  "persona_personality_traits",
  "persona_motivations",
  "persona_concerns",
  "scenarios",
  "scenario_training_goals",
  "scenario_skill_focuses",
  "scenario_success_criteria",
  "scenario_personas",
];

const CONVERSATION_TABLES: readonly TableCopyMapping[] = [
  { source: "conversation_sessions", target: "sessions" },
  { source: "conversation_persona_snapshots", target: "persona_snapshots" },
  { source: "conversation_scenario_snapshots", target: "scenario_snapshots" },
  {
    source: "conversation_scenario_scoring_criteria",
    target: "scenario_scoring_criteria",
  },
  { source: "conversation_scenario_personas", target: "scenario_personas" },
  { source: "conversation_messages", target: "messages" },
  { source: "conversation_feedback_reports", target: "feedback_reports" },
  { source: "conversation_feedback_strengths", target: "feedback_strengths" },
  {
    source: "conversation_feedback_improvement_areas",
    target: "feedback_improvement_areas",
  },
  {
    source: "conversation_feedback_coaching_tips",
    target: "feedback_coaching_tips",
  },
  {
    source: "conversation_feedback_criterion_scores",
    target: "feedback_criterion_scores",
  },
  { source: "conversation_feedback_moments", target: "feedback_moments" },
] as const;

export interface SplitLegacyDatabaseOptions {
  legacyPath: string;
  catalogPath: string;
  conversationPath: string;
}

export interface SplitLegacyDatabaseResult {
  legacyPath: string;
  catalogPath: string;
  conversationPath: string;
  catalogRowsCopied: Record<string, number>;
  conversationRowsCopied: Record<string, number>;
}

/**
 * Copies the normalized version-19 one-file schema into two fresh databases.
 * Existing target files are never merged or overwritten.
 */
export function splitLegacyDatabase(
  options: SplitLegacyDatabaseOptions,
): SplitLegacyDatabaseResult {
  const legacy = new ApplicationDatabase({ path: options.legacyPath });
  const catalog = new ApplicationDatabase({
    path: options.catalogPath,
    migrations: CATALOG_DATABASE_MIGRATIONS,
  });
  const conversations = new ApplicationDatabase({
    path: options.conversationPath,
    migrations: CONVERSATION_DATABASE_MIGRATIONS,
  });
  const paths = [legacy.path, catalog.path, conversations.path];

  if (new Set(paths).size !== paths.length || paths.includes(":memory:")) {
    throw new Error("Legacy, catalog, and conversation paths must be distinct files.");
  }
  if (!existsSync(legacy.path)) {
    throw new Error(`Legacy database does not exist: ${legacy.path}`);
  }
  if (existsSync(catalog.path) || existsSync(conversations.path)) {
    throw new Error(
      "Split target already exists. This command never merges or overwrites databases; remove both targets only if you intend to rerun the migration.",
    );
  }
  if (existsSync(`${legacy.path}-wal`) || existsSync(`${legacy.path}-shm`)) {
    throw new Error(
      "The legacy database appears to be open in WAL mode. Stop the development/server process and wait for its -wal and -shm files to disappear before splitting.",
    );
  }

  let catalogRowsCopied: Record<string, number> = {};
  let conversationRowsCopied: Record<string, number> = {};
  try {
    // Opening first upgrades every historical schema to the normalized shape
    // expected by the two destination schemas without changing business data.
    legacy.open();
    catalog.open();
    conversations.open();

    catalogRowsCopied = copyTables(
      catalog.raw,
      legacy.path,
      CATALOG_TABLES.map((table) => ({ source: table, target: table })),
    );
    conversationRowsCopied = copyTables(
      conversations.raw,
      legacy.path,
      CONVERSATION_TABLES,
    );
    recordLegacySplit(catalog.raw, legacy.path);
    recordLegacySplit(conversations.raw, legacy.path);
  } catch (error) {
    catalog.close();
    conversations.close();
    removeOwnedDatabaseFiles(catalog.path);
    removeOwnedDatabaseFiles(conversations.path);
    throw error;
  } finally {
    conversations.close();
    catalog.close();
    legacy.close();
  }

  return {
    legacyPath: legacy.path,
    catalogPath: catalog.path,
    conversationPath: conversations.path,
    catalogRowsCopied,
    conversationRowsCopied,
  };
}

function copyTables(
  target: DatabaseSync,
  legacyPath: string,
  tables: readonly TableCopyMapping[],
): Record<string, number> {
  target.prepare("ATTACH DATABASE ? AS legacy").run(legacyPath);
  const counts: Record<string, number> = {};

  try {
    target.exec("BEGIN IMMEDIATE");
    for (const table of tables) {
      assertMatchingColumns(target, table.source, table.target);
      target.exec(
        `INSERT INTO main.${quoteIdentifier(table.target)} SELECT * FROM legacy.${quoteIdentifier(table.source)}`,
      );
      const sourceCount = readCount(target, "legacy", table.source);
      const targetCount = readCount(target, "main", table.target);
      if (targetCount !== sourceCount) {
        throw new Error(
          `Row-count mismatch while copying ${table.source} to ${table.target}: expected ${sourceCount}, received ${targetCount}.`,
        );
      }
      counts[table.target] = targetCount;
    }

    const foreignKeyIssues = target.prepare("PRAGMA main.foreign_key_check").all();
    if (foreignKeyIssues.length > 0) {
      throw new Error("Foreign-key validation failed after copying split data.");
    }
    target.exec("COMMIT");
    return counts;
  } catch (error) {
    target.exec("ROLLBACK");
    throw error;
  } finally {
    target.exec("DETACH DATABASE legacy");
  }
}

function assertMatchingColumns(
  target: DatabaseSync,
  sourceTable: string,
  targetTable: string,
): void {
  const targetColumns = readColumns(target, "main", targetTable);
  const sourceColumns = readColumns(target, "legacy", sourceTable);
  if (
    targetColumns.length !== sourceColumns.length ||
    targetColumns.some((column, index) => column !== sourceColumns[index])
  ) {
    throw new Error(
      `Source ${sourceTable} and target ${targetTable} columns do not match.`,
    );
  }
}

function readColumns(
  database: DatabaseSync,
  schema: "main" | "legacy",
  table: string,
): string[] {
  return database
    .prepare(`SELECT name FROM ${schema}.pragma_table_info(?) ORDER BY cid`)
    .all(table)
    .map(({ name }) => String(name));
}

function readCount(
  database: DatabaseSync,
  schema: "main" | "legacy",
  table: string,
): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${schema}.${quoteIdentifier(table)}`,
    )
    .get() as { count: number };
  return row.count;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function removeOwnedDatabaseFiles(path: string): void {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${path}${suffix}`, { force: true });
  }
}

function recordLegacySplit(database: DatabaseSync, legacyPath: string): void {
  database
    .prepare(
      `INSERT INTO database_metadata (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(LEGACY_SPLIT_SOURCE_KEY, legacyPath);
}
