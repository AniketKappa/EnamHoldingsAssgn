"use client";
// Details open as bottom sheets so the list underneath keeps its place. The
// drawer code loads on first open (or when the browser is idle), not with the page.
import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

const SheetImpl = dynamic(() => import("./SheetImpl").then((m) => m.SheetImpl), { ssr: false });

if (typeof window !== "undefined") {
  const warm = () => { void import("./SheetImpl"); };
  if ("requestIdleCallback" in window) window.requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 2500);
}

export function Sheet(props: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; description?: string;
}) {
  // Mount on first open and stay mounted, so closing still animates.
  const [ever, setEver] = useState(props.open);
  if (props.open && !ever) setEver(true);
  if (!ever) return null;
  return <SheetImpl {...props} />;
}
