import { handle, json, fail } from "@/lib/api/http";
import { runTick } from "@/lib/tasks";
import { kvGet } from "@/lib/db";
import { env } from "@/lib/env";

export const maxDuration = 300;

/**
 * The clock can also call the web app (same pipeline, shorter deadline). The bearer must
 * match CRON_SECRET or the secret the setup workflow stored in the database.
 */
async function authorized(req: Request) {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!got) return false;
  const fromEnv = env.cronSecret();
  if (fromEnv && got === fromEnv) return true;
  const stored = await kvGet<{ secret: string }>("cron_secret");
  return !!stored?.secret && got === stored.secret;
}

export async function POST(req: Request) {
  return handle(async () => {
    if (!(await authorized(req))) return fail(401, "Not authorised.");
    return json(await runTick({ deadlineMs: Date.now() + 270_000 }));
  });
}

export const GET = POST;
