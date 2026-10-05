import { route, json, ApiError } from "@/lib/api/http";
import { verifyStatusRequest, connectorState } from "@/lib/api/connector";
import { analyticsSummary, rangeFor } from "@/lib/db/repo/analytics";
import { unreadNotificationCount, jobStats } from "@/lib/db/repo/ops";
import { countLeads } from "@/lib/db/repo/lead";
import { countBusinesses } from "@/lib/db/repo/business";

/**
 * Read-only status for the WordPress dashboard widget.
 *
 * Signed server-to-server with the same shared secret (`${action}|${ts}|${nonce}`),
 * never exposed to browsers, and deliberately narrow: a connected WordPress
 * install learns how the workspace is doing, not who the prospects are. Lead
 * and business names are never returned — only counts and the top score.
 */
async function handle(request: Request, query: URLSearchParams): Promise<Response> {
  const state = connectorState();
  if (!state.configured) {
    throw new ApiError(503, state.reason ?? "The WordPress connector is not configured.", "connector_not_configured");
  }

  const verdict = verifyStatusRequest({
    ts: query.get("ts"),
    nonce: query.get("nonce"),
    signature: query.get("sig") ?? query.get("signature"),
  });
  if (!verdict.ok) {
    const status = verdict.reason === "expired" ? 410 : 401;
    throw new ApiError(status, verdict.message ?? "The request signature was rejected.", verdict.reason ?? "rejected");
  }

  const orgId = (request.headers.get("x-leadforge-org") ?? "").trim();
  const { getPrimaryOrganization, getOrganization } = await import("@/lib/db/repo/org");
  const organization = orgId ? getOrganization(orgId) : getPrimaryOrganization();
  if (!organization) throw new ApiError(503, "No workspace is initialised.", "not_initialised");

  const summary = analyticsSummary(organization.id, rangeFor(30));
  const jobs = jobStats(organization.id);

  return json({
    ok: true,
    organization: { name: organization.name, currency: organization.currency },
    generatedAt: new Date().toISOString(),
    counts: {
      leads: countLeads(organization.id),
      businesses: countBusinesses(organization.id),
      hotLeads: summary.leads.hot,
      uncontacted: summary.leads.uncontacted,
      unreadNotifications: unreadNotificationCount(organization.id, undefined),
      proposalsSent: summary.sales.proposalsSent,
      meetings: summary.activity.conversationsStarted,
    },
    opportunity: {
      highOpportunity: summary.websites.highOpportunity,
      audited: summary.websites.audited,
      averageWebsiteScore: summary.websites.averageScore,
      topLeadScore: summary.bestOpportunities[0]?.leadScore ?? null,
    },
    queue: { queued: jobs.queued, failed: jobs.failed },
  });
}

export const GET = route({ auth: false }, async (request, _body, context) => handle(request, context.query));
export const POST = route({ auth: false }, async (request, _body, context) => handle(request, context.query));
