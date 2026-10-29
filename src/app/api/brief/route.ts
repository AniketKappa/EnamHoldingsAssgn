import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { getBrief } from "@/lib/api/brief";
import { tickIfStale } from "@/lib/api/selfTick";

// A stale pipeline is ticked after the response (see selfTick), within this limit.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return handle(async () => {
    const p = req.nextUrl.searchParams;
    const out = json(await getBrief(await currentUser(), p.get("w"), p.get("from"), p.get("to")));
    await tickIfStale();
    return out;
  });
}
