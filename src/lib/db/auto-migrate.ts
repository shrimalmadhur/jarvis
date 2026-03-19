import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import path from "node:path";

/**
 * Run drizzle migrations on startup.
 * Applies any pending migrations from the `drizzle/` directory.
 * Already-applied migrations are tracked automatically and skipped.
 *
 * During Next.js builds, multiple workers may evaluate this module
 * concurrently. If a migration fails because another worker already
 * created the table, we ignore the "already exists" error and retry
 * — the second attempt will see the migration as already applied.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function autoMigrate(db: BunSQLiteDatabase<any>) {
  const { migrate } = require("drizzle-orm/bun-sqlite/migrator") as typeof import("drizzle-orm/bun-sqlite/migrator");
  const migrationsFolder = path.resolve(process.cwd(), "drizzle");
  try {
    migrate(db, { migrationsFolder });
  } catch (error) {
    // Handle race condition: another worker may have run the migration
    // between our check and our execution. Retry once — the migration
    // will now be recorded as applied and skipped.
    const code = (error as { code?: string }).code;
    if (code === "SQLITE_ERROR" && String(error).includes("already exists")) {
      try {
        migrate(db, { migrationsFolder });
        return;
      } catch {
        // Fall through to fatal error
      }
    }
    console.error(
      `[FATAL] Database migration failed. Migrations folder: ${migrationsFolder}`,
      error
    );
    throw error;
  }
}
