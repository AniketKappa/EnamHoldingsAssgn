import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { parseRules } from "@/lib/pipeline/watchRules";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { text?: string };
    const text = (b.text ?? "").trim().slice(0, 300);
    if (!text) return fail(400, "Type what you want FINN to watch for.");
    const userId = await currentUser();
    const holdings = (await db()`select symbol from holdings where user_id = ${userId}`).map((r) => String(r.symbol));
    return json(await parseRules(text, holdings));
  });
}
