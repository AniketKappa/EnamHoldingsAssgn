import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { db } from "@/lib/db";

const ACTIONS = new Set(["useful", "not_useful", "mute_category", "done"]);

/** Toggle a feedback action on an event. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { event_key?: string; action?: string; on?: boolean };
    if (!body.event_key || !body.action || !ACTIONS.has(body.action)) return fail(400, "Send event_key and an action.");
    const userId = await currentUser();
    const sql = db();
    const [ev] = await sql`select category, symbol from events where event_key = ${body.event_key}`;
    if (!ev) return fail(404, "Unknown event.");
    if (body.on === false) {
      await sql`delete from feedback where user_id = ${userId} and event_key = ${body.event_key} and action = ${body.action}`;
    } else {
      if (body.action === "useful") await sql`delete from feedback where user_id = ${userId} and event_key = ${body.event_key} and action = 'not_useful'`;
      if (body.action === "not_useful") await sql`delete from feedback where user_id = ${userId} and event_key = ${body.event_key} and action = 'useful'`;
      await sql`insert into feedback (user_id, event_key, action, category, symbol) values (${userId}, ${body.event_key}, ${body.action}, ${ev.category}, ${ev.symbol})
        on conflict (user_id, event_key, action) do nothing`;
    }
    return json({ ok: true });
  });
}
