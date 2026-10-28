// Web Push (VAPID). Keys are generated once and kept in Postgres, so no one
// handles a private key by hand; the public key is served to browsers.
import webpush from "web-push";
import { db, kvGet, kvSet } from "../db";
import { env } from "../env";

interface Vapid { publicKey: string; privateKey: string }

export async function vapidKeys(): Promise<Vapid> {
  const fromEnv = env.vapidPublic() && env.vapidPrivate() ? { publicKey: env.vapidPublic(), privateKey: env.vapidPrivate() } : null;
  if (fromEnv) return fromEnv;
  const existing = await kvGet<Vapid>("vapid");
  if (existing?.publicKey && existing.privateKey) return existing;
  const keys = webpush.generateVAPIDKeys();
  // Two runners could race; the first write wins and both read it back.
  await db()`insert into kv (key, value) values ('vapid', ${db().json(keys as never)}) on conflict (key) do nothing`;
  return (await kvGet<Vapid>("vapid")) ?? keys;
}

export interface PushPayload { title: string; body?: string; url?: string; tag?: string }

async function sendTo(subs: { id: number; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload): Promise<number> {
  const keys = await vapidKeys();
  webpush.setVapidDetails(env.vapidSubject(), keys.publicKey, keys.privateKey);
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db()`delete from push_subscriptions where id = ${s.id}`;
    }
  }
  return sent;
}

/** Push alerts not yet pushed. More than three for one user become one summary notification. */
export async function pushPendingAlerts(): Promise<number> {
  const sql = db();
  const rows = await sql`select a.id, a.user_id, a.title, a.body, a.url from alerts a
    where a.pushed_at is null and a.created_at > now() - interval '3 hours'
      and exists (select 1 from push_subscriptions p where p.user_id = a.user_id)
    order by a.created_at`;
  const byUser = new Map<string, typeof rows>();
  for (const r of rows) {
    const u = String(r.user_id);
    if (!byUser.has(u)) byUser.set(u, [] as unknown as typeof rows);
    byUser.get(u)!.push(r);
  }
  let sent = 0;
  for (const [userId, list] of byUser) {
    const subs = (await sql`select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}`) as unknown as { id: number; endpoint: string; p256dh: string; auth: string }[];
    if (list.length > 3) {
      sent += await sendTo(subs, { title: `FINN: ${list.length} new alerts`, body: list.slice(0, 3).map((x) => String(x.title)).join("\n"), url: "/alerts", tag: "finn-batch" });
    } else {
      for (const a of list) sent += await sendTo(subs, { title: String(a.title), body: (a.body as string | null) ?? undefined, url: (a.url as string | null) ?? "/alerts", tag: `finn-${a.id}` });
    }
    await sql`update alerts set pushed_at = now() where id in ${sql(list.map((x) => Number(x.id)))}`;
  }
  return sent;
}

export async function sendTestPush(userId: string): Promise<number> {
  const subs = (await db()`select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}`) as unknown as { id: number; endpoint: string; p256dh: string; auth: string }[];
  if (!subs.length) return 0;
  return sendTo(subs, { title: "FINN test alert", body: "Alerts will arrive like this. Tap to open your inbox.", url: "/alerts", tag: "finn-test" });
}

/** 08:30 IST: "FINN Brief: N matter" when the last 24 hours hold any Top events for that user. */
export async function pushDigest(): Promise<number> {
  const sql = db();
  const users = await sql`select distinct user_id from push_subscriptions`;
  let sent = 0;
  for (const u of users) {
    const userId = String(u.user_id);
    const [c] = await sql`select
        count(*) filter (where e.base_score + e.market_bonus >= 70)::int as top,
        count(*) filter (where e.base_score + e.market_bonus between 40 and 69)::int as worth,
        count(*) filter (where e.base_score + e.market_bonus < 40)::int as routine
      from events e join holdings h on h.symbol = e.symbol and h.user_id = ${userId}
      where e.first_filed_at > now() - interval '24 hours'`;
    if (!c || Number(c.top) === 0) continue;
    const subs = (await sql`select id, endpoint, p256dh, auth from push_subscriptions where user_id = ${userId}`) as unknown as { id: number; endpoint: string; p256dh: string; auth: string }[];
    sent += await sendTo(subs, {
      title: `FINN Brief: ${c.top} matter`,
      body: `${c.worth} worth a look, ${c.routine} routine filings collapsed.`,
      url: "/", tag: "finn-digest",
    });
  }
  return sent;
}
