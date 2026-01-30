import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import https from "node:https";
import nodeFetch from "node-fetch";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Force IPv4 connections to work around networks where Node.js built-in
// fetch fails (IPv6 unreachable + connection race timeout).
// node-fetch uses Node's https module which supports the family:4 option.
const ipv4Agent = new https.Agent({ family: 4 });
neonConfig.fetchFunction = ((url: string, init: RequestInit) =>
  nodeFetch(url, { ...init, agent: ipv4Agent } as never)) as unknown as typeof fetch;

const sql = neon(process.env.DATABASE_URL);

export const db = drizzle(sql, { schema });

export * from "./schema";
