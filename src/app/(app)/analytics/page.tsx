import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { analyticsSummary, rangeFor } from "@/lib/db/repo/analytics";
import { SectionNotice } from "@/components/shell/section-notice";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const session = await currentSession();
  if (!session) return null;
  const summary = analyticsSummary(session.organization.id, rangeFor(30));

  return (
    <SectionNotice
      href="/analytics"
      phase="Phase 4 — charts and opportunity map"
      facts={[
        { label: "Leads in range", value: String(summary.leads.total) },
        { label: "Open pipeline", value: formatMoney(summary.sales.pipelineValue, session.organization.currency) },
        { label: "Sites needing work", value: String(summary.websites.highOpportunity), hint: `${summary.websites.audited} audited` },
        { label: "Meetings booked", value: String(summary.activity.conversationsStarted) },
        { label: "Proposal open rate", value: `${summary.sales.proposalOpenRate}%` },
        { label: "Won revenue", value: formatMoney(summary.sales.wonRevenue, session.organization.currency) },
      ]}
      todo={[
        "Charts: funnel, timeline, source and industry breakdowns, and agent performance.",
        "The website opportunity map: which parts of your market have the weakest sites.",
        "Saved report definitions and scheduled email digests.",
      ]}
      notes={[
        "Every number is computed from this workspace\u2019s own records \u2014 there are no placeholder series anywhere.",
        "Ranges are explicit (today, 7, 30, 90 days or custom) and always shown next to the figure.",
      ]}
    />
  );
}
