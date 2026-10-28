import type { NextRequest } from "next/server";
import { handle, json, fail } from "@/lib/api/http";
import { latestDossier } from "@/lib/research/job";

export async function GET(req: NextRequest) {
  return handle(async () => {
    const d = await latestDossier((req.nextUrl.searchParams.get("symbol") ?? "").toUpperCase());
    return d ? json(d) : fail(404, "No dossier yet. Build one from Research.");
  });
}
