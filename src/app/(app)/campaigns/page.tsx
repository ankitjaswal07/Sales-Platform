import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { listCampaigns } from "@/lib/db/repo/engagement";
import { emailsSentToday } from "@/lib/db/repo/engagement";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const session = await currentSession();
  if (!session) return null;
  const { items, total } = listCampaigns(session.organization.id, { limit: 100 });
  const sentToday = emailsSentToday(session.organization.id);

  return (
    <SectionNotice
      href="/campaigns"
      phase="Phase 4 — campaign builder"
      facts={[
        { label: "Campaigns", value: String(total) },
        { label: "Active", value: String(items.filter((c) => c.status === "active").length) },
        { label: "Sent today", value: String(sentToday), hint: "Counted against each campaign\u2019s daily cap" },
      ]}
      todo={[
        "The sequence editor: steps, delays, conditions and per-step email style.",
        "Audience selection with live dedupe, opt-out suppression and preview counts.",
        "Campaign analytics: delivered, opened, replied, interested and converted, per step.",
      ]}
      notes={[
        "Daily caps, quiet hours and opt-out suppression are enforced by the send engine before anything leaves.",
        "Emails are only sent when a provider is configured; otherwise they are stored and clearly labelled as not sent.",
      ]}
    />
  );
}
