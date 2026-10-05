import "server-only";

import {
  createNotification,
  listAlertRules,
  recordAlert,
} from "../db/repo/ops";
import type { NotificationType, Severity } from "../types";
import type { Notification } from "../db/repo/types";
import { logger } from "../logger";
import { sendEmail, emailTemplates } from "./email";
import { sendWhatsAppAlert } from "./whatsapp";

/**
 * Notification + alert engine (§21, §54, §55).
 *
 * Alert rules are evaluated against a lead snapshot. Delivery is attempted on
 * every configured channel and the outcome is recorded on the alert row so the
 * UI can show exactly what was delivered and what was skipped — the platform
 * never claims to have sent a WhatsApp message when no provider is configured.
 */

export interface LeadSnapshot {
  leadId: string;
  businessId: string;
  businessName: string;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  websiteUrl?: string | null;
  leadScore: number;
  websiteScore: number | null;
  opportunityScore: number | null;
  intent: string;
  intentScore: number;
  temperature: string;
  status: string;
  reviewCount: number;
  rating: number | null;
  estimatedValue: number | null;
  currency: string;
  conversationSummary?: string | null;
  recommendedAction?: string | null;
  location?: string | null;
  industry?: string | null;
  websiteStatus?: string | null;
  proposalTotal?: number | null;
  proposalAccepted?: boolean;
  proposalViewed?: boolean;
  now: string;
}

export interface AlertEvaluation {
  matched: boolean;
  reason: string;
  severity: Severity;
}

const OPERATORS: Record<string, (actual: unknown, expected: unknown) => boolean> = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  in: (a, b) => Array.isArray(b) && b.includes(a),
  not_in: (a, b) => Array.isArray(b) && !b.includes(a),
  contains: (a, b) => String(a ?? "").toLowerCase().includes(String(b).toLowerCase()),
};

export function evaluateRule(snapshot: LeadSnapshot, conditions: { field: string; operator: string; value: unknown }[]): AlertEvaluation {
  if (conditions.length === 0) return { matched: false, reason: "No conditions configured", severity: "info" };

  const failed: string[] = [];
  for (const condition of conditions) {
    const actual = (snapshot as unknown as Record<string, unknown>)[condition.field];
    const test = OPERATORS[condition.operator];
    if (!test) {
      failed.push(`${condition.field}: unsupported operator "${condition.operator}"`);
      continue;
    }
    if (!test(actual, condition.value)) {
      failed.push(`${condition.field} ${condition.operator} ${JSON.stringify(condition.value)} (actual: ${JSON.stringify(actual)})`);
    }
  }

  if (failed.length === 0) {
    return { matched: true, reason: conditions.map((c) => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`).join(" AND "), severity: "critical" };
  }
  return { matched: false, reason: failed.join("; "), severity: "info" };
}

export interface AlertDelivery {
  channel: string;
  status: "sent" | "skipped" | "failed";
  detail: string;
}

export async function fireAlerts(orgId: string, snapshot: LeadSnapshot): Promise<{ alerts: number; deliveries: AlertDelivery[] }> {
  const rules = listAlertRules(orgId).filter((rule) => rule.enabled);
  const deliveries: AlertDelivery[] = [];
  let alerts = 0;

  for (const rule of rules) {
    if (rule.lastTriggeredAt) {
      const elapsedMinutes = (Date.now() - new Date(rule.lastTriggeredAt).getTime()) / 60_000;
      if (elapsedMinutes < rule.cooldownMinutes) {
        deliveries.push({ channel: `rule:${rule.name}`, status: "skipped", detail: `Cooldown active (${Math.ceil(rule.cooldownMinutes - elapsedMinutes)} minutes remaining).` });
        continue;
      }
    }

    const evaluation = evaluateRule(snapshot, rule.conditions);
    if (!evaluation.matched) continue;

    alerts += 1;
    const title = `${snapshot.temperature === "hot" ? "🔥 Hot lead" : "Lead alert"}: ${snapshot.businessName}`;
    const body = buildAlertBody(snapshot, rule.name);

    const channelDeliveries: AlertDelivery[] = [];

    for (const action of rule.actions) {
      switch (action) {
        case "whatsapp": {
          const result = await sendWhatsAppAlert({
            orgId,
            to: process.env.WHATSAPP_ALERT_TO ?? "",
            businessName: snapshot.businessName,
            contactName: snapshot.contactName ?? null,
            interest: describeInterest(snapshot),
            leadScore: snapshot.leadScore,
            opportunity: describeOpportunity(snapshot.leadScore, snapshot.opportunityScore),
            summary: snapshot.conversationSummary ?? body,
            recommendedAction: snapshot.recommendedAction ?? "Contact within 15 minutes.",
            websiteScore: snapshot.websiteScore,
            phone: snapshot.phone ?? null,
            email: snapshot.email ?? null,
            estimatedValue: snapshot.estimatedValue,
            currency: snapshot.currency,
          });
          channelDeliveries.push(result);
          break;
        }
        case "email": {
          const to = process.env.ALERT_EMAIL_TO ?? process.env.EMAIL_REPLY_TO;
          if (!to) {
            channelDeliveries.push({ channel: "email", status: "skipped", detail: "Set ALERT_EMAIL_TO or EMAIL_REPLY_TO to receive alert emails." });
            break;
          }
          const template = emailTemplates.hotLeadAlert({
            businessName: snapshot.businessName,
            contactName: snapshot.contactName ?? null,
            phone: snapshot.phone ?? null,
            email: snapshot.email ?? null,
            website: snapshot.websiteUrl ?? null,
            leadScore: snapshot.leadScore,
            websiteScore: snapshot.websiteScore,
            interest: describeInterest(snapshot),
            summary: snapshot.conversationSummary ?? body,
            recommendedAction: snapshot.recommendedAction ?? "Contact within 15 minutes.",
            estimatedValue: snapshot.estimatedValue,
            currency: snapshot.currency,
          });
          const result = await sendEmail({ orgId, to, subject: template.subject, text: template.text, html: template.html, category: "alert" });
          channelDeliveries.push(result);
          break;
        }
        case "create_task": {
          const { createTask } = await import("../db/repo/ops");
          createTask(orgId, {
            title: `Contact ${snapshot.businessName} — ${rule.name}`,
            description: snapshot.recommendedAction ?? "Follow up on the triggered alert.",
            type: "follow_up",
            priority: rule.name.toLowerCase().includes("high") ? "urgent" : "high",
            dueAt: new Date(Date.now() + 15 * 60_000).toISOString(),
            leadId: snapshot.leadId,
            businessId: snapshot.businessId,
          });
          channelDeliveries.push({ channel: "task", status: "sent", detail: "Follow-up task created, due in 15 minutes." });
          break;
        }
        case "mark_hot": {
          const { updateLead } = await import("../db/repo/lead");
          updateLead(orgId, snapshot.leadId, { temperature: "hot", priority: 1 });
          channelDeliveries.push({ channel: "lead", status: "sent", detail: "Lead marked hot and priority raised." });
          break;
        }
        case "notify_assignee":
        case "notify_owner": {
          const { getLead } = await import("../db/repo/lead");
          const lead = getLead(orgId, snapshot.leadId);
          deliveries.push({
            channel: "in_app",
            status: "sent",
            detail: `${action === "notify_assignee" ? "Assigned agent" : "Owner"} notified in the notification centre.`,
          });
          createNotification(orgId, {
            userId: action === "notify_assignee" ? lead?.ownerId ?? null : null,
            type: "hot_lead_alert",
            severity: evaluation.severity,
            title,
            body,
            entityType: "lead",
            entityId: snapshot.leadId,
            actionUrl: `/leads/${snapshot.leadId}`,
            icon: "flame",
            channels: ["in_app", ...rule.actions.filter((a) => a === "whatsapp" || a === "email")],
          });
          break;
        }
        default:
          channelDeliveries.push({ channel: action, status: "skipped", detail: `Unknown action "${action}" — no handler.` });
      }
    }

    recordAlert(orgId, {
      ruleId: rule.id,
      leadId: snapshot.leadId,
      businessId: snapshot.businessId,
      severity: evaluation.severity,
      title,
      body,
      channels: rule.actions,
      delivery: { deliveries: channelDeliveries, conditions: rule.conditions },
    });

    deliveries.push(...channelDeliveries);
    logger.info("alerts", "Alert fired", { rule: rule.name, lead: snapshot.leadId, actions: rule.actions });
  }

  return { alerts, deliveries };
}

function describeInterest(snapshot: LeadSnapshot): string {
  const map: Record<string, string> = {
    ready_to_start: "Ready to start — asked to proceed",
    wants_call: "Requested a call",
    wants_pricing: "Asked about pricing",
    wants_demo: "Asked to see examples",
    high_intent: "High buying intent detected",
    interested: "Expressed interest in a redesign",
    information_seeking: "Seeking more information",
    curious: "Curious — early stage",
  };
  return map[snapshot.intent] ?? (snapshot.temperature === "hot" ? "Strong buying signals" : "Engaged with outreach");
}

function describeOpportunity(leadScore: number, opportunityScore: number | null): string {
  const score = opportunityScore ?? leadScore;
  if (score >= 85) return "Very high";
  if (score >= 70) return "High";
  if (score >= 55) return "Moderate";
  return "Qualifying";
}

function buildAlertBody(snapshot: LeadSnapshot, ruleName: string): string {
  return [
    `Rule: ${ruleName}`,
    `Lead score ${snapshot.leadScore}/100${snapshot.websiteScore !== null ? ` · website score ${snapshot.websiteScore}/100` : ""}`,
    snapshot.industry ? `Industry: ${snapshot.industry}` : null,
    snapshot.location ? `Location: ${snapshot.location}` : null,
    snapshot.rating ? `Public rating: ${snapshot.rating.toFixed(1)}★ from ${snapshot.reviewCount} reviews` : null,
    snapshot.conversationSummary ? `Conversation: ${snapshot.conversationSummary}` : null,
    snapshot.recommendedAction ? `Recommended action: ${snapshot.recommendedAction}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── standard notifications ─────────────────────────────────────────────── */

const NOTIFICATION_DEFAULTS: Partial<Record<NotificationType, { severity: Severity; icon: string }>> = {
  new_lead: { severity: "info", icon: "user-plus" },
  high_value_lead: { severity: "warning", icon: "trending-up" },
  hot_lead_alert: { severity: "critical", icon: "flame" },
  interested_prospect: { severity: "warning", icon: "message-circle" },
  proposal_opened: { severity: "info", icon: "file-search" },
  proposal_accepted: { severity: "success", icon: "check-circle" },
  proposal_declined: { severity: "warning", icon: "x-circle" },
  meeting_requested: { severity: "warning", icon: "calendar" },
  follow_up_due: { severity: "info", icon: "clock" },
  chat_escalation: { severity: "critical", icon: "headphones" },
  new_response: { severity: "info", icon: "mail" },
  audit_completed: { severity: "info", icon: "activity" },
  campaign_completed: { severity: "info", icon: "send" },
  job_failed: { severity: "critical", icon: "alert-triangle" },
  system: { severity: "info", icon: "info" },
};

export function notify(orgId: string, input: {
  type: NotificationType;
  title: string;
  body?: string | null;
  userId?: string | null;
  severity?: Severity;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  channels?: string[];
}): Notification {
  const defaults = NOTIFICATION_DEFAULTS[input.type] ?? { severity: "info" as Severity, icon: "info" };
  return createNotification(orgId, {
    ...input,
    severity: input.severity ?? defaults.severity,
    icon: defaults.icon,
  });
}
