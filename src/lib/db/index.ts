import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { autoMigrate } from "./auto-migrate";
import path from "node:path";
import fs from "node:fs";

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "data", "jarvis.db");

// Ensure the data directory exists
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

// Apply pending migrations on startup, then enable FK constraints
autoMigrate(db);
sqlite.pragma("foreign_keys = ON");

export * from "./schema";
