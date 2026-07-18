import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations";

// node:sqlite can be imported without an experimental flag from Node 22.13.0;
// package.json deliberately enforces that minimum runtime version.
const MEMORY_DATABASE_PATH = ":memory:";
const BUSY_TIMEOUT_MS = 5_000;

export interface ApplicationDatabaseOptions {
  path: string;
}

/**
 * Owns the process-local SQLite connection. The synchronous Node API is a good
 * fit for short metadata operations; long-running queries should not be added
 * to request handlers because they would block the Node event loop.
 */
export class ApplicationDatabase {
  public readonly path: string;

  private connection?: DatabaseSync;

  public constructor(options: ApplicationDatabaseOptions) {
    this.path = resolveDatabasePath(options.path);
  }

  public open(): void {
    if (this.connection) return;

    if (this.path !== MEMORY_DATABASE_PATH) {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    const connection = new DatabaseSync(this.path);

    try {
      connection.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};
      `);
      runMigrations(connection);
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
