import type { NextRequest } from "next/server";
import { handle, json } from "@/lib/api/http";
import { searchSymbols } from "@/lib/pipeline/symbols";

export async function GET(req: NextRequest) {
  return handle(async () => json({ results: await searchSymbols(req.nextUrl.searchParams.get("q") ?? "") }));
}
