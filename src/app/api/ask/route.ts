import { handle, json, fail, windowStart } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { db } from "@/lib/db";
import { ask } from "@/lib/research/ask";

export const maxDuration = 60;

export async function POST(req: Request) {
  return handle(async () => {
    const b = (await req.json().catch(() => ({}))) as { symbol?: string; question?: string; context?: string };
    if (!b.symbol || !b.question?.trim()) return fail(400, "Ask a question about one company.");
    const userId = await currentUser();
    const [{ n }] = await db()`select count(*)::int as n from qa_messages where user_id = ${userId} and created_at > ${windowStart()}`;
    if (Number(n) >= 30) return fail(429, "Thirty questions an hour per visitor keeps FINN on free model quotas. Try again later.");
    return json(await ask({ symbol: b.symbol, question: b.question, context: b.context ?? null, userId }));
  });
}
