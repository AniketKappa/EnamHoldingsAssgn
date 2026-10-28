import { handle, json, fail } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { sendTestPush } from "@/lib/pipeline/push";

export async function POST() {
  return handle(async () => {
    const sent = await sendTestPush(await currentUser());
    return sent ? json({ ok: true, sent }) : fail(400, "Alerts aren't enabled on this device yet. Tap Enable alerts first.");
  });
}
