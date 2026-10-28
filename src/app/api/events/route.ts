import type { NextRequest } from "next/server";
import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { getEvent } from "@/lib/api/reads";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const key = req.nextUrl.searchParams.get("key") ?? "";
    const ev = await getEvent(await currentUser(), key);
    return ev ? json(ev) : fail(404, "That event is no longer in FINN's records.");
  });
}
