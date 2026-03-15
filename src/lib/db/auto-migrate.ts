import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "node:path";

/**
 * Run drizzle migrations on startup.
 * Applies any pending migrations from the `drizzle/` directory.
 * Already-applied migrations are tracked automatically and skipped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function autoMigrate(db: BetterSQLite3Database<any>) {
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  try {
    migrate(db, { migrationsFolder });
  } catch (error) {
    console.error(
      `[FATAL] Database migration failed. Migrations folder: ${migrationsFolder}`,
      error
    );
    throw error;
  }
}
