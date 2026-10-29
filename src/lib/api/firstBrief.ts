// The Brief's first data for a server render: the same read as /api/brief, as plain
// JSON. Never throws: on any problem the client fetches as before.
import { hasDb } from "../db";
import { briefUrl } from "../briefUrl";
import { currentUser } from "./user";
import { getBrief } from "./brief";
import type { BriefT } from "./types";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export async function firstBrief(sp: Record<string, string | string[] | undefined>): Promise<{ url: string; data: BriefT } | null> {
  if (!hasDb()) return null;
  const w = one(sp.w) ?? "24h", from = one(sp.from), to = one(sp.to);
  try {
    const data = await getBrief(await currentUser(), w, from, to);
    return { url: briefUrl(w, from, to), data: JSON.parse(JSON.stringify(data)) as BriefT };
  } catch {
    return null;
  }
}
