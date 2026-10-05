"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import Link from "next/link";
import { toast } from "sonner";
import { Bell, LogOut, Menu, Moon, Sun, Monitor, X } from "lucide-react";
import { AppNav } from "./app-nav";
import { Avatar, Badge, Button } from "@/components/ui/primitives";
import { ROLE_LABELS } from "@/lib/types";

interface TopbarProps {
  user: { name: string; email: string; role: string };
  organization: { name: string };
  unread: number;
  hotAlerts: number;
}

export function Topbar({ user, organization, unread, hotAlerts }: TopbarProps) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Check your connection and try again.");
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-3 backdrop-blur-md sm:px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen(true)}
      >
        <Menu className="size-4" />
      </Button>

      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-sm font-medium">{organization.name}</span>
        {hotAlerts > 0 ? (
          <Badge tone="ember" className="hidden sm:inline-flex">
            {hotAlerts} hot {hotAlerts === 1 ? "signal" : "signals"}
          </Badge>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />

        <Button variant="ghost" size="icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative" onClick={() => router.push("/notifications")}>
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-ember px-1 text-[9px] font-semibold text-ember-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>

        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
          <Avatar name={user.name} className="size-6 text-[10px]" />
          <div className="hidden min-w-0 leading-tight sm:block">
            <p className="truncate text-xs font-medium">{user.name}</p>
            <p className="truncate text-2xs text-subtle-foreground">
              {ROLE_LABELS[user.role as keyof typeof ROLE_LABELS] ?? user.role}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={signOut}
            loading={signingOut}
            aria-label="Sign out"
            title={`Sign out of ${user.email}`}
          >
            {signingOut ? null : <LogOut className="size-3.5" />}
          </Button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            role="presentation"
            className="absolute inset-0 bg-overlay animate-fade-in"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-72 border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl animate-slide-in-right">
            <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
              <span className="text-sm font-semibold tracking-tight">LeadForge</span>
              <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-3.5rem)] overflow-y-auto">
              <AppNav onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const next = resolvedTheme === "dark" ? "light" : "dark";
  const Icon = !mounted ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Switch to ${next} theme`}
      title={`Theme: ${mounted ? theme : "system"} — click for ${next}`}
      onClick={() => setTheme(next)}
    >
      <Icon className="size-4" />
    </Button>
  );
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-muted-foreground hover:text-foreground">
      {children}
    </Link>
  );
}
