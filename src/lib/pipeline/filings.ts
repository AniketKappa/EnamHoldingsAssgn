// Fetching filing PDFs and keeping their page text for citations and Ask.
import { db } from "../db";
import { getBuffer, HttpError } from "../sources/http";
import { BSE_HEADERS } from "../sources/bse";
import { isPdf, pdfPages } from "../sources/pdf";
import { sha1 } from "../text";

export async function downloadPdf(url: string): Promise<Uint8Array> {
  const headers = /bseindia\.com/.test(url) ? { ...BSE_HEADERS, Accept: "application/pdf,*/*" } : { Accept: "application/pdf,*/*" };
  const tryUrls = [url];
  if (url.includes("/AttachLive/")) tryUrls.push(url.replace("/AttachLive/", "/AttachHis/"));
  let last: unknown;
  for (const u of tryUrls) {
    try {
      const buf = await getBuffer(u, { headers, timeoutMs: 60_000 });
      if (!isPdf(buf)) throw new Error(`Not a PDF: ${u}`);
      return buf;
    } catch (e) {
      last = e;
      if (e instanceof HttpError && e.status !== 404) break;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Store page text so Ask and citations can use it. Returns the document id. */
export async function storeDocument(args: {
  symbol: string; docType: string; url: string; pages: string[]; periodLabel?: string | null; periodEnd?: string | null;
}): Promise<number> {
  const sql = db();
  const urlHash = sha1(args.url);
  const [doc] = await sql`
    insert into documents (symbol, doc_type, period_label, period_end, url, url_hash, status, pages, fetched_at)
    values (${args.symbol}, ${args.docType}, ${args.periodLabel ?? null}, ${args.periodEnd ?? null}, ${args.url}, ${urlHash}, 'parsed', ${args.pages.length}, now())
    on conflict (url_hash) do update set status = 'parsed', pages = excluded.pages, fetched_at = now()
    returning id`;
  const id = Number(doc.id);
  await sql`delete from doc_pages where document_id = ${id}`;
  const rows = args.pages.map((t, i) => ({ document_id: id, page_no: i + 1, text: t.slice(0, 20_000) })).filter((r) => r.text.length > 0);
  for (let i = 0; i < rows.length; i += 200) {
    await sql`insert into doc_pages ${sql(rows.slice(i, i + 200), "document_id", "page_no", "text")} on conflict do nothing`;
  }
  return id;
}

export async function documentByUrl(url: string): Promise<{ id: number; pages: string[] } | null> {
  const sql = db();
  const rows = await sql`select id from documents where url_hash = ${sha1(url)} and status in ('parsed','extracted')`;
  if (!rows.length) return null;
  const id = Number(rows[0].id);
  const pages = await sql`select page_no, text from doc_pages where document_id = ${id} order by page_no`;
  const arr: string[] = [];
  for (const p of pages) arr[Number(p.page_no) - 1] = String(p.text);
  return { id, pages: arr.map((x) => x ?? "") };
}

export async function fetchAndStore(args: { symbol: string; docType: string; url: string; periodLabel?: string | null; periodEnd?: string | null; maxPages?: number }) {
  const existing = await documentByUrl(args.url);
  if (existing && existing.pages.length) return { ...existing, buf: null as Uint8Array | null };
  const buf = await downloadPdf(args.url);
  const pages = await pdfPages(buf, args.maxPages ?? 600);
  const id = await storeDocument({ ...args, pages });
  return { id, pages, buf };
}
