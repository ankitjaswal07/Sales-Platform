import { route, json, notFound } from "@/lib/api/http";
import { getLead } from "@/lib/db/repo/lead";
import { rescoreLead } from "@/lib/services/pipeline";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

/** Recomputes every score on a lead from its current business, website and audit data. */
export const POST = route(
  { permission: "leads.edit", rateLimit: RATE_LIMITS.standard },
  async (_request, _body, context) => {
    const leadId = context.params.id;
    if (!leadId || !getLead(context.organization.id, leadId)) throw notFound("That lead is not in this workspace.");
    const result = rescoreLead(context.organization.id, leadId);
    if (!result) throw notFound("That lead has no scoreable data yet.");
    return json({ ok: true, ...result });
  },
);
