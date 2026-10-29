import { handle, json } from "@/lib/api/http";
import { currentUser } from "@/lib/api/user";
import { listAlerts } from "@/lib/api/reads";
import { tickIfStale } from "@/lib/api/selfTick";

// Every screen asks for the alerts badge, so this is where a quiet pipeline gets
// its background tick (after the response; see selfTick). Never from a page render:
// fetch() is not available to after() work started during prerendering.
export const maxDuration = 300;

export async function GET() {
  return handle(async () => {
    const out = json(await listAlerts(await currentUser()));
    await tickIfStale();
    return out;
  });
}
