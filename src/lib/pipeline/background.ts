// Professional background for a new top executive (spec 5.5, 9.8).
// Call 1: Gemini with Google Search grounding, free-text notes plus sources.
// Call 2: a cheap model turns the notes into JSON, keeping only sourced facts.
// Fallback: Tavily search snippets. FINN never requests linkedin.com.
import { llm, llmConfigured } from "../llm/router";
import { PersonBackground, type PersonBackgroundT } from "../llm/schemas";
import { env } from "../env";
import { truncate } from "../text";

export interface Background extends PersonBackgroundT {
  via: "grounded_search" | "tavily" | "none";
}

interface Src { title: string; url: string }

/** Grounding links are redirects; read the target from the Location header without following it. */
async function resolveRedirect(url: string): Promise<string> {
  if (!/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect/.test(url)) return url;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { method: "GET", redirect: "manual", signal: ctrl.signal });
    clearTimeout(t);
    const loc = res.headers.get("location");
    return loc && /^https?:\/\//.test(loc) ? loc : url;
  } catch {
    return url;
  }
}

function hostOf(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

const STRUCTURE_PROMPT = (notes: string, sources: Src[]) => `Convert these research notes about a person into the schema.
Keep only facts that the notes attribute to a numbered source, and set source_url to that source's URL exactly as listed.
previous_roles: newest first, at most 4, organisation and title as stated. education: degrees and institutions as stated.
headline: one line under 120 characters, such as "Joins from X, where he was Y", using only facts from the notes; null if unclear.
linkedin_url: only if one of the listed source URLs is a linkedin.com/in/ profile; else null.
sources: the sources you used, copied from the list.

Sources:
${sources.map((s, i) => `[S${i + 1}] ${s.title} — ${s.url}`).join("\n")}

Notes:
${notes}`;

function sanitize(bg: PersonBackgroundT, allowed: Src[]): PersonBackgroundT {
  const urls = new Set(allowed.map((s) => s.url));
  const roles = bg.previous_roles.filter((r) => urls.has(r.source_url)).slice(0, 4);
  const linkedin = bg.linkedin_url && urls.has(bg.linkedin_url) && /linkedin\.com\/in\//.test(bg.linkedin_url) ? bg.linkedin_url : null;
  const used = new Set([...roles.map((r) => r.source_url), ...(linkedin ? [linkedin] : [])]);
  const sources = allowed.filter((s) => used.has(s.url) || bg.sources.some((b) => b.url === s.url)).slice(0, 5);
  const headline = bg.headline && roles.some((r) => bg.headline!.toLowerCase().includes(r.organisation.toLowerCase().split(" ")[0]))
    ? bg.headline : roles[0] ? truncate(`Previously ${roles[0].title}, ${roles[0].organisation}`, 120) : null;
  return {
    headline,
    previous_roles: roles,
    education: sources.length ? bg.education.slice(0, 3) : [],
    years_experience: sources.length ? bg.years_experience : null,
    linkedin_url: linkedin,
    sources: sources.map((s) => ({ title: s.title || hostOf(s.url), url: s.url })),
  };
}

async function viaGrounding(q: { name: string; designation: string; company: string; changeType: string; date: string | null }): Promise<Background | null> {
  const prompt = `Find the professional background of ${q.name}, ${q.changeType} as ${q.designation} of ${q.company} (India)${q.date ? `, effective ${q.date}` : ""}.
List previous roles with organisation, title and years; education; total years of experience.
Report only what the search results state. Include a LinkedIn profile URL only if one appears in the results.
If nothing reliable is found about this specific person, say so.`;
  const res = await llm<string>({ task: "person_background", prompt, tools: "google_search", ref: `${q.company}:${q.name}` });
  const raw = res.sources ?? [];
  if (!raw.length) return null;
  const resolved: Src[] = await Promise.all(raw.map(async (s) => {
    const url = await resolveRedirect(s.url);
    return { title: s.title || hostOf(url), url };
  }));
  // Annotate each grounded sentence with the sources that support it.
  const notes = (res.supports?.length
    ? res.supports.map((s) => `${s.text} [${s.sources.map((i) => `S${i + 1}`).join(", ")}]`).join("\n")
    : res.text).slice(0, 6000);
  const out = await llm({ task: "person_structure", prompt: STRUCTURE_PROMPT(notes, resolved), schema: PersonBackground, ref: `${q.company}:${q.name}` });
  return { ...sanitize(out.data, resolved), via: "grounded_search" };
}

async function viaTavily(q: { name: string; designation: string; company: string }): Promise<Background | null> {
  const key = env.tavilyKey();
  if (!key) return null;
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: `${q.name} ${q.designation} ${q.company} career education`, max_results: 5, exclude_domains: ["linkedin.com"] }),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { results?: { title: string; url: string; content: string }[] };
  const results = j.results ?? [];
  if (!results.length) return null;
  const sources = results.map((r) => ({ title: r.title, url: r.url }));
  const notes = results.map((r, i) => `[S${i + 1}] ${truncate(r.content, 900)}`).join("\n");
  const out = await llm({ task: "person_structure", prompt: STRUCTURE_PROMPT(notes, sources), schema: PersonBackground, ref: `${q.company}:${q.name}` });
  return { ...sanitize(out.data, sources), via: "tavily" };
}

export async function personBackground(q: {
  name: string; designation: string; company: string; changeType: string; date: string | null;
}): Promise<Background> {
  const empty: Background = { headline: null, previous_roles: [], education: [], years_experience: null, linkedin_url: null, sources: [], via: "none" };
  if (!llmConfigured()) return empty;
  try {
    const g = await viaGrounding(q);
    if (g && g.previous_roles.length) return g;
  } catch { /* fall through to Tavily */ }
  try {
    const t = await viaTavily(q);
    if (t && t.previous_roles.length) return t;
  } catch { /* no background */ }
  return empty;
}
