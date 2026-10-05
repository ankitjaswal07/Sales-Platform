import { z } from "zod";
import { route, json, notFound } from "@/lib/api/http";
import { getLead } from "@/lib/db/repo/lead";
import { createProposalForLead } from "@/lib/services/proposal";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

const schema = z.object({
  preset: z
    .enum(["premium", "minimal", "corporate", "modern", "luxury", "brand_colors", "playful", "technical"])
    .optional(),
  template: z.enum(["signature", "editorial", "technical", "compact"]).optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Drafts a proposal for a lead.
 *
 * Nothing is sent: the draft starts in `pending_approval`, so a human with the
 * `proposals.approve` permission has to approve this version before it can
 * leave the platform (§16).
 */
export const POST = route(
  { permission: "proposals.create", schema, rateLimit: RATE_LIMITS.expensive },
  async (_request, body, context) => {
    const leadId = context.params.id;
    if (!leadId || !getLead(context.organization.id, leadId)) throw notFound("That lead is not in this workspace.");

    const created = await createProposalForLead(context.organization.id, leadId, {
      userId: context.user?.id ?? null,
      preset: body.preset,
      template: body.template,
      notes: body.notes ?? null,
      regenerate: false,
    });

    return json(
      {
        ok: true,
        proposalId: created.proposal.id,
        number: created.proposal.number,
        status: created.proposal.status,
        total: created.proposal.total,
        currency: created.proposal.currency,
        approval: created.proposal.status === "pending_approval" ? "approval_required" : created.proposal.status,
      },
      { status: 201 },
    );
  },
);
