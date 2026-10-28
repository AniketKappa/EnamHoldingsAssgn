import { handle, json } from "@/lib/api/http";
import { costSummary } from "@/lib/api/reads";

export async function GET() {
  return handle(async () => json(await costSummary()));
}
