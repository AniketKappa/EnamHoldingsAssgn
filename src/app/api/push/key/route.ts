import { handle, json } from "@/lib/api/http";
import { vapidKeys } from "@/lib/pipeline/push";

export async function GET() {
  return handle(async () => json({ publicKey: (await vapidKeys()).publicKey }));
}
