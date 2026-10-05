import "server-only";

import { createProject, updateProject, createTask } from "../db/repo/ops";
import { getLead, listActivities, recordActivity, updateLead } from "../db/repo/lead";
import { getBusiness, listContacts, latestAuditForBusiness } from "../db/repo/business";
import { getProposal } from "../db/repo/engagement";
import { notify } from "./notifications";
import { one } from "../db";
import type { Project } from "../db/repo/types";
import { logger } from "../logger";

/**
 * Lead → project conversion (§34, §43).
 *
 * Winning a lead should not require retyping anything. The conversion carries
 * the approved proposal, the audit report, the recommended concept and the
 * agreed price into a project record with a delivery checklist.
 */

export interface ConversionCheck {
  allowed: boolean;
  blockers: string[];
  warnings: string[];
  suggestedName: string;
  suggestedValue: number;
  currency: string;
}

export function conversionChecks(orgId: string, leadId: string): ConversionCheck {
  const lead = getLead(orgId, leadId);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!lead) {
    return { allowed: false, blockers: ["Lead not found."], warnings: [], suggestedName: "", suggestedValue: 0, currency: "GBP" };
  }

  const business = getBusiness(orgId, lead.businessId);
  const proposalRow = one<{ id: string }>("SELECT id FROM proposals WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1", [leadId]);
  const proposal = proposalRow ? getProposal(orgId, proposalRow.id) : null;

  if (lead.status !== "won") blockers.push("Only won leads can be converted. Move the lead to Won first — conversion records the moment delivery starts.");
  if (!business) blockers.push("The business record is missing, so there is nothing to deliver against.");

  const audit = business ? latestAuditForBusiness(orgId, business.id) : null;
  if (!audit) warnings.push("No website audit is linked to this project. The delivery team will start without the baseline report.");
  if (!proposal) warnings.push("No proposal is linked. Scope and price will need to be entered manually in the project.");
  if (!lead.estimatedValue) warnings.push("No project value is recorded on the lead, so the project budget will start at zero.");
  if (!lead.ownerId) warnings.push("No owner is assigned. Assign someone so the project has an accountable lead.");

  return {
    allowed: blockers.length === 0,
    blockers,
    warnings,
    suggestedName: business ? `${business.name} — website project` : "Website project",
    suggestedValue: lead.estimatedValue ?? 0,
    currency: lead.currency,
  };
}

export interface ConvertResult {
  ok: boolean;
  message: string;
  project: Project | null;
}

export function convertLeadToProject(
  orgId: string,
  leadId: string,
  options: {
    userId: string;
    name?: string;
    startDate?: string;
    deadline?: string;
    budget?: number | null;
    ownerId?: string | null;
    createKickoffTask?: boolean;
  },
): ConvertResult {
  const check = conversionChecks(orgId, leadId);
  if (!check.allowed) {
    return { ok: false, message: check.blockers.join(" "), project: null };
  }

  const lead = getLead(orgId, leadId)!;
  const business = getBusiness(orgId, lead.businessId)!;
  const proposalRow = one<{ id: string }>("SELECT id FROM proposals WHERE lead_id = ? ORDER BY created_at DESC LIMIT 1", [leadId]);
  const proposal = proposalRow ? getProposal(orgId, proposalRow.id) : null;
  const audit = latestAuditForBusiness(orgId, business.id);
  const contacts = listContacts(orgId, { businessId: business.id, limit: 5 });

  const start = options.startDate ?? new Date().toISOString();
  const deadline = options.deadline ?? new Date(Date.now() + 6 * 7 * 86_400_000).toISOString();

  const project = createProject(orgId, {
    name: options.name ?? check.suggestedName,
    leadId,
    businessId: business.id,
    proposalId: proposal?.id ?? null,
    status: "discovery",
    startDate: start,
    deadline,
    budget: options.budget ?? check.suggestedValue,
    currency: lead.currency,
    ownerId: options.ownerId ?? lead.ownerId,
    scope: (proposal?.sections.find((s) => s.key === "pages")?.bullets ?? []).map((bullet) => ({
      name: bullet.split(":")[0]?.trim() ?? bullet,
      detail: bullet.includes(":") ? bullet.slice(bullet.indexOf(":") + 1).trim() : bullet,
    })),
    requirements: [
      `Audit: ${audit ? `score ${audit.overallScore ?? "not scored"}/100 on ${audit.url ?? business.websiteUrl ?? "the current site"} (${audit.findings.length} findings)` : "no audit linked yet"}`,
      `Website: ${business.websiteUrl ?? "no existing website — new build"}`,
      `Primary contact: ${contacts[0]?.name ?? "not identified"}${contacts[0]?.email ? ` <${contacts[0].email}>` : ""}${contacts[0]?.phone ? ` · ${contacts[0].phone}` : ""}`,
      `Industry: ${business.industry ?? "not recorded"} · Location: ${[business.city, business.country].filter(Boolean).join(", ") || "not recorded"}`,
      proposal ? `Proposal ${proposal.number}: ${proposal.currency} ${proposal.total.toLocaleString()}, ${proposal.timelineWeeks ?? "?"} weeks` : "No proposal linked — confirm scope and price before kick-off",
    ],
    design: {
      concept: (proposal?.concept as Record<string, unknown> | undefined)?.preview ?? null,
      pages: (proposal?.sections.find((s) => s.key === "pages")?.bullets ?? []).length,
    },
    notes: `Converted from lead ${lead.reference} on ${new Date().toLocaleDateString("en-GB")}.`,
  });

  updateLead(orgId, leadId, { nextAction: `Delivery started as ${project.code}. Hand over to the project owner.` });

  recordActivity(orgId, {
    leadId,
    businessId: business.id,
    userId: options.userId,
    type: "project_created",
    subject: `Project ${project.code} created`,
    body: `${business.name} moved from sales to delivery. Budget ${lead.currency} ${(options.budget ?? check.suggestedValue).toLocaleString()}.`,
    metadata: { projectId: project.id, code: project.code },
  });

  if (options.createKickoffTask !== false) {
    const tasks: { title: string; type: string; priority: "low" | "medium" | "high" | "urgent"; days: number }[] = [
      { title: "Send the welcome pack and confirm the delivery contact", type: "admin", priority: "high", days: 1 },
      { title: "Kick-off call: confirm scope, timeline and approvals", type: "meeting", priority: "urgent", days: 3 },
      { title: "Collect brand assets, imagery and access credentials", type: "admin", priority: "high", days: 5 },
      { title: "Design phase 1 — homepage and core templates", type: "design", priority: "medium", days: 10 },
      { title: "Schedule the launch and handover checklist", type: "launch", priority: "low", days: 30 },
    ];
    for (const task of tasks) {
      createTask(orgId, {
        title: task.title,
        description: `Project ${project.code}`,
        type: task.type,
        priority: task.priority,
        dueAt: new Date(Date.now() + task.days * 86_400_000).toISOString(),
        projectId: project.id,
        leadId,
        businessId: business.id,
        assignedUserId: options.ownerId ?? lead.ownerId ?? null,
      });
    }
  }

  notify(orgId, {
    type: "system",
    title: `Project ${project.code} created for ${business.name}`,
    body: "Scope, audit findings and the approved proposal were carried across. A kick-off checklist is ready in Tasks.",
    entityType: "project",
    entityId: project.id,
    actionUrl: `/projects/${project.id}`,
    severity: "success",
  });

  logger.info("projects", "Lead converted to project", { leadId, project: project.code });

  return { ok: true, message: `Project ${project.code} created with a ${tasksLength(options)}-step kick-off checklist.`, project };
}

function tasksLength(options: { createKickoffTask?: boolean }): number {
  return options.createKickoffTask === false ? 0 : 5;
}

export function projectTimeline(orgId: string, leadId: string, projectId: string) {
  return listActivities(orgId, { leadId, limit: 60 }).map((activity) => ({ ...activity, projectId }));
}

/** Delivery health: computed from the plan rather than entered by hand. */
export function projectHealth(project: Project, openTasks: { dueAt: string | null; status: string }[]): {
  health: "on_track" | "at_risk" | "delayed" | "blocked";
  reason: string;
} {
  const now = Date.now();
  const overdue = openTasks.filter((task) => task.status !== "done" && task.dueAt && new Date(task.dueAt).getTime() < now);
  const deadline = project.deadline ? new Date(project.deadline).getTime() : null;

  if (overdue.some((task) => now - new Date(task.dueAt!).getTime() > 14 * 86_400_000)) {
    return { health: "delayed", reason: `${overdue.filter((t) => now - new Date(t.dueAt!).getTime() > 14 * 86_400_000).length} task(s) more than two weeks overdue.` };
  }
  if (overdue.length > 0) {
    return { health: "at_risk", reason: `${overdue.length} task(s) past their due date.` };
  }
  if (deadline && deadline < now && project.status !== "completed") {
    return { health: "delayed", reason: "The planned deadline has passed and the project is still open." };
  }
  if (project.status === "on_hold") {
    return { health: "blocked", reason: "The project is on hold." };
  }
  return { health: "on_track", reason: "All tasks are inside their due dates." };
}

export function archiveProject(orgId: string, projectId: string, userId: string): Project | null {
  const project = updateProject(orgId, projectId, { status: "completed", completedAt: new Date().toISOString() });
  if (project) {
    notify(orgId, {
      type: "system",
      title: `Project ${project.code} completed`,
      body: "The delivery checklist is closed. Consider asking for a testimonial and a referral.",
      entityType: "project",
      entityId: projectId,
      actionUrl: `/projects/${projectId}`,
      severity: "success",
    });
  }
  return project;
}
