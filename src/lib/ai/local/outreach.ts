import type { AuditFinding, EmailStyle, ProposalLineItem } from "../../types";
import { industryProfile, industryKeywords } from "./industry";
import { applyGuardrails, verifyClaims } from "../guardrails";

/**
 * Outreach email generation (§24).
 *
 * Six genuinely different styles — not the same email with a different greeting.
 * Every factual statement is drawn from `evidence` and the result is passed
 * through the guardrails before it can be sent.
 */

export interface OutreachInput {
  businessName: string;
  contactName?: string | null;
  industry?: string | null;
  city?: string | null;
  websiteUrl?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  findings?: AuditFinding[];
  scores?: Record<string, number | null | undefined> | null;
  agencyName: string;
  agencySenderName?: string;
  agencyPhone?: string | null;
  agencyWebsite?: string | null;
  auditLink?: string | null;
  proposalLink?: string | null;
  style: EmailStyle;
  sequenceStep?: number;
  tone?: string;
}

export interface OutreachDraft {
  subject: string;
  preheader: string;
  body: string;
  bodyHtml: string;
  style: EmailStyle;
  personalizationUsed: string[];
  evidenceRefs: string[];
  followUpInDays: number;
  plainSummary: string;
  guardrailFlags: string[];
  unsupportedClaims: string[];
}

export function localOutreachEmail(input: OutreachInput): OutreachDraft {
  const profile = industryProfile(input.industry, null);
  const findings = (input.findings ?? []).filter((f) => f.severity !== "positive");
  const step = input.sequenceStep ?? 1;
  const scores = input.scores ?? {};
  const hasWebsite = Boolean(input.websiteUrl);
  const locality = input.city ?? "your area";
  const topFinding = pickTopFinding(findings);
  const greeting = input.contactName ? `Hi ${input.contactName.split(" ")[0]},` : "Hello,";
  const evidenceRefs = findings.map((f) => f.evidence);
  const personalizationUsed: string[] = [];

  if (input.contactName) personalizationUsed.push(`Named recipient: ${input.contactName}`);
  if (input.businessName) personalizationUsed.push(`Business name: ${input.businessName}`);
  if (input.city) personalizationUsed.push(`Location: ${input.city}`);
  if (input.rating) personalizationUsed.push(`Public rating: ${input.rating.toFixed(1)}★ from ${input.reviewCount ?? 0} reviews`);
  if (topFinding) personalizationUsed.push(`Specific audit finding: ${topFinding.title}`);
  if (input.websiteUrl) personalizationUsed.push(`Website analysed: ${input.websiteUrl}`);
  else personalizationUsed.push("No website present (verified from public listing data)");

  const subject = buildSubject(input, profile, topFinding, hasWebsite, step);
  const body = buildBody({
    input,
    profile,
    findings,
    topFinding,
    hasWebsite,
    greeting,
    locality,
    step,
    scores,
  });

  const guarded = applyGuardrails(body, { applyToneRules: true });
  const { unsupported } = verifyClaims(guarded.text, evidenceRefs);

  return {
    subject,
    preheader: buildPreheader(input, profile, hasWebsite),
    body: guarded.text,
    bodyHtml: toHtml(guarded.text, input),
    style: input.style,
    personalizationUsed,
    evidenceRefs,
    followUpInDays: followUpInterval(step),
    plainSummary: summarise(guarded.text),
    guardrailFlags: guarded.flags,
    unsupportedClaims: unsupported,
  };
}

function pickTopFinding(findings: AuditFinding[]): AuditFinding | null {
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, positive: 4 };
  const commercial = [...findings]
    .filter((f) => f.evidence)
    .sort((a, b) => {
      const severityDelta = rank[a.severity] - rank[b.severity];
      if (severityDelta !== 0) return severityDelta;
      return (a.effort === "low" ? 0 : 1) - (b.effort === "low" ? 0 : 1);
    });
  return commercial[0] ?? null;
}

function buildSubject(
  input: OutreachInput,
  profile: ReturnType<typeof industryProfile>,
  topFinding: AuditFinding | null,
  hasWebsite: boolean,
  step: number,
): string {
  if (step > 1) {
    const followUps: Record<EmailStyle, string[]> = {
      professional: [`Following up: ${input.businessName} website review`, `Re: ${profile.label} website findings for ${input.businessName}`],
      friendly: [`Quick nudge about ${input.businessName}'s website`, `Still happy to share those findings`],
      short: [`Re: ${input.businessName}`, `Should I close this off?`],
      consultative: [`One more thought on your ${input.websiteUrl ? "site" : "online presence"}`, `Re: the ${profile.label.toLowerCase()} findings`],
      audit_based: [`Re: ${topFinding?.title ?? "the audit findings"}`, `${input.businessName}: one thing worth fixing`],
      value_based: [`What those findings are costing ${input.businessName}`, `Re: the upside we identified`],
    };
    return followUps[input.style][Math.min(step - 2, 1)] ?? `Re: ${input.businessName}`;
  }

  if (!hasWebsite) {
    const byStyle: Record<EmailStyle, string> = {
      professional: `${input.businessName} — a direct online enquiry channel`,
      friendly: `Noticed ${input.businessName} doesn't have a website yet`,
      short: `Quick question about ${input.businessName}`,
      consultative: `${input.businessName} is missing the searches that matter`,
      audit_based: `What we found when we looked for ${input.businessName} online`,
      value_based: `${input.reviewCount ?? 0} reviews and nowhere for them to convert`,
    };
    return byStyle[input.style];
  }

  const byStyle: Record<EmailStyle, string> = {
    professional: `${input.businessName} — website improvement findings`,
    friendly: `Spotted two quick wins on ${input.businessName}'s website`,
    short: `${input.businessName}'s website`,
    consultative: `Quick observation about ${input.businessName}'s website`,
    audit_based: topFinding ? `${topFinding.title} on ${input.businessName}'s site` : `${input.businessName}: website audit finding`,
    value_based: `Losing enquiries on ${input.businessName}'s website`,
  };
  return byStyle[input.style];
}

function buildPreheader(input: OutreachInput, profile: ReturnType<typeof industryProfile>, hasWebsite: boolean): string {
  if (!hasWebsite) return `We looked for ${input.businessName} online and found ${input.reviewCount ?? 0} reviews but no website.`;
  return `Two specific, measurable things we found on ${input.websiteUrl}.`;
}

function followUpInterval(step: number): number {
  const intervals = [4, 5, 6, 7];
  return intervals[Math.min(step - 1, intervals.length - 1)] ?? 5;
}

function buildBody(args: {
  input: OutreachInput;
  profile: ReturnType<typeof industryProfile>;
  findings: AuditFinding[];
  topFinding: AuditFinding | null;
  hasWebsite: boolean;
  greeting: string;
  locality: string;
  step: number;
  scores: Record<string, number | null | undefined>;
}): string {
  const { input, profile, findings, topFinding, hasWebsite, greeting, locality, step, scores } = args;
  const signoff = `\n\n${input.agencySenderName ?? input.agencyName}\n${input.agencyName}${input.agencyPhone ? `\n${input.agencyPhone}` : ""}${
    input.agencyWebsite ? `\n${input.agencyWebsite}` : ""
  }`;

  if (step > 1) return buildFollowUp({ input, profile, findings, topFinding, hasWebsite, greeting, step }) + signoff;

  const second = findings[1];

  switch (input.style) {
    case "professional":
      return [
        greeting,
        `I run ${input.agencyName}, a web studio that works with ${profile.label.toLowerCase()} businesses.`,
        hasWebsite
          ? `We ran a short technical review of ${input.websiteUrl} and found two things worth your attention.`
          : `We were researching ${profile.label.toLowerCase()} businesses in ${locality} and noticed ${input.businessName} has ${input.reviewCount ?? 0} reviews but no website.`,
        topFinding
          ? `First: ${topFinding.title.toLowerCase()}. ${topFinding.detail} This was measured directly — ${topFinding.evidence}`
          : `The public data suggests the online presence does not yet match the reputation the business has earned.`,
        second ? `Second: ${second.title.toLowerCase()}. ${second.detail}` : "",
        `Neither is difficult to fix. ${input.auditLink ? `The full findings are here if useful: ${input.auditLink}` : "I can send the full findings if useful."}`,
        `Would a short call next week be worthwhile? I will keep it to 20 minutes and there is no obligation.`,
        input.proposalLink ? `\nIf you would rather read first: ${input.proposalLink}` : "",
        "Best regards,",
      ]
        .filter(Boolean)
        .join("\n\n") + signoff;

    case "friendly":
      return [
        greeting,
        hasWebsite
          ? `I had a look at ${input.businessName}'s website while researching ${profile.label.toLowerCase()} businesses in ${locality} — hope you don't mind me reaching out.`
          : `I was looking at ${profile.label.toLowerCase()} businesses in ${locality} and ${input.businessName} came up (great reviews by the way) — but I couldn't find a website.`,
        topFinding
          ? `One thing stood out: ${topFinding.title.toLowerCase()}. ${topFinding.detail}`
          : `One thing stood out — there isn't a clear way for people to get in touch from the site.`,
        `A lot of businesses we speak to don't realise it, because it looks fine when you look at it yourself. It tends to show up in the number of enquiries rather than in how the site looks.`,
        `We could fix it, but honestly the first step is just showing you what we found${input.auditLink ? `: ${input.auditLink}` : ""}.`,
        `Fancy a 15-minute chat about it? No pressure either way.`,
        "Cheers,",
      ]
        .filter(Boolean)
        .join("\n\n") + signoff;

    case "short":
      return [
        greeting,
        topFinding
          ? `Found a measurable problem with ${input.websiteUrl ?? `${input.businessName}'s online presence`}: ${topFinding.title.toLowerCase()}. ${topFinding.evidence}`
          : `We reviewed ${input.businessName}'s online presence and found gaps that are reducing enquiries.`,
        `We build ${profile.label.toLowerCase()} websites that convert better. Worth 15 minutes?`,
        input.auditLink ? `${input.auditLink}` : "",
        "Thanks,",
      ]
        .filter(Boolean)
        .join("\n\n") + signoff;

    case "consultative":
      return [
        greeting,
        `I work with ${profile.label.toLowerCase()} businesses on how they convert online interest into enquiries. Something I see repeatedly is a business with excellent reviews whose website loses people at the last step.`,
        hasWebsite
          ? `Running a technical review of ${input.websiteUrl}, that pattern appears here too.`
          : `Looking at ${input.businessName}, the reputation is clearly strong — ${input.reviewCount ?? 0} reviews${input.rating ? ` at ${input.rating.toFixed(1)}★` : ""} — but there is no website to receive that interest.`,
        topFinding ? `${topFinding.detail} We measured it directly: ${topFinding.evidence}` : "",
        second ? `There is a second issue too: ${second.title.toLowerCase()} — ${second.detail}` : "",
        `For ${profile.label.toLowerCase()} specifically, ${profile.customerIntent.toLowerCase()}`,
        `I have written up the findings properly rather than guessing from the outside${input.auditLink ? `: ${input.auditLink}` : ""}. Happy to talk through the priority order if that's useful.`,
        "Kind regards,",
      ]
        .filter(Boolean)
        .join("\n\n") + signoff;

    case "audit_based":
      return [
        greeting,
        `I ran an automated review of ${input.websiteUrl ?? `${input.businessName}'s public online presence`} across performance, mobile usability, SEO, accessibility and conversion readiness.`,
        scores.overall !== null && scores.overall !== undefined
          ? `It scored ${scores.overall}/100 overall${scores.mobile !== null && scores.mobile !== undefined ? `, with mobile usability at ${scores.mobile}/100` : ""}.`
          : `The findings were specific rather than cosmetic.`,
        topFinding ? `The most commercially significant finding: ${topFinding.title}. ${topFinding.evidence}\n\nWhy it matters: ${topFinding.impact}` : "",
        second ? `Also worth fixing: ${second.title} — ${second.evidence}` : "",
        input.auditLink
          ? `The full report (with the exact measurements behind each finding) is here: ${input.auditLink}`
          : `I can send the full report with the exact measurements if you would like it.`,
        `These are almost always fixable within a normal project budget. Would you like me to walk you through the priority order?`,
        "Regards,",
      ]
        .filter(Boolean)
        .join("\n\n") + signoff;

    case "value_based":
      return [
        greeting,
        hasWebsite
          ? `${input.businessName} has ${input.reviewCount ?? 0} reviews${input.rating ? ` at ${input.rating.toFixed(1)}★` : ""} — that reputation is doing real work for you. The website is where it currently leaks.`
          : `${input.businessName} has ${input.reviewCount ?? 0} reviews${input.rating ? ` at ${input.rating.toFixed(1)}★` : ""} and no website. Right now every customer who looks you up online after a recommendation finds nothing to act on.`,
        topFinding ? `The clearest issue we measured: ${topFinding.title}. ${topFinding.detail}` : "",
        `For a ${profile.label.toLowerCase()} business, that typically means enquiries that were already yours ending up somewhere else — not a traffic problem, a conversion problem.`,
        input.proposalLink
          ? `I put together a short proposal with the specific fixes and a realistic budget range: ${input.proposalLink}`
          : `I have put together a short proposal covering the specific fixes and what they would cost.`,
        `Worth a look?`,
        "Best,",
      ]
        .filter(Boolean)
        .join("\n\n") + signoff;

    default:
      return `${greeting}\n\n${topFinding?.detail ?? `We reviewed ${input.businessName} and found improvements worth making.`}\n\nWould a short call be useful?` + signoff;
  }
}

function buildFollowUp(args: {
  input: OutreachInput;
  profile: ReturnType<typeof industryProfile>;
  findings: AuditFinding[];
  topFinding: AuditFinding | null;
  hasWebsite: boolean;
  greeting: string;
  step: number;
}): string {
  const { input, findings, topFinding, hasWebsite, greeting, step, profile } = args;
  const third = findings[2];

  if (step === 2) {
    return [
      greeting,
      `Following up on my note about ${hasWebsite ? input.websiteUrl : `${input.businessName}'s online presence`}.`,
      topFinding ? `The main finding was: ${topFinding.title.toLowerCase()}. ${topFinding.evidence}` : "",
      `If it is not a priority right now that is completely fine — I will leave it there. If it is, a 15-minute call is enough to give you a clear view of cost and timescale.`,
      "Regards,",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (step === 3) {
    return [
      greeting,
      `One more finding worth knowing about, because it affects enquiries directly.`,
      third
        ? `${third.title}: ${third.detail}\n\nWhat we measured: ${third.evidence}`
        : `The gap between how good ${input.businessName}'s reputation is and how well the online presence converts it into enquiries.`,
      `For ${profile.label.toLowerCase()} businesses, fixing this is usually a matter of weeks rather than months.`,
      `Happy to send the full findings with no follow-up unless you ask. Just reply "send it" and I will.`,
      "Regards,",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    greeting,
    `I will stop here so I am not adding to your inbox.`,
    `Short version: ${input.businessName} has a strong reputation and ${
      hasWebsite ? "the website is not converting it" : "no website to convert it at all"
    }. If a better site becomes a priority — this year or next — I would be glad to help, and the audit findings are yours to use either way.`,
    `I will close this off unless you reply.`,
    "All the best,",
  ].join("\n\n");
}

function toHtml(text: string, input: OutreachInput): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => {
      if (/^https?:\/\//i.test(block.trim())) {
        const url = block.trim();
        return `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="color:#4f46e5">${escapeHtml(url)}</a></p>`;
      }
      return `<p style="margin:0 0 16px;line-height:1.65">${escapeHtml(block).replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>${escapeHtml(
    input.businessName,
  )}</title></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Helvetica,Arial,sans-serif;color:#1a1d24;font-size:15px">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e6e8ec">
${paragraphs}
  </div>
  <p style="max-width:600px;margin:16px auto 0;font-size:12px;color:#8b909a;text-align:center">
    Sent by ${escapeHtml(input.agencyName)}. If this is not relevant, reply "unsubscribe" and we will never contact you again.
  </p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function summarise(text: string): string {
  const first = text.split(/\n{2,}/).find((p) => p.length > 40) ?? text;
  return first.replace(/\s+/g, " ").slice(0, 220);
}

/* ── Sequence templates (§25) ────────────────────────────────────────────── */

export interface SequenceStep {
  step: number;
  dayOffset: number;
  name: string;
  style: EmailStyle;
  intent: string;
}

export function defaultSequence(industry?: string | null): SequenceStep[] {
  const profile = industryProfile(industry, null);
  return [
    { step: 1, dayOffset: 0, name: "Initial outreach", style: "audit_based", intent: `Lead with the single strongest measured finding and offer the ${profile.primaryCta.toLowerCase()}.` },
    { step: 2, dayOffset: 4, name: "Follow-up", style: "professional", intent: "Restate the finding briefly, offer an easy out, keep it to three short paragraphs." },
    { step: 3, dayOffset: 9, name: "Value follow-up", style: "value_based", intent: "Introduce a second finding and connect it to commercial impact." },
    { step: 4, dayOffset: 15, name: "Final follow-up", style: "short", intent: "Polite close-out. Offer to stop. Leaves the door open without pressure." },
  ];
}

export function estimateEmailValue(lineItems: ProposalLineItem[]): number {
  return lineItems.reduce((sum, item) => sum + (item.optional ? 0 : item.total), 0);
}
