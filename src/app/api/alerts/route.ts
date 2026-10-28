import { handle, json } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { listAlerts } from "@/lib/api/reads";

export async function GET() {
  return handle(async () => json(await listAlerts(await currentUser())));
}
