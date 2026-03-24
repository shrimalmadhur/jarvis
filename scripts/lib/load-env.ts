import dotenv from "dotenv";
import fs from "node:fs";

/** Load env: prefer .env.local (dev), then /etc/dobby/env (server), then .env */
export function loadEnv() {
  if (fs.existsSync(".env.local")) {
    dotenv.config({ path: ".env.local" });
  } else if (fs.existsSync("/etc/dobby/env")) {
    dotenv.config({ path: "/etc/dobby/env" });
  } else if (fs.existsSync(".env")) {
    dotenv.config({ path: ".env" });
  }
}
