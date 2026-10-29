"use client";
// One-thumb navigation: four tabs at the bottom, content in a phone-width column.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, Briefcase, Inbox, Telescope } from "lucide-react";
import type { ReactNode } from "react";
import { useApi } from "@/lib/client/api";
import { cx } from "./ui";

const TABS = [
  { href: "/", label: "Brief", icon: Inbox, match: (p: string) => p === "/" },
  { href: "/alerts", label: "Alerts", icon: Bell, match: (p: string) => p.startsWith("/alerts") },
  { href: "/portfolio", label: "Portfolio", icon: Briefcase, match: (p: string) => p.startsWith("/portfolio") || p.startsWith("/company") },
  { href: "/research", label: "Research", icon: Telescope, match: (p: string) => p.startsWith("/research") || p.startsWith("/dossier") },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const router = useRouter();
  // Tabs prefetch when a finger or pointer reaches them, not all at once on load.
  const warm = (href: string) => () => router.prefetch(href);
  const { data } = useApi<{ unread: number }>("/api/alerts", { refreshMs: 90_000 });
  const unread = data?.unread ?? 0;
  return (
    <>
      <div className="mx-auto min-h-dvh w-full max-w-[560px] px-4 pb-28">{children}</div>
      <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
        <ul className="mx-auto grid max-w-[560px] grid-cols-4">
          {TABS.map((t) => {
            const active = t.match(path);
            const Icon = t.icon;
            return (
              <li key={t.href}>
                <Link href={t.href} aria-current={active ? "page" : undefined} prefetch={false}
                  onTouchStart={warm(t.href)} onMouseEnter={warm(t.href)} onFocus={warm(t.href)}
                  className={cx("relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs", active ? "text-ink" : "text-ink-2")}>
                  {active ? <span aria-hidden className="absolute top-0 h-[2px] w-8 rounded-full bg-accent" /> : null}
                  <span className="relative">
                    <Icon size={22} strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                    {t.href === "/alerts" && unread > 0 ? (
                      <span className="num absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-semibold leading-[18px] text-white dark:text-paper">
                        {unread > 99 ? "99+" : unread}
                        <span className="sr-only"> unread</span>
                      </span>
                    ) : null}
                  </span>
                  <span className={active ? "font-medium" : ""}>{t.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
