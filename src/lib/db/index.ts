import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import path from "node:path";
import fs from "node:fs";

type DB = BunSQLiteDatabase<typeof schema>;

let _db: DB | null = null;
let _initError: Error | null = null;
let _initErrorAt = 0;
const RETRY_INTERVAL = 30_000; // retry init after 30s on failure

/**
 * Initialize the database connection lazily.
 * Uses bun:sqlite (built-in, no native addons, no ABI version issues).
 * Deferred to first access so Next.js build workers (which run Node.js
 * and can't load bun:sqlite) can import this module without crashing.
 */
function initDb(): DB {
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const { drizzle } = require("drizzle-orm/bun-sqlite") as typeof import("drizzle-orm/bun-sqlite");
  const { autoMigrate } = require("./auto-migrate") as typeof import("./auto-migrate");

  const dbPath =
    process.env.DATABASE_PATH ||
    path.join(process.cwd(), "data", "dobby.db");

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL");

  const db = drizzle(sqlite, { schema });

  autoMigrate(db);
  sqlite.exec("PRAGMA foreign_keys = ON");

  return db;
}

// Lazy proxy — initialized on first property access, not at import time.
// Caches init errors to avoid retry storms; retries after RETRY_INTERVAL.
export const db: DB = new Proxy({} as DB, {
  get(_, prop) {
    if (_db) return Reflect.get(_db, prop);
    if (_initError && Date.now() - _initErrorAt < RETRY_INTERVAL) throw _initError;
    try {
      _db = initDb();
    } catch (e) {
      _initError = e as Error;
      _initErrorAt = Date.now();
      throw e;
    }
    return Reflect.get(_db, prop);
  },
});

export * from "./schema";
