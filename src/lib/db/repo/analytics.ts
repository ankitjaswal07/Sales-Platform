import "server-only";

import { all, one } from "..";
import { LEAD_STATUSES, OPEN_STATUSES, type Temperature } from "../../types";
import type { AnalyticsSummary, OpportunityCard } from "./types";

/**
 * Analytics (§3, §35).
 *
 * Every figure is computed from stored rows in a single pass set of aggregate
 * queries — nothing is estimated, and an empty workspace returns zeros rather
 * than invented demo numbers.
 */

export interface AnalyticsRange {
  from: string;
  to: string;
  days: number;
  label: string;
}

export function rangeFor(days: number, label?: string): AnalyticsRange {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    days,
    label: label ?? (days === 1 ? "Today" : `Last ${days} days`),
  };
}

export function analyticsSummary(orgId: string, range: AnalyticsRange): AnalyticsSummary {
  /* ── leads ── */
  const statusRows = all<{ status: string; count: number }>(
    "SELECT status, COUNT(*) AS count FROM leads WHERE org_id = ? GROUP BY status",
    [orgId],
  );
  const byStatus: Record<string, number> = {};
  LEAD_STATUSES.forEach((status) => {
    byStatus[status] = 0;
  });
  statusRows.forEach((row) => {
    byStatus[row.status] = row.count;
  });
  const totalLeads = Object.values(byStatus).reduce((sum, value) => sum + value, 0);

  const temperatureRows = all<{ temperature: string; count: number }>(
    "SELECT temperature, COUNT(*) AS count FROM leads WHERE org_id = ? GROUP BY temperature",
    [orgId],
  );
  const temperature = new Map(temperatureRows.map((r) => [r.temperature as Temperature, r.count]));

  const newThisWeek = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND created_at >= datetime('now','-7 days')", [orgId]);
  const newThisMonth = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND created_at >= datetime('now','-30 days')", [orgId]);
  const uncontacted = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND last_contacted_at IS NULL AND status NOT IN ('won','lost')", [orgId]);
  const followedUpDue = count(
    "SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= datetime('now') AND status NOT IN ('won','lost')",
    [orgId],
  );

  /* ── websites ── */
  const withoutWebsite = count("SELECT COUNT(*) AS c FROM businesses WHERE org_id = ? AND (website_url IS NULL OR website_url = '')", [orgId]);
  const poor = count("SELECT COUNT(*) AS c FROM businesses WHERE org_id = ? AND website_status IN ('poor','very_poor','broken')", [orgId]);
  const outdated = count(
    `SELECT COUNT(*) AS c FROM websites w JOIN businesses b ON b.id = w.business_id
     WHERE w.org_id = ? AND w.copyright_year IS NOT NULL AND w.copyright_year <= CAST(strftime('%Y','now') AS INTEGER) - 3`,
    [orgId],
  );
  const slow = count(
    `SELECT COUNT(DISTINCT a.business_id) AS c FROM website_audits a WHERE a.org_id = ? AND a.status = 'complete' AND a.performance <= 55`,
    [orgId],
  );
  const poorMobile = count(
    `SELECT COUNT(DISTINCT a.business_id) AS c FROM website_audits a WHERE a.org_id = ? AND a.status = 'complete' AND a.mobile <= 55`,
    [orgId],
  );
  const poorSeo = count(
    `SELECT COUNT(DISTINCT a.business_id) AS c FROM website_audits a WHERE a.org_id = ? AND a.status = 'complete' AND a.seo <= 55`,
    [orgId],
  );
  const highOpportunity = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND opportunity_score >= 70", [orgId]);
  const audited = count(
    "SELECT COUNT(DISTINCT business_id) AS c FROM website_audits WHERE org_id = ? AND status = 'complete'",
    [orgId],
  );
  const averageScore = one<{ avg: number | null }>(
    `SELECT AVG(overall_score) AS avg FROM (
       SELECT overall_score, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY created_at DESC) AS rn
       FROM website_audits WHERE org_id = ? AND status = 'complete'
     ) WHERE rn = 1`,
    [orgId],
  )?.avg ?? null;

  /* ── sales ── */
  const proposalsSent = count("SELECT COUNT(*) AS c FROM proposals WHERE org_id = ? AND sent_at IS NOT NULL", [orgId]);
  const proposalsOpened = count("SELECT COUNT(*) AS c FROM proposals WHERE org_id = ? AND sent_at IS NOT NULL AND view_count > 0", [orgId]);
  const proposalsAccepted = count("SELECT COUNT(*) AS c FROM proposals WHERE org_id = ? AND accepted_at IS NOT NULL", [orgId]);

  const contacted = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND last_contacted_at IS NOT NULL", [orgId]);
  const responded = count(
    `SELECT COUNT(DISTINCT l.id) AS c FROM leads l
     WHERE l.org_id = ? AND EXISTS (SELECT 1 FROM conversations c WHERE c.lead_id = l.id AND c.message_count > 1)`,
    [orgId],
  );
  const meetings = count(`SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND status IN ('meeting_scheduled','negotiation','won')`, [orgId]);
  const won = byStatus.won ?? 0;
  const closed = won + (byStatus.lost ?? 0);

  const pipelineValue = metric(
    `SELECT COALESCE(SUM(COALESCE(estimated_value,0)),0) AS total FROM leads WHERE org_id = ? AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})`,
    [orgId, ...OPEN_STATUSES],
  );
  const wonRevenue = metric("SELECT COALESCE(SUM(COALESCE(estimated_value,0)),0) AS total FROM leads WHERE org_id = ? AND status = 'won'", [orgId]);
  const lostRevenue = metric("SELECT COALESCE(SUM(COALESCE(estimated_value,0)),0) AS total FROM leads WHERE org_id = ? AND status = 'lost'", [orgId]);
  const averageLeadValue = metric(
    `SELECT COALESCE(AVG(COALESCE(estimated_value,0)),0) AS total FROM leads WHERE org_id = ? AND estimated_value IS NOT NULL AND status NOT IN ('lost')`,
    [orgId],
  );
  const averageDealSize = metric(
    "SELECT COALESCE(AVG(COALESCE(estimated_value,0)),0) AS total FROM leads WHERE org_id = ? AND status = 'won' AND estimated_value IS NOT NULL",
    [orgId],
  );
  const cycleRow = one<{ avg: number | null }>(
    `SELECT AVG(julianday(won_at) - julianday(created_at)) AS avg FROM leads WHERE org_id = ? AND won_at IS NOT NULL`,
    [orgId],
  );

  const contactRate = totalLeads ? Math.round((contacted / totalLeads) * 100) : 0;
  const responseRate = contacted ? Math.round((responded / contacted) * 100) : 0;
  const meetingRate = contacted ? Math.round((meetings / contacted) * 100) : 0;
  const conversionRate = totalLeads ? Math.round((won / totalLeads) * 100) : 0;
  const closeRate = closed ? Math.round((won / closed) * 100) : 0;

  /* ── activity in range ── */
  const activity = {
    newLeads: metric("SELECT COUNT(*) AS total FROM leads WHERE org_id = ? AND created_at >= ?", [orgId, range.from]),
    auditsCompleted: metric("SELECT COUNT(*) AS total FROM website_audits WHERE org_id = ? AND status = 'complete' AND completed_at >= ?", [orgId, range.from]),
    proposalsGenerated: metric("SELECT COUNT(*) AS total FROM proposals WHERE org_id = ? AND created_at >= ?", [orgId, range.from]),
    conversationsStarted: metric("SELECT COUNT(*) AS total FROM conversations WHERE org_id = ? AND created_at >= ?", [orgId, range.from]),
    interestedProspects: metric(
      "SELECT COUNT(*) AS total FROM conversations WHERE org_id = ? AND intent_score >= 60 AND updated_at >= ?",
      [orgId, range.from],
    ),
    qualifiedLeads: metric(
      "SELECT COUNT(*) AS total FROM leads WHERE org_id = ? AND status IN ('qualified','contacted','engaged','interested','proposal_sent','meeting_scheduled','negotiation','won') AND updated_at >= ?",
      [orgId, range.from],
    ),
    alertsGenerated: metric("SELECT COUNT(*) AS total FROM alerts WHERE org_id = ? AND created_at >= ?", [orgId, range.from]),
  };

  /* ── timeline ── */
  const bucketDays = range.days <= 31 ? range.days : Math.ceil(range.days / 30);
  const bucketExpr = range.days <= 31 ? "date(created_at)" : `strftime('%Y-%W', created_at)`;
  const timeline: AnalyticsSummary["timeline"] = [];

  const leadBuckets = bucketMap(
    all<{ bucket: string; count: number }>(
      `SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM leads WHERE org_id = ? AND created_at >= ? GROUP BY bucket`,
      [orgId, range.from],
    ),
  );
  const auditBuckets = bucketMap(
    all<{ bucket: string; count: number }>(
      `SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM website_audits WHERE org_id = ? AND status = 'complete' AND created_at >= ? GROUP BY bucket`,
      [orgId, range.from],
    ),
  );
  const proposalBuckets = bucketMap(
    all<{ bucket: string; count: number }>(
      `SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM proposals WHERE org_id = ? AND created_at >= ? GROUP BY bucket`,
      [orgId, range.from],
    ),
  );
  const conversationBuckets = bucketMap(
    all<{ bucket: string; count: number }>(
      `SELECT ${bucketExpr} AS bucket, COUNT(*) AS count FROM conversations WHERE org_id = ? AND created_at >= ? GROUP BY bucket`,
      [orgId, range.from],
    ),
  );
  const wonBuckets = bucketMap(
    all<{ bucket: string; count: number; revenue: number }>(
      `SELECT ${bucketExpr.replace("created_at", "won_at")} AS bucket, COUNT(*) AS count, COALESCE(SUM(COALESCE(estimated_value,0)),0) AS revenue
       FROM leads WHERE org_id = ? AND won_at IS NOT NULL AND won_at >= ? GROUP BY bucket`,
      [orgId, range.from],
    ),
  );

  for (let i = range.days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86_400_000);
    const key = range.days <= 31 ? date.toISOString().slice(0, 10) : isoWeekKey(date);
    timeline.push({
      date: key,
      leads: leadBuckets.get(key)?.count ?? 0,
      audits: auditBuckets.get(key)?.count ?? 0,
      proposals: proposalBuckets.get(key)?.count ?? 0,
      conversations: conversationBuckets.get(key)?.count ?? 0,
      won: wonBuckets.get(key)?.count ?? 0,
      revenue: wonBuckets.get(key)?.revenue ?? 0,
    });
  }
  void bucketDays;

  /* ── funnel ── */
  const stageRows = all<{ key: string; name: string; position: number; count: number; value: number }>(
    `SELECT s.key, s.name, s.position,
            COUNT(l.id) AS count,
            COALESCE(SUM(COALESCE(l.estimated_value,0)),0) AS value
     FROM lead_stages s LEFT JOIN leads l ON l.stage_key = s.key AND l.org_id = s.org_id
     WHERE s.org_id = ? GROUP BY s.key ORDER BY s.position ASC`,
    [orgId],
  );
  const reached = stageRows.map((row) => row.key);
  const funnel = stageRows.map((row, index) => {
    // Cumulative: anyone at or beyond this stage has "reached" it.
    const beyond = reached.slice(index);
    const count2 = all<{ c: number; v: number }>(
      `SELECT COUNT(*) AS c, COALESCE(SUM(COALESCE(estimated_value,0)),0) AS v FROM leads WHERE org_id = ? AND stage_key IN (${beyond.map(() => "?").join(",")})`,
      [orgId, ...beyond],
    )[0];
    return { stage: row.key, label: row.name, count: count2?.c ?? 0, value: count2?.v ?? 0 };
  });

  /* ── breakdowns ── */
  const topIndustries = all<{ industry: string; leads: number; won: number }>(
    `SELECT COALESCE(b.industry,'Uncategorised') AS industry, COUNT(l.id) AS leads,
            SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS won
     FROM leads l JOIN businesses b ON b.id = l.business_id
     WHERE l.org_id = ? GROUP BY industry ORDER BY leads DESC LIMIT 12`,
    [orgId],
  ).map((row) => ({ ...row, conversionRate: row.leads ? Math.round((row.won / row.leads) * 100) : 0 }));

  const topLocations = all<{ location: string; leads: number; won: number }>(
    `SELECT COALESCE(b.city,'Unknown') AS location, COUNT(l.id) AS leads,
            SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS won
     FROM leads l JOIN businesses b ON b.id = l.business_id
     WHERE l.org_id = ? GROUP BY location ORDER BY leads DESC LIMIT 12`,
    [orgId],
  ).map((row) => ({ ...row, conversionRate: row.leads ? Math.round((row.won / row.leads) * 100) : 0 }));

  const topAgents = all<{ user_id: string; name: string; leads: number; won: number; revenue: number; contacted: number }>(
    `SELECT u.id AS user_id, u.name, COUNT(l.id) AS leads,
            SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) AS won,
            COALESCE(SUM(CASE WHEN l.status = 'won' THEN COALESCE(l.estimated_value,0) ELSE 0 END),0) AS revenue,
            SUM(CASE WHEN l.last_contacted_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted
     FROM users u LEFT JOIN leads l ON l.owner_id = u.id
     WHERE u.org_id = ? GROUP BY u.id HAVING leads > 0 ORDER BY won DESC, leads DESC LIMIT 12`,
    [orgId],
  ).map((row) => ({
    userId: row.user_id,
    name: row.name,
    leads: row.leads,
    won: row.won,
    revenue: row.revenue,
    responseRate: row.leads ? Math.round((row.contacted / row.leads) * 100) : 0,
  }));

  const topCampaigns = all<{
    id: string; name: string; sent: number; replied: number; engaged: number; converted: number;
  }>(
    `SELECT c.id, c.name,
            (SELECT COUNT(*) FROM emails e WHERE e.campaign_id = c.id AND e.direction = 'outbound') AS sent,
            (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.replied_at IS NOT NULL) AS replied,
            (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.engaged = 1) AS engaged,
            (SELECT COUNT(*) FROM campaign_recipients r WHERE r.campaign_id = c.id AND r.state = 'converted') AS converted
     FROM campaigns c WHERE c.org_id = ? ORDER BY sent DESC LIMIT 10`,
    [orgId],
  ).map((row) => ({
    id: row.id,
    name: row.name,
    sent: row.sent,
    replied: row.replied,
    interested: row.engaged,
    converted: row.converted,
    replyRate: row.sent ? Math.round((row.replied / row.sent) * 100) : 0,
  }));

  /* ── today's best opportunities (§71) ── */
  const bestOpportunities = all<{
    lead_id: string; business_id: string; business_name: string; industry: string | null; city: string | null;
    website_url: string | null; website_score: number | null; opportunity_score: number | null;
    lead_score: number | null; temperature: string; rating: number | null; review_count: number;
    next_action: string | null; estimated_value: number | null; currency: string; findings_json: string | null;
  }>(
    `SELECT l.id AS lead_id, b.id AS business_id, b.name AS business_name, b.industry, b.city, b.website_url,
            l.website_score, l.opportunity_score, l.lead_score, l.temperature, b.rating, COALESCE(b.review_count,0) AS review_count,
            l.next_action, l.estimated_value, l.currency,
            (SELECT a.findings_json FROM website_audits a WHERE a.business_id = b.id AND a.status = 'complete' ORDER BY a.created_at DESC LIMIT 1) AS findings_json
     FROM leads l JOIN businesses b ON b.id = l.business_id
     WHERE l.org_id = ? AND l.status NOT IN ('won','lost','not_interested') AND l.opted_out_check IS NULL
     ORDER BY COALESCE(l.lead_score,0) DESC, COALESCE(l.opportunity_score,0) DESC LIMIT 8`,
    [orgId],
  ).map((row) => {
    const findings = row.findings_json ? (JSON.parse(row.findings_json) as { title: string; severity: string }[]) : [];
    const topFinding = findings.find((f) => f.severity === "critical") ?? findings.find((f) => f.severity === "high") ?? findings[0];
    const reviews = row.review_count ?? 0;
    const why = [
      row.website_score === null || row.website_score === undefined
        ? "Website not yet scored — run an audit to quantify the opportunity"
        : row.website_score < 45
          ? `Website scores only ${row.website_score}/100`
          : `Website scores ${row.website_score}/100`,
      reviews >= 30 ? `strong business with ${reviews} public reviews` : reviews > 0 ? `${reviews} public reviews` : "no review data yet",
      topFinding ? `audit finding: ${topFinding.title}` : null,
    ].filter(Boolean).join(" · ");

    return {
      leadId: row.lead_id,
      businessId: row.business_id,
      businessName: row.business_name,
      industry: row.industry,
      city: row.city,
      websiteUrl: row.website_url,
      websiteScore: row.website_score,
      opportunityScore: row.opportunity_score,
      leadScore: row.lead_score,
      temperature: row.temperature as Temperature,
      rating: row.rating,
      reviewCount: reviews,
      whyThisLead: why,
      recommendedAction: row.next_action ?? "Review the audit findings and send a personalised proposal.",
      topFinding: topFinding?.title ?? null,
      estimatedValue: row.estimated_value,
      currency: row.currency,
    };
  });

  return {
    leads: {
      total: totalLeads,
      byStatus,
      newThisWeek,
      newThisMonth,
      hot: temperature.get("hot") ?? 0,
      warm: temperature.get("warm") ?? 0,
      cold: temperature.get("cold") ?? 0,
      uncontacted,
      followedUpDue,
    },
    websites: {
      withoutWebsite,
      poor,
      outdated,
      slow,
      poorMobile,
      poorSeo,
      highOpportunity,
      audited,
      averageScore: averageScore === null ? null : Math.round(averageScore),
    },
    sales: {
      proposalsSent,
      proposalsOpened,
      proposalOpenRate: proposalsSent ? Math.round((proposalsOpened / proposalsSent) * 100) : 0,
      proposalsAccepted,
      proposalAcceptanceRate: proposalsOpened ? Math.round((proposalsAccepted / proposalsOpened) * 100) : 0,
      conversionRate,
      contactRate,
      responseRate,
      meetingRate,
      closeRate,
      averageLeadValue: Math.round(averageLeadValue),
      pipelineValue,
      wonRevenue,
      lostRevenue,
      averageDealSize: Math.round(averageDealSize),
      averageSalesCycleDays: cycleRow?.avg ? Math.round(cycleRow.avg) : 0,
    },
    activity,
    timeline,
    funnel,
    topIndustries,
    topLocations,
    topAgents,
    topCampaigns,
    bestOpportunities,
  };
}

function count(sql: string, params: unknown[]): number {
  return one<{ c: number }>(sql, params)?.c ?? 0;
}

function metric(sql: string, params: unknown[]): number {
  return one<{ total: number }>(sql, params)?.total ?? 0;
}

function bucketMap(rows: { bucket: string; count: number; revenue?: number }[]): Map<string, { count: number; revenue: number }> {
  const map = new Map<string, { count: number; revenue: number }>();
  rows.forEach((row) => {
    if (!row.bucket) return;
    const key = row.bucket.length > 10 ? row.bucket : row.bucket;
    map.set(key, { count: row.count, revenue: row.revenue ?? 0 });
  });
  return map;
}

function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The single answer to "what should I do next?" (§70). */
export function nextBestActions(orgId: string): { label: string; detail: string; count: number; href: string; urgency: "critical" | "high" | "normal" }[] {
  const hotUncontacted = count(
    "SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND temperature = 'hot' AND last_contacted_at IS NULL AND status NOT IN ('won','lost')",
    [orgId],
  );
  const interestedNoReply = count(
    "SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND intent_score >= 70 AND status NOT IN ('won','lost') AND (last_contacted_at IS NULL OR last_contacted_at < datetime('now','-2 days'))",
    [orgId],
  );
  const proposalsOpenedNoReply = count(
    "SELECT COUNT(*) AS c FROM proposals p JOIN leads l ON l.id = p.lead_id WHERE p.org_id = ? AND p.view_count > 0 AND p.accepted_at IS NULL AND p.declined_at IS NULL AND l.status = 'proposal_sent'",
    [orgId],
  );
  const followUpsDue = count(
    "SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND next_follow_up_at IS NOT NULL AND next_follow_up_at <= datetime('now') AND status NOT IN ('won','lost')",
    [orgId],
  );
  const unscored = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND lead_score IS NULL", [orgId]);
  const unaudited = count(
    "SELECT COUNT(*) AS c FROM leads l WHERE l.org_id = ? AND NOT EXISTS (SELECT 1 FROM website_audits a WHERE a.business_id = l.business_id AND a.status = 'complete')",
    [orgId],
  );

  return [
    { label: "Call hot leads now", detail: "Hot leads who have never been contacted. Highest conversion probability in the pipeline.", count: hotUncontacted, href: "/leads?temperature=hot&notContacted=1", urgency: "critical" },
    { label: "Respond to high-intent prospects", detail: "Prospects showing strong buying intent without a reply in the last 48 hours.", count: interestedNoReply, href: "/conversations?minIntent=70", urgency: "critical" },
    { label: "Follow up on opened proposals", detail: "Proposals the prospect has read but not yet responded to.", count: proposalsOpenedNoReply, href: "/proposals?status=proposal_sent&opened=1", urgency: "high" },
    { label: "Clear overdue follow-ups", detail: "Scheduled follow-ups that are now past due.", count: followUpsDue, href: "/tasks?overdue=1", urgency: "high" },
    { label: "Audit unscored leads", detail: "Leads without a website audit cannot be accurately prioritised.", count: unaudited, href: "/lead-finder?view=unaudited", urgency: "normal" },
    { label: "Recalculate lead scores", detail: "Leads missing a score (newly imported or recently changed).", count: unscored, href: "/leads?unscored=1", urgency: "normal" },
  ].filter((action) => action.count > 0) as { label: string; detail: string; count: number; href: string; urgency: "critical" | "high" | "normal" }[];
}

export function opportunityFunnel(orgId: string): { label: string; value: number }[] {
  const discovered = count("SELECT COUNT(*) AS c FROM businesses WHERE org_id = ?", [orgId]);
  const audited = count("SELECT COUNT(DISTINCT business_id) AS c FROM website_audits WHERE org_id = ? AND status = 'complete'", [orgId]);
  const qualified = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND lead_score >= 60", [orgId]);
  const contacted = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND last_contacted_at IS NOT NULL", [orgId]);
  const engaged = count("SELECT COUNT(DISTINCT l.id) AS c FROM leads l JOIN conversations c ON c.lead_id = l.id WHERE l.org_id = ? AND c.message_count > 1", [orgId]);
  const interested = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND intent_score >= 60", [orgId]);
  const proposals = count("SELECT COUNT(*) AS c FROM proposals WHERE org_id = ? AND sent_at IS NOT NULL", [orgId]);
  const won = count("SELECT COUNT(*) AS c FROM leads WHERE org_id = ? AND status = 'won'", [orgId]);

  return [
    { label: "Discovered", value: discovered },
    { label: "Audited", value: audited },
    { label: "Qualified", value: qualified },
    { label: "Contacted", value: contacted },
    { label: "Engaged", value: engaged },
    { label: "Interested", value: interested },
    { label: "Proposal sent", value: proposals },
    { label: "Won", value: won },
  ];
}

export type { OpportunityCard };
