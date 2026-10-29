"use client";
// The bottom sheet itself (vaul). Loaded on first open through Sheet.tsx, so
// the drawer library is not part of any screen's first load.
import { Drawer } from "vaul";
import type { ReactNode } from "react";

export function SheetImpl({ open, onOpenChange, title, children, description }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; description?: string;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[560px] flex-col rounded-t-[20px] bg-surface outline-none"
          style={{ boxShadow: "var(--sheet-shadow)" }}>
          <div aria-hidden className="mx-auto mt-2.5 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-rule" />
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          {description ? <Drawer.Description className="sr-only">{description}</Drawer.Description> : null}
          <div className="overflow-y-auto overscroll-contain px-4 pb-[max(env(safe-area-inset-bottom),20px)]">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
