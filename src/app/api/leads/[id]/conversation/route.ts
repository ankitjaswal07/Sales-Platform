import { z } from "zod";
import { route, json } from "@/lib/api/http";
import { getOrCreateConversation } from "@/lib/services/conversation";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

const schema = z.object({ channel: z.enum(["web_chat", "email", "whatsapp"]).optional() }).default({});

/**
 * Opens the prospect conversation for a lead.
 *
 * The AI handles the first reply and identifies itself as AI in its opening
 * message — the disclosure is not optional (§16).
 */
export const POST = route(
  { permission: "conversations.reply", schema, rateLimit: RATE_LIMITS.standard },
  async (_request, body, context) => {
    const { conversation, created } = getOrCreateConversation(context.organization.id, {
      leadId: context.params.id,
      channel: body?.channel,
      userId: context.user?.id ?? null,
    });

    return json({ ok: true, conversationId: conversation.id, created, status: conversation.status }, { status: created ? 201 : 200 });
  },
);
