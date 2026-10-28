import { handle, json } from "@/lib/api/http";
import { db } from "@/lib/db";

/** Recently built dossiers, newest first, one per company. */
export async function GET() {
  return handle(async () => {
    const rows = await db()`select distinct on (d.symbol) d.symbol, c.name, d.created_at, d.data->'say_vs_do'->'credibility' as cred
      from dossiers d join companies c on c.symbol = d.symbol order by d.symbol, d.created_at desc`;
    const list = rows.map((r) => ({ symbol: String(r.symbol), name: String(r.name), built_at: new Date(r.created_at as string).toISOString(), credibility: r.cred as { score: number | null; resolved: number } | null }))
      .sort((a, b) => b.built_at.localeCompare(a.built_at));
    return json({ dossiers: list.slice(0, 20) });
  });
}
