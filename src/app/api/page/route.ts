import type { NextRequest } from "next/server";
import { handle, json, fail } from "@/lib/api/http";
import { db } from "@/lib/db";

/** One document page, for the source drawer behind every citation. */
export async function GET(req: NextRequest) {
  return handle(async () => {
    const doc = Number(req.nextUrl.searchParams.get("doc"));
    const page = Number(req.nextUrl.searchParams.get("p"));
    if (!doc || !page) return fail(400, "Send doc and p.");
    const rows = await db()`select d.doc_type, d.period_label, d.url, d.symbol, p.text from documents d
      join doc_pages p on p.document_id = d.id and p.page_no = ${page} where d.id = ${doc}`;
    if (!rows.length) return fail(404, "That page isn't stored.");
    const r = rows[0];
    return json({ doc_type: r.doc_type, period_label: r.period_label, url: r.url, symbol: r.symbol, page, text: String(r.text).slice(0, 6000) });
  });
}
