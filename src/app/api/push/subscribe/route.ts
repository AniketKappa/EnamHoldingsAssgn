import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    if (!b.endpoint || !b.keys?.p256dh || !b.keys?.auth || !/^https:\/\//.test(b.endpoint)) return fail(400, "That isn't a browser push subscription.");
    const userId = await currentUser();
    await db()`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (${userId}, ${b.endpoint}, ${b.keys.p256dh}, ${b.keys.auth})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`;
    return json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { endpoint?: string };
    if (b.endpoint) await db()`delete from push_subscriptions where endpoint = ${b.endpoint}`;
    return json({ ok: true });
  });
}
