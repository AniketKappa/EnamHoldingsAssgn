// The Brief. The page shell is static; the Brief itself is rendered on the server
// with its data in the same response (no loading spinner on first paint), then the
// client keeps it fresh. Reads Postgres through the same function as /api/brief.
import { Suspense } from "react";
import { BriefClient, BriefSkeleton } from "./BriefClient";
import { firstBrief } from "@/lib/api/firstBrief";

type SP = Promise<Record<string, string | string[] | undefined>>;

// Room for a background tick when the pipeline has gone quiet (see lib/api/selfTick).
export const maxDuration = 300;

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<BriefSkeleton />}>
      <BriefWithData searchParams={searchParams} />
    </Suspense>
  );
}

async function BriefWithData({ searchParams }: { searchParams: SP }) {
  return <BriefClient initial={await firstBrief(await searchParams)} />;
}
