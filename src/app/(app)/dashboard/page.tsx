import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CircleDollarSign,
  Flame,
  Gauge,
  MessagesSquare,
  FileText,
  CheckCircle2,
  Circle,
  Radar,
} from "lucide-react";
import { currentSession } from "@/lib/auth/session";
import { buildBriefing } from "@/lib/services/briefing";
import { listConversations, listProposals } from "@/lib/db/repo/engagement";
import { OpportunityActions } from "@/components/dashboard/opportunity-actions";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Progress,
} from "@/components/ui/primitives";
import { TEMPERATURE_META, WEBSITE_STATUS_META } from "@/lib/types";
import { cn, formatMoney, formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

const RANGES = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await currentSession();
  if (!session) return null;

  const { organization, user } = session;
  const requested = Number((await searchParams).range);
  const rangeDays = RANGES.some((range) => range.days === requested) ? requested : 30;

  const briefing = buildBriefing(organization.id, { userId: user.id, userName: user.name ?? null, rangeDays });
  const proposals = listProposals(organization.id, { limit: 300 }).items;
  const conversations = listConversations(organization.id, { limit: 300 }).items;

  const proposalByLead = new Map(proposals.filter((p) => p.leadId).map((p) => [p.leadId as string, p]));
  const conversationByLead = new Map(
    conversations.filter((c) => c.leadId).map((c) => [c.leadId as string, c]),
  );

  const { metrics, setup } = briefing;

  const tiles = [
    {
      label: "Hot leads",
      value: String(metrics.hotLeads),
      hint: `${metrics.uncontactedHot} not contacted yet`,
      icon: Flame,
      tone: "ember" as const,
    },
    {
      label: "Proposals outstanding",
      value: String(metrics.proposalsOutstanding),
      hint: "Sent or approved, awaiting a decision",
      icon: FileText,
      tone: "brand" as const,
    },
    {
      label: "Conversations waiting",
      value: String(metrics.conversationsWaiting),
      hint: "Prospect replied, agent should answer",
      icon: MessagesSquare,
      tone: "info" as const,
    },
    {
      label: "Overdue tasks",
      value: String(metrics.overdueTasks),
      hint: "Follow-ups past their due time",
      icon: CalendarClock,
      tone: metrics.overdueTasks > 0 ? ("danger" as const) : ("neutral" as const),
    },
    {
      label: "Open pipeline",
      value: formatMoney(metrics.pipelineValue, metrics.currency),
      hint: "Value of every open lead",
      icon: CircleDollarSign,
      tone: "success" as const,
    },
    {
      label: "New this range",
      value: String(metrics.newLeadsThisWeek),
      hint: `Leads created in the last ${rangeDays === 1 ? "day" : `${rangeDays} days`}`,
      icon: Radar,
      tone: "neutral" as const,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{briefing.greeting}</h1>
            {briefing.urgencyCount > 0 ? (
              <Badge tone="ember" className="animate-pulse-ring">
                {briefing.urgencyCount} need attention now
              </Badge>
            ) : (
              <Badge tone="success">Nothing critical outstanding</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{briefing.headline}</p>
          <p className="text-xs text-subtle-foreground">{briefing.subline}</p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          {RANGES.map((range) => (
            <Link
              key={range.days}
              href={range.days === 30 ? "/dashboard" : `/dashboard?range=${range.days}`}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                rangeDays === range.days ? "bg-surface-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {range.label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Metrics ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label} className="animate-rise">
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-2xs uppercase tracking-wide text-subtle-foreground">{tile.label}</p>
                  <Icon
                    className={cn(
                      "size-3.5",
                      tile.tone === "ember" && "text-ember",
                      tile.tone === "danger" && "text-danger",
                      tile.tone === "brand" && "text-primary",
                      tile.tone === "info" && "text-info",
                      tile.tone === "success" && "text-success",
                      tile.tone === "neutral" && "text-subtle-foreground",
                    )}
                  />
                </div>
                <p className="text-2xl font-semibold tracking-tight">{tile.value}</p>
                <p className="text-2xs text-muted-foreground">{tile.hint}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        {/* ── Today's best opportunities (§71) ─────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Today&apos;s best opportunities</h2>
              <p className="text-xs text-muted-foreground">
                Ranked by lead score and website opportunity, with the reason and the recommended next move.
              </p>
            </div>
            <Link href="/leads" className="text-xs font-medium text-primary hover:underline">
              All leads →
            </Link>
          </div>

          {briefing.bestOpportunities.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Radar className="size-6" />}
                title="No scored leads yet"
                description="Run a discovery search to find businesses, audit their websites and start ranking opportunities."
                action={
                  <Link href="/lead-finder">
                    <Button size="sm">Find my first leads</Button>
                  </Link>
                }
              />
            </Card>
          ) : (
            <div className="space-y-3">
              {briefing.bestOpportunities.slice(0, 5).map((opportunity) => {
                const proposal = proposalByLead.get(opportunity.leadId);
                const conversation = conversationByLead.get(opportunity.leadId);
                const temperature = TEMPERATURE_META[opportunity.temperature as keyof typeof TEMPERATURE_META];
                return (
                  <Card key={opportunity.leadId} className="overflow-hidden transition-shadow hover:shadow-sm">
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/leads/${opportunity.leadId}`}
                              className="truncate text-sm font-semibold hover:underline"
                            >
                              {opportunity.businessName}
                            </Link>
                            <Badge tone={opportunity.temperature === "hot" ? "ember" : opportunity.temperature === "warm" ? "warning" : "neutral"}>
                              {temperature?.label ?? opportunity.temperature}
                            </Badge>
                            {opportunity.urgency === "now" ? <Badge tone="danger">Act now</Badge> : null}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {[opportunity.industry, opportunity.location].filter(Boolean).join(" · ")}
                            {opportunity.reviewCount
                              ? ` · ${opportunity.reviewCount} reviews${opportunity.rating ? ` at ${opportunity.rating.toFixed(1)}★` : ""}`
                              : ""}
                          </p>
                        </div>

                        <div className="flex items-center gap-4 text-right">
                          <ScoreStack label="Lead score" value={opportunity.leadScore} />
                          <ScoreStack
                            label="Website"
                            value={opportunity.websiteScore}
                            caption={
                              opportunity.websiteScore === null
                                ? "not audited"
                                : WEBSITE_STATUS_META[
                                    (opportunity.websiteScore < 35
                                      ? "very_poor"
                                      : opportunity.websiteScore < 50
                                        ? "poor"
                                        : opportunity.websiteScore < 65
                                          ? "average"
                                          : opportunity.websiteScore < 80
                                            ? "good"
                                            : "excellent") as keyof typeof WEBSITE_STATUS_META
                                  ]?.label
                            }
                          />
                          <ScoreStack label="Opportunity" value={opportunity.opportunityScore} accent />
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg bg-surface-muted px-3 py-2">
                          <p className="text-2xs uppercase tracking-wide text-subtle-foreground">Why this lead</p>
                          <p className="mt-0.5 text-xs text-foreground">{opportunity.whyThisLead}</p>
                        </div>
                        <div className="rounded-lg bg-primary-soft px-3 py-2">
                          <p className="text-2xs uppercase tracking-wide text-primary-soft-foreground">Recommended action</p>
                          <p className="mt-0.5 text-xs text-primary-soft-foreground">{opportunity.recommendedAction}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <OpportunityActions
                          leadId={opportunity.leadId}
                          businessName={opportunity.businessName}
                          hasProposal={Boolean(proposal)}
                          proposalId={proposal?.id ?? null}
                          hasConversation={Boolean(conversation)}
                          conversationId={conversation?.id ?? null}
                        />
                        {opportunity.estimatedValue ? (
                          <p className="text-xs text-muted-foreground">
                            Indicative value{" "}
                            <span className="font-medium text-foreground">
                              {formatMoney(opportunity.estimatedValue, opportunity.currency)}
                            </span>{" "}
                            · internal estimate, not a quote
                          </p>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Right rail ───────────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="space-y-1">
                <CardTitle>Needs attention now</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {briefing.needsAttentionNow.length
                    ? "Each item links to the record that needs the decision."
                    : "Nothing is overdue or waiting on a human."}
                </p>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 pt-3">
              {briefing.needsAttentionNow.length === 0 ? (
                <p className="text-xs text-subtle-foreground">You are clear for now.</p>
              ) : (
                briefing.needsAttentionNow.slice(0, 6).map((item) => (
                  <Link
                    key={item.id}
                    href={item.href}
                    className="flex items-start gap-3 rounded-lg border border-border px-3 py-2 transition-colors hover:bg-surface-muted"
                  >
                    <span
                      className={cn(
                        "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                        item.severity === "critical" && "bg-danger-soft text-danger-soft-foreground",
                        item.severity === "warning" && "bg-warning-soft text-warning-soft-foreground",
                        item.severity === "success" && "bg-success-soft text-success-soft-foreground",
                        item.severity === "info" && "bg-info-soft text-info-soft-foreground",
                      )}
                    >
                      {item.severity === "critical" ? (
                        <AlertTriangle className="size-3" />
                      ) : item.severity === "warning" ? (
                        <CalendarClock className="size-3" />
                      ) : (
                        <Gauge className="size-3" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{item.title}</span>
                      <span className="block text-2xs text-muted-foreground">{item.detail}</span>
                      <span className="mt-1 inline-flex items-center gap-1 text-2xs font-medium text-primary">
                        {item.actionLabel}
                        <ArrowUpRight className="size-3" />
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="space-y-1">
                <CardTitle>Workspace setup</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {setup.completedSteps} of {setup.totalSteps} complete · {setup.aiMode}
                </p>
              </div>
              <Badge tone={setup.complete ? "success" : "warning"}>
                {setup.complete ? "Ready" : `${setup.totalSteps - setup.completedSteps} left`}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3 pt-3">
              <Progress value={(setup.completedSteps / setup.totalSteps) * 100} tone={setup.complete ? "success" : "brand"} />
              <ul className="space-y-2">
                {setup.steps.map((step) => (
                  <li key={step.key}>
                    <Link href={step.href} className="flex items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-muted">
                      {step.done ? (
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />
                      ) : (
                        <Circle className="mt-0.5 size-3.5 shrink-0 text-subtle-foreground" />
                      )}
                      <span className="min-w-0">
                        <span className={cn("block text-xs", step.done ? "text-muted-foreground line-through" : "font-medium")}>
                          {step.label}
                        </span>
                        {!step.done ? (
                          <span className="mt-0.5 block text-2xs text-subtle-foreground">{step.blocked ?? step.detail}</span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {briefing.stalled.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Going quiet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-2">
                {briefing.stalled.slice(0, 5).map((item) => (
                  <Link
                    key={item.leadId}
                    href={`/leads/${item.leadId}`}
                    className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">{item.businessName}</span>
                      <span className="block text-2xs text-muted-foreground">{item.reason}</span>
                    </span>
                    <Badge tone={item.days > 14 ? "danger" : "warning"}>{item.days}d</Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {briefing.nextActions.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Suggested next actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-2">
                {briefing.nextActions.slice(0, 5).map((action) => (
                  <Link
                    key={action.label}
                    href={action.href}
                    className="flex items-start justify-between gap-3 rounded-md px-1 py-1.5 hover:bg-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{action.label}</span>
                      <span className="block text-2xs text-muted-foreground">{action.detail}</span>
                    </span>
                    <Badge tone={action.urgency === "critical" ? "danger" : action.urgency === "high" ? "ember" : "neutral"}>
                      {action.count}
                    </Badge>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <p className="px-1 text-2xs text-subtle-foreground">
            Snapshot generated {formatRelative(briefing.generatedAt)} from this workspace&apos;s own records — no
            estimates are invented and no external data is fetched to fill gaps.
          </p>
        </div>
      </div>
    </div>
  );
}

function ScoreStack({
  label,
  value,
  caption,
  accent = false,
}: {
  label: string;
  value: number | null;
  caption?: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-[68px]">
      <p className="text-2xs uppercase tracking-wide text-subtle-foreground">{label}</p>
      <p
        className={cn(
          "text-lg font-semibold leading-tight tracking-tight",
          accent && "text-primary",
          value !== null && !accent && value < 45 && "text-danger",
        )}
      >
        {value === null ? "—" : Math.round(value)}
      </p>
      {caption ? <p className="text-[10px] text-subtle-foreground">{caption}</p> : null}
    </div>
  );
}
