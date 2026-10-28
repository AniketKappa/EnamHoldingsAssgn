import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: { default: "FINN", template: "%s – FINN" },
  description: "What changed across your portfolio, ranked by what matters, and whether management did what it said.",
  applicationName: "FINN",
  appleWebApp: { capable: true, title: "FINN", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf0f3" },
    { media: "(prefers-color-scheme: dark)", color: "#10151f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
