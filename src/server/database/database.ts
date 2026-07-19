import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DATABASE_MIGRATIONS,
  runMigrations,
  type DatabaseMigration,
} from "./migrations";

// node:sqlite can be imported without an experimental flag from Node 22.13.0;
// package.json deliberately enforces that minimum runtime version.
const MEMORY_DATABASE_PATH = ":memory:";
const BUSY_TIMEOUT_MS = 5_000;

export interface ApplicationDatabaseOptions {
  path: string;
  migrations?: readonly DatabaseMigration[];
}

/**
 * Owns the process-local SQLite connection. The synchronous Node API is a good
 * fit for short metadata operations; long-running queries should not be added
 * to request handlers because they would block the Node event loop.
 */
export class ApplicationDatabase {
  public readonly path: string;

  private connection?: DatabaseSync;
  private readonly migrations: readonly DatabaseMigration[];

  public constructor(options: ApplicationDatabaseOptions) {
    this.path = resolveDatabasePath(options.path);
    this.migrations = options.migrations ?? DATABASE_MIGRATIONS;
  }

  public open(): void {
    if (this.connection) return;

    if (this.path !== MEMORY_DATABASE_PATH) {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    const connection = new DatabaseSync(this.path);

    try {
      // Each domain has one synchronous connection in the single Node process.
      // DELETE journaling keeps crash-safe transactions without persistent
      // -wal/-shm sidecars; revisit WAL if multi-process concurrency is added.
      connection.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
      `);
      runMigrations(connection, this.migrations);
      this.connection = connection;
    } catch (error) {
      connection.close();
      throw error;
    }
  }

  public close(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  public get raw(): DatabaseSync {
    if (!this.connection) {
      throw new Error("Database is not open.");
    }
    return this.connection;
  }
}

function resolveDatabasePath(path: string): string {
  if (path === MEMORY_DATABASE_PATH || isAbsolute(path)) return path;
  return resolve(process.cwd(), path);
}
