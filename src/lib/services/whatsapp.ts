import "server-only";

import { logger } from "../logger";
import type { AlertDelivery } from "./notifications";

/**
 * WhatsApp Business Cloud API (Meta) — official provider only (§19).
 *
 * Deliberately narrow: the platform sends templated *business notifications to
 * the agency's own number*, never unsolicited marketing messages to prospects.
 * That is the compliant use of the Cloud API and it is the only mode this
 * integration supports. There is no personal-account automation anywhere in
 * this codebase.
 */

export interface WhatsAppConfig {
  configured: boolean;
  provider: string;
  missing: string[];
  phoneNumberId: string | null;
  to: string | null;
}

export function whatsappConfig(): WhatsAppConfig {
  const provider = (process.env.WHATSAPP_PROVIDER ?? "none").toLowerCase();
  const required = ["WHATSAPP_PROVIDER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_ALERT_TO"];
  const missing = required.filter((name) => !process.env[name]);
  return {
    configured: provider === "cloud" && missing.length === 0,
    provider,
    missing,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
    to: process.env.WHATSAPP_ALERT_TO ?? null,
  };
}

export interface WhatsAppAlertInput {
  orgId: string;
  to: string;
  businessName: string;
  contactName: string | null;
  interest: string;
  leadScore: number;
  opportunity: string;
  summary: string;
  recommendedAction: string;
  websiteScore: number | null;
  phone: string | null;
  email: string | null;
  estimatedValue: number | null;
  currency: string;
}

export function buildAlertMessage(input: WhatsAppAlertInput): string {
  return [
    "🔥 HOT LEAD ALERT",
    "",
    `Business: ${input.businessName}`,
    input.contactName ? `Contact: ${input.contactName}` : null,
    input.phone ? `Phone: ${input.phone}` : null,
    input.email ? `Email: ${input.email}` : null,
    "",
    `Interest: ${input.interest}`,
    `Lead score: ${input.leadScore}/100`,
    input.websiteScore !== null ? `Website score: ${input.websiteScore}/100` : null,
    `Estimated opportunity: ${input.opportunity}${input.estimatedValue ? ` (£${input.estimatedValue.toLocaleString()})` : ""}`,
    "",
    "Conversation summary:",
    input.summary,
    "",
    `Recommended action: ${input.recommendedAction}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function sendWhatsAppAlert(input: WhatsAppAlertInput): Promise<AlertDelivery> {
  const config = whatsappConfig();
  const message = buildAlertMessage(input);

  if (config.provider === "none") {
    return {
      channel: "whatsapp",
      status: "skipped",
      detail: "WhatsApp is not configured. Set WHATSAPP_PROVIDER=cloud with WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN and WHATSAPP_ALERT_TO to enable high-intent alerts. Only the official Meta Cloud API is supported.",
    };
  }

  if (!config.configured) {
    return {
      channel: "whatsapp",
      status: "skipped",
      detail: `WhatsApp Cloud API is missing configuration: ${config.missing.join(", ")}.`,
    };
  }

  const to = input.to || config.to || "";
  if (!to) {
    return { channel: "whatsapp", status: "skipped", detail: "No destination number configured (WHATSAPP_ALERT_TO)." };
  }

  try {
    // Try an approved template first — required for business-initiated messages
    // outside the 24-hour customer service window. Fall back to a plain text
    // message, which Meta accepts inside an open session.
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME;
    const body = templateName
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: templateName,
            language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en_GB" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: input.businessName },
                  { type: "text", text: input.interest },
                  { type: "text", text: `${input.leadScore}/100` },
                  { type: "text", text: input.summary.slice(0, 500) },
                ],
              },
            ],
          },
        }
      : {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { preview_url: false, body: message.slice(0, 4096) },
        };

    const response = await fetch(`https://graph.facebook.com/v21.0/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const payload = (await response.text()).slice(0, 400);
      logger.error("whatsapp", "Cloud API send failed", { status: response.status, payload });
      return { channel: "whatsapp", status: "failed", detail: `Meta Cloud API returned ${response.status}: ${payload}` };
    }

    const payload = (await response.json()) as { messages?: { id: string }[] };
    return {
      channel: "whatsapp",
      status: "sent",
      detail: `Delivered to ${to} via the official WhatsApp Cloud API${templateName ? ` using template "${templateName}"` : ""}. Message id ${payload.messages?.[0]?.id ?? "unknown"}.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error("whatsapp", "Cloud API request threw", { error: detail });
    return { channel: "whatsapp", status: "failed", detail };
  }
}

export interface WebhookVerification {
  valid: boolean;
  reason: string;
}

/** Constant-time-ish verification of the `X-Hub-Signature-256` header. */
export async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<WebhookVerification> {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    return { valid: false, reason: "WHATSAPP_APP_SECRET is not set, so inbound webhook signatures cannot be verified. Configure it before enabling inbound processing." };
  }
  if (!signature) return { valid: false, reason: "Missing X-Hub-Signature-256 header." };

  const { createHmac, timingSafeEqual } = await import("node:crypto");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (provided.length !== expected.length) return { valid: false, reason: "Signature length mismatch." };
  const ok = timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  return { valid: ok, reason: ok ? "Signature verified." : "Signature does not match the computed digest." };
}
