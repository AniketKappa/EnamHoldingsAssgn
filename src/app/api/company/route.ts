import type { NextRequest } from "next/server";
import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { getCompany } from "@/lib/api/reads";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const c = await getCompany(await currentUser(), (req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase());
    return c ? json(c) : fail(404, "FINN doesn't know that symbol yet. Add it from Portfolio or build a dossier from Research.");
  });
}
