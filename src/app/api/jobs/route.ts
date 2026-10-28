import { after, type NextRequest } from "next/server";
import { handle, json, fail } from "@/lib/api/http";
import { getJob } from "@/lib/api/reads";
import { db } from "@/lib/db";
import { runResearchJob } from "@/lib/research/job";
import { runBackfillJob } from "@/lib/tasks";

export const maxDuration = 300;

/** Job status for the client's 2-second poll. A stalled job is picked up again here. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const job = await getJob(id);
    if (!job) return fail(404, "Unknown job.");
    if (job.status === "queued" || job.status === "running") {
      const [r] = await db()`select (lease_until is null or lease_until < now()) as free from jobs where id = ${id}`;
      if (r?.free) after(() => (job.kind === "backfill" ? runBackfillJob(id, Date.now() + 270_000) : runResearchJob(id, Date.now() + 270_000)).catch(() => false));
    }
    return json(job);
  });
}
