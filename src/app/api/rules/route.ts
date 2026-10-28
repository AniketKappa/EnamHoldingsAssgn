import type { NextRequest } from "next/server";
import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { listRules } from "@/lib/api/reads";
import { db } from "@/lib/db";

const KINDS = new Set(["category", "price_move", "volume_spike", "sigma_move"]);

function cleanParams(kind: string, p: Record<string, unknown>) {
  const n = (v: unknown, lo: number, hi: number) => (typeof v === "number" && v >= lo && v <= hi ? v : null);
  if (kind === "price_move") return { pct: n(p.pct, 0.5, 50) ?? 4 };
  if (kind === "volume_spike") return { multiple: n(p.multiple, 1.1, 20) ?? 2 };
  if (kind === "sigma_move") return { z: n(p.z, 1, 6) ?? 2.5 };
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 20) : null);
  return { categories: arr(p.categories) ?? [], subtypes: arr(p.subtypes) };
}

export async function GET() {
  return handle(async () => json({ rules: await listRules(await currentUser()) }));
}

export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { kind?: string; symbol?: string | null; params?: Record<string, unknown>; label?: string; source_text?: string };
    if (!b.kind || !KINDS.has(b.kind) || !b.label) return fail(400, "A rule needs a kind and a label.");
    const userId = await currentUser();
    const sql = db();
    const [{ n }] = await sql`select count(*)::int as n from alert_rules where user_id = ${userId}`;
    if (Number(n) >= 40) return fail(400, "You have 40 rules; delete one first.");
    const [r] = await sql`insert into alert_rules (user_id, kind, symbol, params, label, source_text)
      values (${userId}, ${b.kind}, ${b.symbol ? b.symbol.toUpperCase() : null}, ${sql.json(cleanParams(b.kind, b.params ?? {}) as never)}, ${b.label.slice(0, 120)}, ${b.source_text?.slice(0, 300) ?? null})
      returning id`;
    return json({ id: Number(r.id) });
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const id = Number(req.nextUrl.searchParams.get("id"));
    const b = (await req.json().catch(() => ({}))) as { enabled?: boolean; params?: Record<string, unknown>; label?: string };
    const userId = await currentUser();
    const sql = db();
    const [r] = await sql`select kind from alert_rules where id = ${id} and user_id = ${userId}`;
    if (!r) return fail(404, "Unknown rule.");
    if (typeof b.enabled === "boolean") await sql`update alert_rules set enabled = ${b.enabled} where id = ${id}`;
    if (b.params) await sql`update alert_rules set params = ${sql.json(cleanParams(String(r.kind), b.params) as never)} where id = ${id}`;
    if (b.label) await sql`update alert_rules set label = ${b.label.slice(0, 120)} where id = ${id}`;
    return json({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  return handle(async () => {
    const id = Number(req.nextUrl.searchParams.get("id"));
    await db()`delete from alert_rules where id = ${id} and user_id = ${await currentUser()}`;
    return json({ ok: true });
  });
}
