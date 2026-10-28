// An in-process Postgres (PGlite) behind a local socket, so the real `postgres`
// client and the real schema run in tests without any server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

let server: PGLiteSocketServer | null = null;
let pg: PGlite | null = null;

export async function startDb(port = 5400 + Math.floor(Math.random() * 400)): Promise<string> {
  pg = await PGlite.create();
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  process.env.DATABASE_URL = url;
  process.env.DB_POOL_MAX = "1";
  const { db } = await import("@/lib/db");
  await db().unsafe(readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8"));
  return url;
}

export async function stopDb() {
  const { closeDb } = await import("@/lib/db");
  await closeDb();
  await server?.stop();
  await pg?.close();
  server = null;
  pg = null;
}
