import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Globe,
  Mail,
  MapPin,
  Phone,
  Star,
  History,
  ListChecks,
  MessagesSquare,
} from "lucide-react";
import { currentSession } from "@/lib/auth/session";
import { getLead, latestLeadScore, leadTimeline } from "@/lib/db/repo/lead";
import { latestAuditForBusiness, listContacts, websiteForBusiness } from "@/lib/db/repo/business";
import { listProposals, listConversations } from "@/lib/db/repo/engagement";
import { toLeadView } from "@/lib/services/lead-view";
import { OpportunityActions } from "@/components/dashboard/opportunity-actions";
import {
  Avatar,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Detail,
  EmptyState,
  Progress,
  type BadgeTone,
} from "@/components/ui/primitives";
import { INTENT_META, LEAD_STATUS_META, TEMPERATURE_META, WEBSITE_STATUS_META, type AuditFinding } from "@/lib/types";
import { cn, formatDate, formatMoney, formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Lead" };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return null;
  const { organization } = session;

  const { id } = await params;
  const lead = getLead(organization.id, id);
  if (!lead) notFound();

  const view = toLeadView(lead);
  const score = latestLeadScore(organization.id, lead.id);
  const latestAudit = lead.businessId ? latestAuditForBusiness(organization.id, lead.businessId) : null;
  const website = lead.businessId ? websiteForBusiness(organization.id, lead.businessId) : null;
  const contacts = lead.businessId ? listContacts(organization.id, { businessId: lead.businessId, limit: 8 }) : [];
  const timeline = leadTimeline(organization.id, lead.id, 25);
  const proposals = listProposals(organization.id, { leadId: lead.id, limit: 5 }).items;
  const conversations = listConversations(organization.id, { limit: 200 }).items.filter((c) => c.leadId === lead.id);

  const findings = ((latestAudit?.findings ?? []) as AuditFinding[]).filter((finding) => finding.severity !== "positive");
  const statusMeta = LEAD_STATUS_META[view.status];
  const temperatureMeta = TEMPERATURE_META[view.temperature];
  const intentMeta = INTENT_META[view.intent];

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        All leads
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Avatar name={view.businessName} className="size-11 text-xs" />
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{view.businessName}</h1>
              <Badge tone={(statusMeta?.tone ?? "neutral") as BadgeTone}>{statusMeta?.label ?? view.status}</Badge>
              <Badge tone={view.temperature === "hot" ? "ember" : view.temperature === "warm" ? "warning" : "neutral"}>
                {temperatureMeta?.label ?? view.temperature}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {[view.industry, view.city, view.country].filter(Boolean).join(" · ") || "Location unknown"}
              {view.rating ? ` · ${view.rating.toFixed(1)}★ from ${view.reviewCount} reviews` : ""}
            </p>
            <p className="text-2xs text-subtle-foreground">
              Lead {view.reference} · created {formatDate(lead.createdAt)} · last activity{" "}
              {formatRelative(view.lastActivityAt)}
            </p>
          </div>
        </div>

        <OpportunityActions
          leadId={lead.id}
          businessName={view.businessName}
          hasProposal={proposals.length > 0}
          proposalId={proposals[0]?.id ?? null}
          hasConversation={conversations.length > 0}
          conversationId={conversations[0]?.id ?? null}
        />
      </div>

      {/* ── Scores ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Why this lead scores {Math.round(view.leadScore)}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {score?.reason ?? "No score has been computed yet — run a re-score to generate one."}
              </p>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 pt-2 sm:grid-cols-5">
            {[
              { label: "Business quality", value: view.businessQuality },
              { label: "Website opportunity", value: view.opportunityScore },
              { label: "Buying potential", value: view.buyingPotential },
              { label: "Contactability", value: view.contactability },
              { label: "Buying intent", value: view.intentScore },
            ].map((metric) => (
              <div key={metric.label} className="space-y-1.5">
                <p className="text-2xs uppercase tracking-wide text-subtle-foreground">{metric.label}</p>
                <p className="text-lg font-semibold tracking-tight">{metric.value === null ? "—" : Math.round(metric.value)}</p>
                <Progress
                  value={metric.value ?? 0}
                  tone={metric.value === null ? "neutral" : metric.value >= 70 ? "success" : metric.value >= 45 ? "warning" : "danger"}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Website</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2 text-sm">
            {view.websiteUrl ? (
              <>
                <a
                  href={view.websiteUrl}
                  target="_blank"
                  rel="noreferrer nofollow"
                  className="inline-flex items-center gap-1.5 break-all text-xs font-medium text-primary hover:underline"
                >
                  <Globe className="size-3.5 shrink-0" />
                  {view.websiteUrl}
                </a>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      view.websiteStatus === "none" || view.websiteStatus === "very_poor" || view.websiteStatus === "broken"
                        ? "danger"
                        : view.websiteStatus === "poor"
                          ? "warning"
                          : "success"
                    }
                  >
                    {WEBSITE_STATUS_META[view.websiteStatus as keyof typeof WEBSITE_STATUS_META]?.label ?? view.websiteStatus}
                  </Badge>
                  {view.websiteScore !== null ? <Badge tone="neutral">Score {Math.round(view.websiteScore)}/100</Badge> : null}
                </div>
                {website?.cms ? <p className="text-2xs text-subtle-foreground">Platform: {website.cms}</p> : null}
                {latestAudit ? (
                  <p className="text-2xs text-subtle-foreground">
                    Audited {formatRelative(latestAudit.createdAt)}
                    {latestAudit.mode === "modelled" ? " using modelled demo data — no live crawl was performed" : ""}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No website on record. This is the strongest possible pitch: the business is invisible to search.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-2">
            <Detail label="Estimated value">
              <span className="font-medium">{formatMoney(view.estimatedValue, view.currency)}</span>
              <span className="ml-1 text-2xs text-subtle-foreground">internal estimate</span>
            </Detail>
            <Detail label="Owner">{view.ownerName ?? "Unassigned"}</Detail>
            <Detail label="Buying intent">
              {intentMeta?.label ?? view.intent} ({Math.round(view.intentScore)}/100)
            </Detail>
            <Detail label="Next action">{view.nextAction ?? "—"}</Detail>
            <Detail label="Next follow-up">
              {view.nextFollowUpAt ? formatDate(view.nextFollowUpAt) : "Not scheduled"}
            </Detail>
            {view.tags.length ? (
              <div className="flex flex-wrap gap-1">
                {view.tags.map((tag) => (
                  <Badge key={tag} tone="neutral">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* ── Findings, contacts, timeline ──────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="size-3.5" />
                Audit findings
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {findings.length
                  ? `${findings.length} issues ranked by severity — each one is a talking point, not a claim.`
                  : "No audit findings stored for this business yet."}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pt-2">
            {findings.length === 0 ? (
              <EmptyState
                icon={<Globe className="size-5" />}
                title="Nothing measured yet"
                description="Run an audit to populate this section. The platform never invents a finding it did not measure."
              />
            ) : (
              findings.slice(0, 8).map((finding) => (
                <div key={finding.id} className="rounded-lg border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        finding.severity === "critical"
                          ? "danger"
                          : finding.severity === "high"
                            ? "ember"
                            : finding.severity === "medium"
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {finding.severity}
                    </Badge>
                    <p className="text-xs font-medium">{finding.title}</p>
                    <span className="ml-auto text-2xs text-subtle-foreground">{finding.dimension}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{finding.detail}</p>
                  {finding.evidence ? (
                    <p className="mt-1 font-mono text-[10px] text-subtle-foreground">evidence: {finding.evidence}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-3.5" />
                Contacts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 pt-2">
              {contacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No contact on record yet. Discovery stores only publicly listed business contact details.
                </p>
              ) : (
                contacts.map((contact) => (
                  <div key={contact.id} className="flex items-start gap-2.5 rounded-md px-1 py-1">
                    <Avatar name={contact.name} className="size-7 text-[10px]" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">
                        {contact.name}
                        {contact.isPrimary ? <span className="ml-1 text-2xs text-subtle-foreground">primary</span> : null}
                      </p>
                      {contact.title ? <p className="truncate text-2xs text-muted-foreground">{contact.title}</p> : null}
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-2xs text-muted-foreground">
                        {contact.email ? (
                          <span className="inline-flex items-center gap-1">
                            <Mail className="size-2.5" />
                            {contact.email}
                          </span>
                        ) : null}
                        {contact.phone ? (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="size-2.5" />
                            {contact.phone}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                ))
              )}
              {view.address ? (
                <p className="mt-2 flex items-start gap-1.5 border-t border-border pt-2 text-2xs text-subtle-foreground">
                  <MapPin className="mt-px size-3 shrink-0" />
                  {view.address}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-3.5" />
                Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-2">
              {timeline.length === 0 ? (
                <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
              ) : (
                timeline.slice(0, 8).map((event) => (
                  <div key={event.id} className="flex gap-2.5">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{event.label}</p>
                      {event.detail ? <p className="text-2xs text-muted-foreground">{event.detail}</p> : null}
                      <p className="text-[10px] text-subtle-foreground">
                        {formatRelative(event.at)}
                        {event.actor ? ` · ${event.actor}` : ""}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {proposals.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Proposals</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-2">
                {proposals.map((proposal) => (
                  <Link
                    key={proposal.id}
                    href={`/proposals/${proposal.id}`}
                    className="flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{proposal.number}</span>
                      <span className="block text-2xs text-muted-foreground">
                        {formatMoney(proposal.total, proposal.currency)} · v{proposal.version}
                      </span>
                    </span>
                    <Badge tone={proposal.status === "accepted" ? "success" : proposal.status === "declined" ? "danger" : "info"}>
                      {proposal.status.replace(/_/g, " ")}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessagesSquare className="size-3.5" />
                Conversations
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No conversation yet. The AI agent introduces itself as AI and hands over the moment the thread turns
                  commercial.
                </p>
              ) : (
                conversations.map((conversation) => (
                  <Link
                    key={conversation.id}
                    href={`/conversations/${conversation.id}`}
                    className={cn("flex items-center justify-between gap-2 rounded-md px-1 py-1.5 hover:bg-surface-muted")}
                  >
                    <span className="text-xs">
                      {conversation.channel.replace(/_/g, " ")} · intent {Math.round(conversation.intentScore)}
                    </span>
                    <Badge tone={conversation.status === "human_takeover" ? "ember" : "info"}>
                      {conversation.status.replace(/_/g, " ")}
                    </Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {view.rating ? (
            <p className="flex items-center gap-1.5 px-1 text-2xs text-subtle-foreground">
              <Star className="size-3" />
              Public rating {view.rating.toFixed(1)} from {view.reviewCount} reviews — stored as discovered, never adjusted.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
