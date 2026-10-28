import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { getBrief } from "@/lib/api/brief";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const p = req.nextUrl.searchParams;
    return json(await getBrief(await currentUser(), p.get("w"), p.get("from"), p.get("to")));
  });
}
