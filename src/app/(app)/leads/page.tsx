import type { Metadata } from "next";
import Link from "next/link";
import { Filter, Search as SearchIcon, Users } from "lucide-react";
import { currentSession } from "@/lib/auth/session";
import { listLeads } from "@/lib/db/repo/lead";
import { listStages } from "@/lib/db/repo/org";
import { toLeadViews } from "@/lib/services/lead-view";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Progress,
  Select,
  type BadgeTone,
} from "@/components/ui/primitives";
import { LEAD_STATUS_META, TEMPERATURE_META, type LeadStatus, type Temperature } from "@/lib/types";
import { cn, formatMoney, formatRelative } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads" };

const PAGE_SIZE = 25;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentSession();
  if (!session) return null;
  const { organization } = session;

  const params = await searchParams;
  const pick = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);

  const search = pick("q")?.trim() ?? "";
  const status = pick("status") ?? "";
  const temperature = pick("temperature") ?? "";
  const sort = (pick("sort") ?? "lead_score") as "lead_score" | "opportunity" | "created_at" | "reviews" | "value" | "name";
  const page = Math.max(1, Number(pick("page") ?? 1) || 1);

  const stages = listStages(organization.id);
  const { items, total } = listLeads(organization.id, {
    search: search || undefined,
    statuses: status ? [status as LeadStatus] : undefined,
    temperatures: temperature ? [temperature as Temperature] : undefined,
    sort,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const leads = toLeadViews(items);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const query = (overrides: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams();
    const source: Record<string, string | number | undefined> = {
      q: search || undefined,
      status: status || undefined,
      temperature: temperature || undefined,
      sort: sort !== "lead_score" ? sort : undefined,
      page,
      ...overrides,
    };
    Object.entries(source).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && !(key === "page" && Number(value) === 1)) next.set(key, String(value));
    });
    const queryString = next.toString();
    return queryString ? `/leads?${queryString}` : "/leads";
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? "lead" : "leads"} in this workspace
            {status || temperature || search ? " matching your filters" : ""}.
          </p>
        </div>
        <Link href="/lead-finder">
          <Button size="sm">Find more leads</Button>
        </Link>
      </div>

      {/* Filters — a plain GET form, so it works with JavaScript disabled too. */}
      <Card>
        <form method="get" action="/leads" className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[220px] flex-1 space-y-1.5">
            <Label htmlFor="q">Search</Label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" />
              <Input id="q" name="q" defaultValue={search} placeholder="Business, contact, city…" className="pl-8" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue={status}>
              <option value="">All statuses</option>
              {Object.entries(LEAD_STATUS_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="temperature">Temperature</Label>
            <Select id="temperature" name="temperature" defaultValue={temperature}>
              <option value="">Any</option>
              {Object.entries(TEMPERATURE_META).map(([key, meta]) => (
                <option key={key} value={key}>
                  {meta.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sort">Sort</Label>
            <Select id="sort" name="sort" defaultValue={sort}>
              <option value="lead_score">Lead score</option>
              <option value="opportunity">Website opportunity</option>
              <option value="created_at">Newest first</option>
              <option value="reviews">Most reviews</option>
              <option value="value">Estimated value</option>
              <option value="name">Business name</option>
            </Select>
          </div>

          <Button type="submit" variant="secondary" size="md">
            <Filter className="size-3.5" />
            Apply
          </Button>
          {(search || status || temperature) && (
            <Link href="/leads" className="pb-2 text-xs text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
        </form>
      </Card>

      {leads.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="size-6" />}
            title={total === 0 ? "No leads yet" : "No leads match those filters"}
            description={
              total === 0
                ? "Discovery turns businesses into leads automatically once their website has been audited and scored."
                : "Try widening the status or temperature filter."
            }
            action={
              <Link href={total === 0 ? "/lead-finder" : "/leads"}>
                <Button size="sm">{total === 0 ? "Find my first leads" : "Clear filters"}</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-2xs uppercase tracking-wide text-subtle-foreground">
                  <th className="px-4 py-2.5 font-medium">Business</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Score</th>
                  <th className="px-3 py-2.5 font-medium">Website</th>
                  <th className="px-3 py-2.5 font-medium">Opportunity</th>
                  <th className="px-3 py-2.5 font-medium">Value</th>
                  <th className="px-3 py-2.5 font-medium">Next action</th>
                  <th className="px-3 py-2.5 font-medium">Activity</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-border/70 transition-colors last:border-0 hover:bg-surface-muted/60">
                    <td className="max-w-[280px] px-4 py-3">
                      <Link href={`/leads/${lead.id}`} className="block truncate font-medium hover:underline">
                        {lead.businessName}
                      </Link>
                      <span className="block truncate text-2xs text-muted-foreground">
                        {[lead.industry, lead.city, lead.country].filter(Boolean).join(" · ") || "Location unknown"}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={(LEAD_STATUS_META[lead.status]?.tone ?? "neutral") as BadgeTone}>
                          {LEAD_STATUS_META[lead.status]?.label ?? lead.status}
                        </Badge>
                        <span className="text-[10px] text-subtle-foreground">
                          {stages.find((stage) => stage.key === lead.stageKey)?.name ?? lead.stageKey}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <ScoreBar value={lead.leadScore} strong={lead.temperature === "hot"} />
                      <span className="mt-1 block text-[10px] text-subtle-foreground">
                        {TEMPERATURE_META[lead.temperature]?.label ?? lead.temperature}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {lead.websiteScore === null ? (
                        <span className="text-xs text-subtle-foreground">Not audited</span>
                      ) : (
                        <ScoreBar value={lead.websiteScore} invert />
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {lead.opportunityScore === null ? (
                        <span className="text-xs text-subtle-foreground">—</span>
                      ) : (
                        <span className={cn("text-sm font-semibold", lead.opportunityScore >= 70 && "text-primary")}>
                          {Math.round(lead.opportunityScore)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">{formatMoney(lead.estimatedValue, lead.currency)}</td>
                    <td className="max-w-[240px] px-3 py-3">
                      <span className="block truncate text-xs text-muted-foreground">{lead.nextAction ?? "—"}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{formatRelative(lead.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground">
              <span>
                Page {page} of {pages}
              </span>
              <div className="flex items-center gap-2">
                {page > 1 ? (
                  <Link href={query({ page: page - 1 })} className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-muted">
                    Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={query({ page: page + 1 })} className="rounded-md border border-border px-2.5 py-1 hover:bg-surface-muted">
                    Next
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}

function ScoreBar({ value, strong = false, invert = false }: { value: number; strong?: boolean; invert?: boolean }) {
  const tone: BadgeTone = invert
    ? value < 40
      ? "danger"
      : value < 60
        ? "warning"
        : "success"
    : strong
      ? "ember"
      : value >= 70
        ? "success"
        : value >= 50
          ? "warning"
          : "neutral";
  return (
    <div className="w-24">
      <div className="flex items-center justify-between text-[10px] text-subtle-foreground">
        <span className={cn("font-semibold text-foreground", strong && "text-ember")}>{Math.round(value)}</span>
        <span>/100</span>
      </div>
      <Progress value={value} tone={tone} className="mt-1" />
    </div>
  );
}
