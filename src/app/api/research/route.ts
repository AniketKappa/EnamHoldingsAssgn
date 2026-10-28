import { after } from "next/server";
import { handle, json, fail, windowStart } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { db } from "@/lib/db";
import { createResearchJob, runResearchJob, latestDossier, resolveCompany, JobError } from "@/lib/research/job";

export const maxDuration = 300;

/** Start (or reuse) a dossier build. A dossier under a day old is served as is unless refresh is asked. */
export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { symbol?: string; refresh?: boolean };
    if (!b.symbol) return fail(400, "Send a symbol.");
    const userId = await currentUser();
    let c;
    try { c = await resolveCompany(b.symbol); } catch (e) { return fail(404, e instanceof JobError ? e.message : "Couldn't find that symbol."); }
    const d = await latestDossier(c.symbol);
    if (d && !b.refresh && Date.now() - new Date(d.created_at).getTime() < 24 * 3_600_000) return json({ symbol: c.symbol, version: d.version });
    const [{ n }] = await db()`select count(*)::int as n from jobs where kind = 'research' and user_id = ${userId} and created_at > ${windowStart()}`;
    if (Number(n) >= 5) return fail(429, "Five dossier builds an hour per visitor keeps FINN on free model quotas. Try again later.");
    const [{ day }] = await db()`select count(*)::int as day from jobs where kind = 'research' and created_at > now() - interval '24 hours'`;
    if (Number(day) >= 40) return fail(429, "FINN has built 40 new dossiers today, its free model quota. Open one that's ready, or try again tomorrow.");
    const id = await createResearchJob(c.symbol, userId);
    after(() => runResearchJob(id, Date.now() + 270_000).catch(() => false));
    return json({ symbol: c.symbol, job_id: id });
  });
}
