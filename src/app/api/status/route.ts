import { handle, json } from "@/lib/api/http";
import { freshness } from "@/lib/api/brief";
import { lastTick } from "@/lib/tasks";
import { llmConfigured } from "@/lib/llm/router";

export async function GET() {
  return handle(async () => json({ freshness: await freshness(), last_tick: await lastTick(), llm: llmConfigured() }));
}
