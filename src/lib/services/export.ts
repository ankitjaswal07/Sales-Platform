import "server-only";

import { listLeads, listActivities, type LeadFilter } from "../db/repo/lead";
import { listBusinesses, listContacts, businessFacets } from "../db/repo/business";
import { listAudits, latestAuditForBusiness } from "../db/repo/business";
import { listProposals, listEmails, listConversations } from "../db/repo/engagement";
import { listTasks, listProjects, listServices, listPricingPlans, writeAuditLog } from "../db/repo/ops";
import { analyticsSummary, rangeFor } from "../db/repo/analytics";
import { toLeadViews } from "./lead-view";
import { organizationProfile } from "./org-profile";

/**
 * Data export (§59).
 *
 * CSV is generated server-side with correct quoting and a UTF-8 BOM so Excel
 * opens it cleanly. Every export writes an audit-log entry — exports of customer
 * data are exactly the kind of action that should leave a trail.
 */

export interface ExportColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
}

export interface ExportResult {
  filename: string;
  contentType: string;
  body: string;
  rowCount: number;
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[], options: { bom?: boolean } = {}): string {
  const header = columns.map((column) => escapeCsv(column.label)).join(",");
  const body = rows
    .map((row) => columns.map((column) => escapeCsv(formatCell(column.value(row)))).join(","))
    .join("\r\n");
  const csv = `${header}\r\n${body}`;
  return options.bom === false ? csv : `\uFEFF${csv}`;
}

function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  return value;
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export const LEAD_COLUMNS: ExportColumn<ReturnType<typeof toLeadViews>[number]>[] = [
  { key: "reference", label: "Reference", value: (lead) => lead.reference },
  { key: "business", label: "Business", value: (lead) => lead.businessName },
  { key: "contact", label: "Contact", value: (lead) => lead.contactName },
  { key: "email", label: "Email", value: (lead) => lead.email },
  { key: "phone", label: "Phone", value: (lead) => lead.phone },
  { key: "industry", label: "Industry", value: (lead) => lead.industry },
  { key: "city", label: "City", value: (lead) => lead.city },
  { key: "country", label: "Country", value: (lead) => lead.country },
  { key: "website", label: "Website", value: (lead) => lead.websiteUrl },
  { key: "website_score", label: "Website score", value: (lead) => lead.websiteScore },
  { key: "opportunity_score", label: "Opportunity score", value: (lead) => lead.opportunityScore },
  { key: "lead_score", label: "Lead score", value: (lead) => lead.leadScore },
  { key: "temperature", label: "Temperature", value: (lead) => lead.temperature },
  { key: "status", label: "Status", value: (lead) => lead.status },
  { key: "intent", label: "Intent", value: (lead) => lead.intent },
  { key: "intent_score", label: "Intent score", value: (lead) => lead.intentScore },
  { key: "value", label: "Estimated value", value: (lead) => lead.estimatedValue },
  { key: "currency", label: "Currency", value: (lead) => lead.currency },
  { key: "owner", label: "Owner", value: (lead) => lead.ownerName },
  { key: "rating", label: "Public rating", value: (lead) => lead.rating },
  { key: "reviews", label: "Review count", value: (lead) => lead.reviewCount },
  { key: "tags", label: "Tags", value: (lead) => lead.tags.join("; ") },
  { key: "next_action", label: "Next action", value: (lead) => lead.nextAction },
  { key: "last_contacted", label: "Last contacted", value: (lead) => lead.lastContactedAt },
  { key: "last_activity", label: "Last activity", value: (lead) => lead.lastActivityAt },
  { key: "follow_up", label: "Next follow-up", value: (lead) => lead.nextFollowUpAt },
];

export function exportLeads(orgId: string, actorId: string | null, filter: LeadFilter = {}, format: "csv" | "json" = "csv"): ExportResult {
  const leads = toLeadViews(listLeads(orgId, { ...filter, limit: Math.min(filter.limit ?? 5000, 5000) }).items);

  writeAuditLog(orgId, {
    actorUserId: actorId,
    actorType: "user",
    action: "data.export",
    entityType: "lead",
    entityId: null,
    meta: { rows: leads.length, format, filters: filter },
  });

  if (format === "json") {
    return {
      filename: `leads-${stamp()}.json`,
      contentType: "application/json",
      body: JSON.stringify({ exportedAt: new Date().toISOString(), count: leads.length, leads }, null, 2),
      rowCount: leads.length,
    };
  }

  return {
    filename: `leads-${stamp()}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: toCsv(leads, LEAD_COLUMNS),
    rowCount: leads.length,
  };
}

export function exportBusinesses(orgId: string, actorId: string | null, filter: { search?: string; limit?: number } = {}): ExportResult {
  const { items } = listBusinesses(orgId, { ...filter, limit: Math.min(filter.limit ?? 5000, 5000) });
  const columns: ExportColumn<typeof items[number]>[] = [
    { key: "name", label: "Business", value: (row) => row.name },
    { key: "industry", label: "Industry", value: (row) => row.industry },
    { key: "category", label: "Category", value: (row) => row.category },
    { key: "address", label: "Address", value: (row) => row.addressLine1 },
    { key: "city", label: "City", value: (row) => row.city },
    { key: "country", label: "Country", value: (row) => row.country },
    { key: "postcode", label: "Postcode", value: (row) => row.postalCode },
    { key: "phone", label: "Phone", value: (row) => row.phone },
    { key: "email", label: "Email", value: (row) => row.email },
    { key: "website", label: "Website", value: (row) => row.websiteUrl },
    { key: "website_status", label: "Website status", value: (row) => row.websiteStatus },
    { key: "rating", label: "Rating", value: (row) => row.rating },
    { key: "reviews", label: "Reviews", value: (row) => row.reviewCount },
    { key: "employees", label: "Employees", value: (row) => row.employeeRange },
    { key: "years", label: "Years in business", value: (row) => row.yearsInBusiness },
    { key: "source", label: "Data source", value: (row) => row.dataSource },
    { key: "confidence", label: "Data confidence", value: (row) => row.dataConfidence },
  ];

  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "business", entityId: null, meta: { rows: items.length } });

  return { filename: `businesses-${stamp()}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(items, columns), rowCount: items.length };
}

export function exportContacts(orgId: string, actorId: string | null): ExportResult {
  const contacts = listContacts(orgId, { limit: 5000 });
  const columns: ExportColumn<typeof contacts[number]>[] = [
    { key: "name", label: "Name", value: (row) => row.name },
    { key: "title", label: "Role", value: (row) => row.title },
    { key: "email", label: "Email", value: (row) => row.email },
    { key: "email_status", label: "Email status", value: (row) => row.emailStatus },
    { key: "phone", label: "Phone", value: (row) => row.phone },
    { key: "source", label: "Source", value: (row) => row.source },
    { key: "primary", label: "Primary", value: (row) => (row.isPrimary ? "yes" : "no") },
    { key: "verified", label: "Last verified", value: (row) => row.lastVerifiedAt },
  ];
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "contact", entityId: null, meta: { rows: contacts.length } });
  return { filename: `contacts-${stamp()}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(contacts, columns), rowCount: contacts.length };
}

export function exportProposals(orgId: string, actorId: string | null): ExportResult {
  const { items } = listProposals(orgId, { limit: 2000 });
  const columns: ExportColumn<typeof items[number]>[] = [
    { key: "number", label: "Proposal", value: (row) => row.number },
    { key: "title", label: "Title", value: (row) => row.title },
    { key: "business", label: "Business", value: (row) => row.businessName },
    { key: "contact", label: "Contact", value: (row) => row.contactName },
    { key: "status", label: "Status", value: (row) => row.status },
    { key: "total", label: "Total", value: (row) => row.total },
    { key: "currency", label: "Currency", value: (row) => row.currency },
    { key: "sent", label: "Sent", value: (row) => row.sentAt },
    { key: "viewed", label: "First viewed", value: (row) => row.viewedAt },
    { key: "views", label: "View count", value: (row) => row.viewCount },
    { key: "time_spent", label: "Time spent (s)", value: (row) => row.timeSpentSeconds },
    { key: "accepted", label: "Accepted", value: (row) => row.acceptedAt },
    { key: "valid_until", label: "Valid until", value: (row) => row.validUntil },
  ];
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "proposal", entityId: null, meta: { rows: items.length } });
  return { filename: `proposals-${stamp()}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(items, columns), rowCount: items.length };
}

export function exportAudits(orgId: string, actorId: string | null): ExportResult {
  const { items } = listAudits(orgId, { limit: 2000 });
  const columns: ExportColumn<typeof items[number]>[] = [
    { key: "business", label: "Business", value: (row) => row.businessId },
    { key: "url", label: "Website", value: (row) => row.url },
    { key: "status", label: "Status", value: (row) => row.status },
    { key: "overall", label: "Overall", value: (row) => row.overallScore },
    { key: "performance", label: "Performance", value: (row) => row.performance },
    { key: "mobile", label: "Mobile", value: (row) => row.mobile },
    { key: "seo", label: "SEO", value: (row) => row.seo },
    { key: "ux", label: "UX", value: (row) => row.ux },
    { key: "accessibility", label: "Accessibility", value: (row) => row.accessibility },
    { key: "conversion", label: "Conversion", value: (row) => row.conversion },
    { key: "technical", label: "Technical", value: (row) => row.technical },
    { key: "content", label: "Content", value: (row) => row.content },
    { key: "findings", label: "Findings", value: (row) => row.findings.length },
    { key: "completed", label: "Completed", value: (row) => row.completedAt },
  ];
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "audit", entityId: null, meta: { rows: items.length } });
  return { filename: `audits-${stamp()}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(items, columns), rowCount: items.length };
}

export function exportConversations(orgId: string, actorId: string | null): ExportResult {
  const { items } = listConversations(orgId, { limit: 1000 });
  const columns: ExportColumn<typeof items[number]>[] = [
    { key: "business", label: "Business", value: (row) => row.businessName },
    { key: "contact", label: "Contact", value: (row) => row.contactName },
    { key: "channel", label: "Channel", value: (row) => row.channel },
    { key: "status", label: "Status", value: (row) => row.status },
    { key: "intent", label: "Intent", value: (row) => row.intent },
    { key: "intent_score", label: "Intent score", value: (row) => row.intentScore },
    { key: "messages", label: "Messages", value: (row) => row.messageCount },
    { key: "ai_enabled", label: "AI enabled", value: (row) => (row.aiEnabled ? "yes" : "no") },
    { key: "summary", label: "Summary", value: (row) => row.summary },
    { key: "last_message", label: "Last message", value: (row) => row.lastMessageAt },
  ];
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "conversation", entityId: null, meta: { rows: items.length } });
  return { filename: `conversations-${stamp()}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(items, columns), rowCount: items.length };
}

export function exportTasks(orgId: string, actorId: string | null): ExportResult {
  const { items } = listTasks(orgId, { limit: 2000 });
  const columns: ExportColumn<typeof items[number]>[] = [
    { key: "title", label: "Task", value: (row) => row.title },
    { key: "type", label: "Type", value: (row) => row.type },
    { key: "priority", label: "Priority", value: (row) => row.priority },
    { key: "status", label: "Status", value: (row) => row.status },
    { key: "due", label: "Due", value: (row) => row.dueAt },
    { key: "assignee", label: "Assignee", value: (row) => row.assigneeName },
    { key: "business", label: "Business", value: (row) => row.businessName },
    { key: "completed", label: "Completed", value: (row) => row.completedAt },
  ];
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "task", entityId: null, meta: { rows: items.length } });
  return { filename: `tasks-${stamp()}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(items, columns), rowCount: items.length };
}

export function exportEmails(orgId: string, actorId: string | null): ExportResult {
  const { items } = listEmails(orgId, { limit: 5000 });
  const columns: ExportColumn<typeof items[number]>[] = [
    { key: "to", label: "To", value: (row) => row.toAddress },
    { key: "subject", label: "Subject", value: (row) => row.subject },
    { key: "status", label: "Status", value: (row) => row.status },
    { key: "provider", label: "Provider", value: (row) => row.provider },
    { key: "style", label: "Style", value: (row) => row.style },
    { key: "sent", label: "Sent", value: (row) => row.sentAt },
    { key: "opened", label: "Opened", value: (row) => row.openedAt },
    { key: "replied", label: "Replied", value: (row) => row.repliedAt },
    { key: "error", label: "Error", value: (row) => row.error },
  ];
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "email", entityId: null, meta: { rows: items.length } });
  return { filename: `outreach-emails-${stamp()}.csv`, contentType: "text/csv; charset=utf-8", body: toCsv(items, columns), rowCount: items.length };
}

export function exportAnalytics(orgId: string, actorId: string | null, days = 30): ExportResult {
  const range = rangeFor(days);
  const summary = analyticsSummary(orgId, range);
  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export", entityType: "analytics", entityId: null, meta: { days } });

  const rows = [
    { metric: "Leads", value: summary.leads.total },
    { metric: "Hot leads", value: summary.leads.hot },
    { metric: "Warm leads", value: summary.leads.warm },
    { metric: "Cold leads", value: summary.leads.cold },
    { metric: "Uncontacted", value: summary.leads.uncontacted },
    { metric: "New this week", value: summary.leads.newThisWeek },
    { metric: "New this month", value: summary.leads.newThisMonth },
    { metric: "Websites audited", value: summary.websites.audited },
    { metric: "Without a website", value: summary.websites.withoutWebsite },
    { metric: "Poor websites", value: summary.websites.poor },
    { metric: "Slow websites", value: summary.websites.slow },
    { metric: "Poor mobile experience", value: summary.websites.poorMobile },
    { metric: "Poor SEO", value: summary.websites.poorSeo },
    { metric: "High-opportunity sites", value: summary.websites.highOpportunity },
    { metric: "Average website score", value: summary.websites.averageScore },
    { metric: "Proposals sent", value: summary.sales.proposalsSent },
    { metric: "Proposals opened", value: summary.sales.proposalsOpened },
    { metric: "Proposals accepted", value: summary.sales.proposalsAccepted },
    { metric: "Conversion rate %", value: summary.sales.conversionRate },
    { metric: "Contact rate %", value: summary.sales.contactRate },
    { metric: "Response rate %", value: summary.sales.responseRate },
    { metric: "Meeting rate %", value: summary.sales.meetingRate },
    { metric: "Close rate %", value: summary.sales.closeRate },
    { metric: "Average lead value", value: summary.sales.averageLeadValue },
    { metric: "Pipeline value", value: summary.sales.pipelineValue },
    { metric: "Won revenue", value: summary.sales.wonRevenue },
    { metric: "Average deal size", value: summary.sales.averageDealSize },
    { metric: "Average sales cycle (days)", value: summary.sales.averageSalesCycleDays },
  ];

  return {
    filename: `analytics-${days}d-${stamp()}.csv`,
    contentType: "text/csv; charset=utf-8",
    body: toCsv(rows, [
      { key: "metric", label: "Metric", value: (row) => row.metric },
      { key: "value", label: "Value", value: (row) => row.value },
    ]),
    rowCount: rows.length,
  };
}

/** Everything, for "export my data" (§63). Provided as one JSON document. */
export function exportEverything(orgId: string, actorId: string | null): ExportResult {
  const profile = organizationProfile(orgId);
  const payload = {
    exportedAt: new Date().toISOString(),
    notice:
      "This archive contains every record LeadForge holds for this workspace. Contact details were collected from public sources or entered by the team; review your retention obligations before sharing it.",
    organization: profile,
    businesses: listBusinesses(orgId, { limit: 10_000 }).items,
    contacts: listContacts(orgId, { limit: 10_000 }),
    facets: businessFacets(orgId),
    leads: toLeadViews(listLeads(orgId, { limit: 10_000 }).items),
    activities: listActivities(orgId, { limit: 10_000 }),
    audits: listAudits(orgId, { limit: 5_000 }).items,
    proposals: listProposals(orgId, { limit: 5_000 }).items,
    conversations: listConversations(orgId, { limit: 5_000 }).items,
    emails: listEmails(orgId, { limit: 5_000 }).items,
    tasks: listTasks(orgId, { limit: 5_000 }).items,
    projects: listProjects(orgId, { limit: 1_000 }).items,
    services: listServices(orgId, true),
    pricingPlans: listPricingPlans(orgId, true),
    analytics: analyticsSummary(orgId, rangeFor(365)),
  };

  writeAuditLog(orgId, { actorUserId: actorId, actorType: "user", action: "data.export_all", entityType: "organization", entityId: orgId, meta: { scope: "full_archive" } });

  return {
    filename: `leadforge-archive-${stamp()}.json`,
    contentType: "application/json",
    body: JSON.stringify(payload, null, 2),
    rowCount:
      payload.businesses.length + payload.contacts.length + payload.leads.length + payload.audits.length + payload.proposals.length + payload.conversations.length,
  };
}

export function auditForLead(orgId: string, businessId: string) {
  return latestAuditForBusiness(orgId, businessId);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}
