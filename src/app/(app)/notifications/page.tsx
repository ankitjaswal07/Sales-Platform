import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { listAlerts, listNotifications, unreadNotificationCount } from "@/lib/db/repo/ops";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const session = await currentSession();
  if (!session) return null;
  const orgId = session.organization.id;
  const notifications = listNotifications(orgId, { userId: session.user.id, limit: 50 });
  const alerts = listAlerts(orgId, 30);

  return (
    <SectionNotice
      href="/dashboard"
      phase="Phase 2 — notification centre"
      facts={[
        { label: "Unread", value: String(unreadNotificationCount(orgId, session.user.id)) },
        { label: "Recent notifications", value: String(notifications.length) },
        { label: "Alerts fired", value: String(alerts.length), hint: "In-app alerts always deliver" },
      ]}
      todo={[
        "The notification centre with read/unread, dismissal and deep links into the record that triggered it.",
        "Channel preferences per alert rule, with the real delivery status of each one.",
      ]}
      notes={[
        "WhatsApp alerts go exclusively through the official WhatsApp Business Cloud API \u2014 never an unofficial automation.",
        "Until a channel is configured, alerts are delivered in-app and the missing configuration is stated plainly.",
      ]}
    />
  );
}
