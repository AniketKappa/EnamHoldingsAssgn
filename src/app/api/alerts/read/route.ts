import { handle, json } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { ids?: number[] };
    const userId = await currentUser();
    const ids = (body.ids ?? []).filter((x) => Number.isInteger(x));
    if (ids.length) await db()`update alerts set read_at = now() where user_id = ${userId} and id in ${db()(ids)} and read_at is null`;
    else await db()`update alerts set read_at = now() where user_id = ${userId} and read_at is null`;
    return json({ ok: true });
  });
}
