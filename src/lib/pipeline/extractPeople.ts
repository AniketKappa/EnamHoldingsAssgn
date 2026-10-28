// Person card extraction (spec 5.5): the Regulation 30 / Annexure 18 fields
// from the filing, deterministic flags, then sourced background for top roles.
import type { Part } from "@google/genai";
import { db } from "../db";
import { llm, EXTRACTION_SYSTEM } from "../llm/router";
import { PeopleExtract, type PeopleExtractT } from "../llm/schemas";
import { subsetPdf } from "../sources/pdf";
import { markPages, quoteOnPage } from "../text";
import { fetchAndStore, downloadPdf } from "./filings";
import { roleClassOf, flagsFor, primaryChange, peopleSubtype, peopleTitle } from "./peopleRules";
import { personBackground, type Background } from "./background";

type Change = PeopleExtractT["changes"][number];

export interface PersonDetail extends Change {
  role_class: Change["role_class"];
  flags: string[];
  quote_ok: boolean | null;
  background: Background | null;
}

const PEOPLE_PROMPT = (company: string, subject: string) => `This filing by ${company} discloses a change in directors, key managerial personnel, senior management or auditors under SEBI LODR Regulation 30. Subject: "${subject}".
List every person whose position changes. Skip people only mentioned in passing.
role_class: top = MD, CEO, Chairman, CFO, whole-time or executive director; kmp = company secretary, compliance officer or other senior management;
independent = independent or non-executive director; auditor = statutory or secretarial audit firm.
Copy the brief profile and the stated reason exactly as written (profile up to 600 characters). Dates as YYYY-MM-DD.`;

/** Pages most likely to hold the disclosure: keyword hits, at most 6. */
export function peoplePages(pages: string[]): number[] {
  const score = (t: string) => {
    const s = t.toLowerCase();
    let n = 0;
    for (const k of ["appoint", "resign", "cessation", "brief profile", "re-designat", "director", "key managerial", "effective", "din", "annexure"]) {
      if (s.includes(k)) n++;
    }
    return n;
  };
  return pages.map((p, i) => ({ i, s: score(p) })).filter((x) => x.s >= 2).sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, 6).map((x) => x.i).sort((a, b) => a - b);
}

const ENRICH = /^(top)$/;

export async function extractPeopleEvent(eventKey: string): Promise<{ people: PersonDetail[]; primary_index: number }> {
  const sql = db();
  const [ev] = await sql`select e.*, c.name, a.subject, a.pdf_url, a.headline from events e join companies c on c.symbol = e.symbol
    join announcements a on a.id = e.primary_id where e.event_key = ${eventKey}`;
  if (!ev) throw new Error(`No event ${eventKey}`);
  const symbol = String(ev.symbol);
  const company = String(ev.name);
  const subject = String(ev.subject);
  let changes: Change[] = [];
  let pages: string[] = [];
  let scanned = false;

  if (ev.pdf_url) {
    const doc = await fetchAndStore({ symbol, docType: "filing", url: String(ev.pdf_url), maxPages: 60 });
    pages = doc.pages;
    const textChars = pages.join("").length;
    const idx = peoplePages(pages);
    let parts: Part[] | undefined;
    let body: string;
    if (textChars < 300) {
      // Scanned letter: let the model read the page images.
      scanned = true;
      const buf = doc.buf ?? (await downloadPdf(String(ev.pdf_url)));
      const small = await subsetPdf(buf, pages.slice(0, 6).map((_, i) => i));
      parts = [{ inlineData: { mimeType: "application/pdf", data: Buffer.from(small).toString("base64") } }];
      body = "The filing is attached as a PDF. Page numbers are the PDF's page order.";
    } else {
      body = markPages(pages, { only: idx.length ? idx : pages.slice(0, 6).map((_, i) => i), maxChars: 40_000 });
    }
    const out = await llm({
      task: "people_extract", system: EXTRACTION_SYSTEM, parts,
      prompt: `${PEOPLE_PROMPT(company, subject)}\n\n${body}`, schema: PeopleExtract, ref: String(ev.primary_id),
    });
    changes = out.data.changes;
  } else {
    const text = `${subject}\n${ev.headline ?? ""}`;
    const out = await llm({ task: "people_extract", system: EXTRACTION_SYSTEM, prompt: `${PEOPLE_PROMPT(company, subject)}\n\n[p.1]\n${text}`, schema: PeopleExtract, ref: String(ev.primary_id) });
    changes = out.data.changes;
    pages = [text];
  }

  // Quote check: keep a change only if its quote is on some page (skipped for scanned filings).
  const people: PersonDetail[] = [];
  for (const c of changes) {
    const rc = roleClassOf(c.designation, c.role_class);
    let quoteOk: boolean | null = null;
    if (!scanned && pages.length) {
      quoteOk = quoteOnPage(c.quote, pages[c.page - 1] ?? "") || pages.some((p) => quoteOnPage(c.quote, p))
        || pages.some((p) => p.toLowerCase().includes(c.person_name.toLowerCase().split(" ").slice(-1)[0] ?? "~"));
      if (!quoteOk) continue;
    }
    people.push({ ...c, role_class: rc, flags: flagsFor({ ...c, role_class: rc }), quote_ok: quoteOk, background: null });
  }
  if (!people.length) throw new Error("No person changes found in the filing");

  const primary = primaryChange(people);
  const primaryIndex = Math.max(0, people.findIndex((p) => p === primary));

  // Background only for incoming or re-designated top roles (the brief's "who are they").
  for (const p of people) {
    if (!ENRICH.test(p.role_class)) continue;
    if (!(p.change_type === "appointment" || p.change_type === "redesignation")) continue;
    p.background = await personBackground({
      name: p.person_name, designation: p.designation, company, changeType: p.change_type, date: p.effective_date,
    });
  }

  for (const p of people) {
    await sql`
      insert into people_events (announcement_id, symbol, person_name, designation, role_class, change_type, effective_date, reason,
        profile_from_filing, relationships, background, flags)
      values (${String(ev.primary_id)}, ${symbol}, ${p.person_name}, ${p.designation}, ${p.role_class}, ${p.change_type},
        ${isoDate(p.effective_date)}, ${p.reason}, ${p.brief_profile}, ${p.relationships},
        ${p.background ? sql.json(p.background as never) : null}, ${sql.json(p.flags)})
      on conflict (announcement_id, person_name) do update set designation = excluded.designation, role_class = excluded.role_class,
        change_type = excluded.change_type, effective_date = excluded.effective_date, reason = excluded.reason,
        profile_from_filing = excluded.profile_from_filing, relationships = excluded.relationships,
        background = coalesce(excluded.background, people_events.background), flags = excluded.flags`;
  }

  // Leadership churn: a second top or KMP exit within 90 days.
  const isExit = (p: PersonDetail) => (p.change_type === "resignation" || p.change_type === "cessation") && (p.role_class === "top" || p.role_class === "kmp");
  if (people.some(isExit)) {
    const [{ n }] = await sql`select count(distinct pe.person_name)::int as n from people_events pe
      join announcements a on a.id = pe.announcement_id
      where pe.symbol = ${symbol} and pe.change_type in ('resignation', 'cessation') and pe.role_class in ('top', 'kmp')
      and a.filed_at > now() - interval '90 days' and pe.announcement_id <> ${String(ev.primary_id)}`;
    if (Number(n) >= 1) for (const p of people) if (isExit(p) && !p.flags.includes("Leadership churn")) p.flags.push("Leadership churn");
  }

  const pc = people[primaryIndex];
  const others = people.length - 1;
  const title = `${peopleTitle(pc)}${others > 0 ? ` (+${others} more change${others > 1 ? "s" : ""})` : ""}`;
  const redFlags = [...new Set(people.flatMap((p) => p.flags))];
  await sql`update events set subtype = ${peopleSubtype(pc)}, title = ${title}, red_flags = ${sql.json(redFlags)},
    detail = ${sql.json({ ...((ev.detail as object) ?? {}), people, primary_index: primaryIndex, pdf_url: ev.pdf_url ?? null } as never)},
    updated_at = now() where event_key = ${eventKey}`;
  return { people, primary_index: primaryIndex };
}

function isoDate(s: string | null): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
