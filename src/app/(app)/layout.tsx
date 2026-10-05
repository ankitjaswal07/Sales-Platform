import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import { unreadNotificationCount, listAlertRules, listAlerts } from "@/lib/db/repo/ops";
import { AppNav } from "@/components/shell/app-nav";
import { Topbar } from "@/components/shell/topbar";
import { Sparkles } from "lucide-react";
import Link from "next/link";

/**
 * The authenticated application shell (§48).
 *
 * Security posture: every page under this layout requires a live session. The
 * session is resolved server-side from an httpOnly cookie, so no page in this
 * tree can render for an anonymous visitor, even by direct URL.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");

  const { user, organization } = session;
  const unread = unreadNotificationCount(organization.id, user.id);
  const hotAlerts = listAlerts(organization.id, 20).filter((alert) => alert.severity === "critical").length;
  const rules = listAlertRules(organization.id).filter((rule) => rule.enabled).length;

  return (
    <div className="flex min-h-dvh bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <Link
          href="/dashboard"
          className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4 text-sm font-semibold tracking-tight"
        >
          <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-3.5" />
          </span>
          LeadForge
        </Link>
        <div className="flex-1 overflow-y-auto">
          <AppNav />
        </div>
        <div className="border-t border-sidebar-border px-4 py-3 text-2xs text-subtle-foreground">
          <p>
            {rules} alert {rules === 1 ? "rule" : "rules"} armed
          </p>
          <p className="mt-0.5">In-app alerts always deliver.</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={{ name: user.name ?? user.email, email: user.email, role: user.role }}
          organization={{ name: organization.name }}
          unread={unread}
          hotAlerts={hotAlerts}
        />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
