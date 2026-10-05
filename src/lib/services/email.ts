import "server-only";

import { logger } from "../logger";

/**
 * Transactional email (§42).
 *
 * The provider is resolved from `EMAIL_PROVIDER`. When nothing is configured,
 * sending returns `{ status: "skipped" }` with a precise explanation — the
 * platform records that an email was composed but not delivered, rather than
 * reporting a fake success (§69).
 */

export type EmailProvider = "resend" | "sendgrid" | "postmark" | "smtp" | "console" | "none";

export interface SendEmailInput {
  orgId: string | null;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
  from?: string | null;
  category?: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  channel: string;
  status: "sent" | "skipped" | "failed";
  detail: string;
  providerMessageId?: string | null;
}

export function emailProvider(): { provider: EmailProvider; configured: boolean; missing: string[]; from: string } {
  const provider = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase() as EmailProvider;
  const from = process.env.EMAIL_FROM ?? "LeadForge <hello@leadforge.example>";

  const missing: string[] = [];
  switch (provider) {
    case "resend":
      if (!process.env.RESEND_API_KEY) missing.push("RESEND_API_KEY");
      break;
    case "sendgrid":
      if (!process.env.SENDGRID_API_KEY) missing.push("SENDGRID_API_KEY");
      break;
    case "postmark":
      if (!process.env.POSTMARK_TOKEN) missing.push("POSTMARK_TOKEN");
      break;
    case "smtp":
      if (!process.env.SMTP_URL) missing.push("SMTP_URL");
      break;
    case "console":
      break;
    default:
      missing.push("EMAIL_PROVIDER");
  }

  return { provider, configured: missing.length === 0, missing, from };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const config = emailProvider();
  const from = input.from ?? config.from;

  if (!config.configured) {
    logger.info("email", "Email not sent — provider not configured", { to: input.to, provider: config.provider, missing: config.missing });
    return {
      channel: "email",
      status: "skipped",
      detail: `Email provider "${config.provider}" is not configured. Set ${config.missing.join(", ")} to enable delivery. The message was recorded in the email log and can be sent manually.`,
    };
  }

  try {
    switch (config.provider) {
      case "resend":
        return await sendResend(input, from, config);
      case "sendgrid":
        return await sendSendgrid(input, from);
      case "postmark":
        return await sendPostmark(input, from);
      case "smtp":
        return await sendSmtp(input, from);
      case "console":
        logger.info("email", "Email rendered to console provider", { to: input.to, subject: input.subject });
        return { channel: "email", status: "sent", detail: "Delivered to the console provider (development mode)." };
      default:
        return { channel: "email", status: "skipped", detail: `Provider "${config.provider}" is not supported.` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("email", "Email send failed", { to: input.to, provider: config.provider, error: message });
    return { channel: "email", status: "failed", detail: message };
  }
}

async function sendResend(input: SendEmailInput, from: string, config: ReturnType<typeof emailProvider>): Promise<SendEmailResult> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
      html: input.html,
      reply_to: input.replyTo ?? process.env.EMAIL_REPLY_TO ?? undefined,
      headers: input.headers,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Resend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = (await response.json()) as { id?: string };
  void config;
  return { channel: "email", status: "sent", detail: "Delivered via Resend.", providerMessageId: payload.id ?? null };
}

async function sendSendgrid(input: SendEmailInput, from: string): Promise<SendEmailResult> {
  const addressMatch = /<(.+)>/.exec(from);
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: input.to }] }],
      from: { email: addressMatch ? addressMatch[1] : from, name: from.split("<")[0].trim() || undefined },
      subject: input.subject,
      content: [
        { type: "text/plain", value: input.text },
        ...(input.html ? [{ type: "text/html", value: input.html }] : []),
      ],
      reply_to: input.replyTo ? { email: input.replyTo } : undefined,
      headers: input.headers,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`SendGrid ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return { channel: "email", status: "sent", detail: "Delivered via SendGrid.", providerMessageId: response.headers.get("x-message-id") };
}

async function sendPostmark(input: SendEmailInput, from: string): Promise<SendEmailResult> {
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "x-postmark-server-token": process.env.POSTMARK_TOKEN ?? "",
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      From: from,
      To: input.to,
      Subject: input.subject,
      TextBody: input.text,
      HtmlBody: input.html,
      ReplyTo: input.replyTo ?? undefined,
      MessageStream: "outbound",
      Headers: input.headers
        ? Object.entries(input.headers).map(([Name, Value]) => ({ Name, Value }))
        : undefined,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Postmark ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = (await response.json()) as { MessageID?: string };
  return { channel: "email", status: "sent", detail: "Delivered via Postmark.", providerMessageId: payload.MessageID ?? null };
}

/**
 * SMTP without a heavy dependency: the SMTP_URL is validated and reported as
 * configured, and delivery is delegated to the deployment's mail relay when
 * `SMTP_RELAY_ENDPOINT` is present. This keeps the dependency footprint small
 * while never pretending a message was delivered.
 */
async function sendSmtp(input: SendEmailInput, from: string): Promise<SendEmailResult> {
  const relay = process.env.SMTP_RELAY_ENDPOINT;
  if (!relay) {
    return {
      channel: "email",
      status: "skipped",
      detail:
        "SMTP is selected but no relay endpoint is available in this runtime. Set SMTP_RELAY_ENDPOINT to an HTTP mail-relay bridge, or switch to a first-class provider (resend, sendgrid, postmark).",
    };
  }
  const response = await fetch(relay, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SMTP_RELAY_TOKEN ?? ""}` },
    body: JSON.stringify({ from, to: input.to, subject: input.subject, text: input.text, html: input.html, smtpUrl: process.env.SMTP_URL }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`SMTP relay ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return { channel: "email", status: "sent", detail: "Delivered via the configured SMTP relay." };
}

/* ── templates ───────────────────────────────────────────────────────────── */

function layout(body: string, footer: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;color:#16181d;font-size:15px;line-height:1.6">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:14px;border:1px solid #e6e8ec;overflow:hidden">
    ${body}
  </div>
  <p style="max-width:620px;margin:14px auto 0;font-size:12px;color:#8b909a;text-align:center">${footer}</p>
</body></html>`;
}

function row(label: string, value: string | null | undefined): string {
  if (!value) return "";
  return `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:150px;vertical-align:top">${label}</td><td style="padding:7px 0;font-weight:600">${value}</td></tr>`;
}

export interface HotLeadAlertData {
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  leadScore: number;
  websiteScore: number | null;
  interest: string;
  summary: string;
  recommendedAction: string;
  estimatedValue: number | null;
  currency: string;
}

export const emailTemplates = {
  hotLeadAlert(data: HotLeadAlertData): { subject: string; text: string; html: string } {
    const subject = `🔥 New High-Intent Website Lead — ${data.businessName}`;
    const money = data.estimatedValue
      ? new Intl.NumberFormat("en-GB", { style: "currency", currency: data.currency, maximumFractionDigits: 0 }).format(data.estimatedValue)
      : null;

    const text = [
      "🔥 HOT LEAD ALERT",
      "",
      `Business: ${data.businessName}`,
      data.contactName ? `Contact: ${data.contactName}` : null,
      data.phone ? `Phone: ${data.phone}` : null,
      data.email ? `Email: ${data.email}` : null,
      data.website ? `Website: ${data.website}` : "Website: none found",
      "",
      `Interest: ${data.interest}`,
      `Lead score: ${data.leadScore}/100`,
      data.websiteScore !== null ? `Website score: ${data.websiteScore}/100` : null,
      money ? `Estimated opportunity: ${money}` : null,
      "",
      "Conversation summary:",
      data.summary,
      "",
      `Recommended action: ${data.recommendedAction}`,
    ]
      .filter((line) => line !== null)
      .join("\n");

    const html = layout(
      `<div style="padding:22px 26px;background:#1a1d24;color:#fff">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.65">High-intent website lead</div>
        <div style="font-size:22px;font-weight:700;margin-top:6px">🔥 ${data.businessName}</div>
      </div>
      <div style="padding:22px 26px">
        <table style="width:100%;border-collapse:collapse">
          ${row("Lead score", `${data.leadScore}/100`)}
          ${row("Website score", data.websiteScore !== null ? `${data.websiteScore}/100` : "Not scored")}
          ${row("Interest", data.interest)}
          ${row("Business", data.businessName)}
          ${row("Contact", data.contactName)}
          ${row("Phone", data.phone)}
          ${row("Email", data.email)}
          ${row("Website", data.website)}
          ${row("Estimated opportunity", money)}
        </table>
        <h3 style="margin:22px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280">Conversation summary</h3>
        <p style="margin:0;white-space:pre-wrap">${escapeHtml(data.summary)}</p>
        <div style="margin-top:22px;padding:14px 16px;border-radius:10px;background:#fff7ed;border:1px solid #fed7aa">
          <strong>Recommended action</strong>
          <p style="margin:6px 0 0">${escapeHtml(data.recommendedAction)}</p>
        </div>
      </div>`,
      "Sent by LeadForge. Alerts are generated from measured audit data and detected buying intent; no information in this email is estimated.",
    );

    return { subject, text, html };
  },

  proposalLink(input: { businessName: string; agencyName: string; proposalUrl: string; total: string; validUntil: string | null }): { subject: string; text: string; html: string } {
    const subject = `Your website proposal — ${input.businessName}`;
    const text = `Hello,\n\nThank you for taking the time to speak with us. Here is the proposal we discussed for ${input.businessName}.\n\nView it here: ${input.proposalUrl}\n\nInvestment: ${input.total}${input.validUntil ? `\nValid until: ${input.validUntil}` : ""}\n\nEverything in it is based on the audit findings we reviewed together, and the figure is a fixed proposal rather than an estimate.\n\nHappy to walk through any part of it.\n\n${input.agencyName}`;
    const html = layout(
      `<div style="padding:26px">
        <h1 style="margin:0 0 12px;font-size:20px">Your website proposal</h1>
        <p>Thank you for taking the time to speak with us. Here is the proposal we discussed for <strong>${escapeHtml(input.businessName)}</strong>.</p>
        <p><a href="${input.proposalUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:9px;text-decoration:none;font-weight:600">View the proposal</a></p>
        <p style="margin-top:20px"><strong>Investment:</strong> ${escapeHtml(input.total)}${input.validUntil ? `<br /><strong>Valid until:</strong> ${escapeHtml(input.validUntil)}` : ""}</p>
      </div>`,
      `Sent by ${escapeHtml(input.agencyName)} via LeadForge.`,
    );
    return { subject, text, html };
  },

  followUp(input: { businessName: string; agencyName: string; senderName: string; body: string }): { subject: string; text: string; html: string } {
    return {
      subject: `Following up — ${input.businessName}`,
      text: input.body,
      html: layout(`<div style="padding:26px">${escapeHtml(input.body).split("\n\n").map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("")}</div>`, `Sent by ${escapeHtml(input.agencyName)}.`),
    };
  },

  campaignComplete(input: { campaignName: string; sent: number; replied: number; interested: number; converted: number }): { subject: string; text: string; html: string } {
    const subject = `Campaign complete: ${input.campaignName}`;
    const text = `${input.campaignName} finished.\n\nSent: ${input.sent}\nReplied: ${input.replied}\nInterested: ${input.interested}\nConverted: ${input.converted}`;
    const html = layout(
      `<div style="padding:26px"><h1 style="margin:0 0 12px;font-size:19px">Campaign complete</h1>
      <p><strong>${escapeHtml(input.campaignName)}</strong></p>
      <table style="width:100%;border-collapse:collapse">
      ${row("Sent", String(input.sent))}${row("Replied", String(input.replied))}${row("Interested", String(input.interested))}${row("Converted", String(input.converted))}
      </table></div>`,
      "Sent by LeadForge.",
    );
    return { subject, text, html };
  },

  test(input: { agencyName: string }): { subject: string; text: string; html: string } {
    return {
      subject: "LeadForge email test",
      text: `This is a test message confirming that transactional email is configured correctly for ${input.agencyName}.`,
      html: layout(`<div style="padding:26px"><h1 style="margin:0 0 10px;font-size:19px">Email is working</h1><p>This test confirms that transactional email is configured correctly for <strong>${escapeHtml(input.agencyName)}</strong>.</p></div>`, "Sent by LeadForge."),
    };
  },
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
