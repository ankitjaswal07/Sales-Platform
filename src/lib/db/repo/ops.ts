import "server-only";

import { all, insert, one, parseJson, run, toBool, update } from "..";
import { newId, reference } from "../../ids";
import type {
  IntegrationStatus,
  JobStatus,
  JobType,
  NotificationType,
  ProjectStatus,
  Severity,
  TaskPriority,
  TaskStatus,
  EmailStyle,
} from "../../types";
import type {
  AlertRule,
  DiscoveryRun,
  Integration,
  Job,
  Notification,
  PricingPlan,
  Project,
  Service,
  Task,
} from "./types";

/* ══════════════════════════════════════════════════════════════════════════
   Tasks (§23)
   ══════════════════════════════════════════════════════════════════════════ */

interface TaskRow {
  id: string; org_id: string; lead_id: string | null; business_id: string | null; project_id: string | null;
  title: string; description: string | null; type: string; priority: string; status: string;
  due_at: string | null; assigned_user_id: string | null; created_by: string | null; completed_at: string | null;
  reminder_sent_at: string | null; created_at: string; updated_at: string;
  business_name?: string | null; assignee_name?: string | null;
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    orgId: row.org_id,
    leadId: row.lead_id,
    businessId: row.business_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    dueAt: row.due_at,
    assignedUserId: row.assigned_user_id,
    createdBy: row.created_by,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    businessName: row.business_name ?? null,
    assigneeName: row.assignee_name ?? null,
  };
}

export function listTasks(orgId: string, filter: {
  status?: TaskStatus[];
  assignedUserId?: string;
  leadId?: string;
  projectId?: string;
  dueBefore?: string;
  overdue?: boolean;
  limit?: number;
  offset?: number;
} = {}): { items: Task[]; total: number } {
  const clauses = ["t.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.status?.length) {
    clauses.push(`t.status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.assignedUserId) { clauses.push("t.assigned_user_id = ?"); params.push(filter.assignedUserId); }
  if (filter.leadId) { clauses.push("t.lead_id = ?"); params.push(filter.leadId); }
  if (filter.projectId) { clauses.push("t.project_id = ?"); params.push(filter.projectId); }
  if (filter.dueBefore) { clauses.push("t.due_at IS NOT NULL AND t.due_at <= ?"); params.push(filter.dueBefore); }
  if (filter.overdue) clauses.push("t.due_at IS NOT NULL AND t.due_at < datetime('now') AND t.status NOT IN ('done','cancelled')");
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<TaskRow>(
    `SELECT t.*, b.name AS business_name, u.name AS assignee_name FROM tasks t
     LEFT JOIN businesses b ON b.id = t.business_id
     LEFT JOIN users u ON u.id = t.assigned_user_id
     ${where} ORDER BY CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC, t.priority DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 300), filter.offset ?? 0],
  ).map(mapTask);
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM tasks t ${where}`, params)?.total ?? 0;
  return { items, total };
}

export function getTask(orgId: string, taskId: string): Task | null {
  const row = one<TaskRow>(
    `SELECT t.*, b.name AS business_name, u.name AS assignee_name FROM tasks t
     LEFT JOIN businesses b ON b.id = t.business_id LEFT JOIN users u ON u.id = t.assigned_user_id
     WHERE t.id = ? AND t.org_id = ?`,
    [taskId, orgId],
  );
  return row ? mapTask(row) : null;
}

export function createTask(orgId: string, input: {
  title: string;
  description?: string | null;
  type?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueAt?: string | null;
  leadId?: string | null;
  businessId?: string | null;
  projectId?: string | null;
  assignedUserId?: string | null;
  createdBy?: string | null;
}): Task {
  const id = newId("tsk");
  const timestamp = new Date().toISOString();
  insert("tasks", {
    id,
    org_id: orgId,
    lead_id: input.leadId ?? null,
    business_id: input.businessId ?? null,
    project_id: input.projectId ?? null,
    title: input.title,
    description: input.description ?? null,
    type: input.type ?? "follow_up",
    priority: input.priority ?? "medium",
    status: input.status ?? "open",
    due_at: input.dueAt ?? null,
    assigned_user_id: input.assignedUserId ?? null,
    created_by: input.createdBy ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getTask(orgId, id)!;
}

export function updateTask(orgId: string, taskId: string, patch: Partial<Task>): Task | null {
  const columnMap: Record<string, string> = {
    title: "title", description: "description", type: "type", priority: "priority", status: "status",
    dueAt: "due_at", assignedUserId: "assigned_user_id", completedAt: "completed_at",
    reminderSentAt: "reminder_sent_at", projectId: "project_id",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!values.completed_at && patch.status === "done") values.completed_at = new Date().toISOString();
  if (!Object.keys(values).length) return getTask(orgId, taskId);
  values.updated_at = new Date().toISOString();
  update("tasks", taskId, values);
  return getTask(orgId, taskId);
}

export function taskCounts(orgId: string): { open: number; overdue: number; today: number; done: number } {
  const row = one<{ open: number; overdue: number; today: number; done: number }>(
    `SELECT
       SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN status IN ('open','in_progress') AND due_at IS NOT NULL AND due_at < datetime('now') THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN status IN ('open','in_progress') AND date(due_at) = date('now') THEN 1 ELSE 0 END) AS today,
       SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
     FROM tasks WHERE org_id = ?`,
    [orgId],
  );
  return { open: row?.open ?? 0, overdue: row?.overdue ?? 0, today: row?.today ?? 0, done: row?.done ?? 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
   Projects (§40)
   ══════════════════════════════════════════════════════════════════════════ */

interface ProjectRow {
  id: string; org_id: string; lead_id: string | null; business_id: string; proposal_id: string | null;
  code: string; name: string; status: string; health: string; start_date: string | null;
  deadline: string | null; completed_at: string | null; budget: number | null; currency: string;
  owner_id: string | null; team_json: string; scope_json: string; requirements_json: string;
  design_json: string; notes: string | null; created_at: string; updated_at: string;
  business_name?: string | null; owner_name?: string | null;
}

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    orgId: row.org_id,
    leadId: row.lead_id,
    businessId: row.business_id,
    proposalId: row.proposal_id,
    code: row.code,
    name: row.name,
    status: row.status as ProjectStatus,
    health: row.health,
    startDate: row.start_date,
    deadline: row.deadline,
    completedAt: row.completed_at,
    budget: row.budget,
    currency: row.currency,
    ownerId: row.owner_id,
    team: parseJson<{ userId: string; role: string }[]>(row.team_json, []),
    scope: parseJson<{ name: string; detail: string }[]>(row.scope_json, []),
    requirements: parseJson<string[]>(row.requirements_json, []),
    design: parseJson<Record<string, unknown>>(row.design_json, {}),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    businessName: row.business_name ?? undefined,
    ownerName: row.owner_name ?? null,
  };
}

export function listProjects(orgId: string, filter: { status?: ProjectStatus[]; limit?: number; offset?: number; ownerId?: string } = {}): { items: Project[]; total: number } {
  const clauses = ["p.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.status?.length) {
    clauses.push(`p.status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.ownerId) { clauses.push("p.owner_id = ?"); params.push(filter.ownerId); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<ProjectRow>(
    `SELECT p.*, b.name AS business_name, u.name AS owner_name FROM projects p
     JOIN businesses b ON b.id = p.business_id LEFT JOIN users u ON u.id = p.owner_id
     ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 200), filter.offset ?? 0],
  ).map((row) => {
    const project = mapProject(row);
    project.taskCounts = projectTaskCounts(row.id);
    return project;
  });
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM projects p ${where}`, params)?.total ?? 0;
  return { items, total };
}

export function getProject(orgId: string, projectId: string): Project | null {
  const row = one<ProjectRow>(
    `SELECT p.*, b.name AS business_name, u.name AS owner_name FROM projects p
     JOIN businesses b ON b.id = p.business_id LEFT JOIN users u ON u.id = p.owner_id
     WHERE p.id = ? AND p.org_id = ?`,
    [projectId, orgId],
  );
  if (!row) return null;
  const project = mapProject(row);
  project.taskCounts = projectTaskCounts(projectId);
  return project;
}

function projectTaskCounts(projectId: string): { open: number; done: number } {
  const row = one<{ open: number; done: number }>(
    `SELECT SUM(CASE WHEN status IN ('open','in_progress') THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
     FROM tasks WHERE project_id = ?`,
    [projectId],
  );
  return { open: row?.open ?? 0, done: row?.done ?? 0 };
}

export function nextProjectCode(orgId: string): string {
  const count = one<{ c: number }>("SELECT COUNT(*) AS c FROM projects WHERE org_id = ?", [orgId])?.c ?? 0;
  return `PRJ-${String(count + 1).padStart(3, "0")}`;
}

export function createProject(orgId: string, input: {
  businessId: string;
  leadId?: string | null;
  proposalId?: string | null;
  name: string;
  status?: ProjectStatus;
  startDate?: string | null;
  deadline?: string | null;
  budget?: number | null;
  currency?: string;
  ownerId?: string | null;
  team?: { userId: string; role: string }[];
  scope?: { name: string; detail: string }[];
  requirements?: string[];
  design?: Record<string, unknown>;
  notes?: string | null;
}): Project {
  const id = newId("prj");
  const timestamp = new Date().toISOString();
  insert("projects", {
    id,
    org_id: orgId,
    lead_id: input.leadId ?? null,
    business_id: input.businessId,
    proposal_id: input.proposalId ?? null,
    code: `${nextProjectCode(orgId)}-${reference("P").split("-")[1]}`,
    name: input.name,
    status: input.status ?? "discovery",
    health: "on_track",
    start_date: input.startDate ?? timestamp.slice(0, 10),
    deadline: input.deadline ?? null,
    budget: input.budget ?? null,
    currency: input.currency ?? "GBP",
    owner_id: input.ownerId ?? null,
    team_json: input.team ?? [],
    scope_json: input.scope ?? [],
    requirements_json: input.requirements ?? [],
    design_json: input.design ?? {},
    notes: input.notes ?? null,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return getProject(orgId, id)!;
}

export function updateProject(orgId: string, projectId: string, patch: Partial<Project>): Project | null {
  const columnMap: Record<string, string> = {
    name: "name", status: "status", health: "health", startDate: "start_date", deadline: "deadline",
    completedAt: "completed_at", budget: "budget", ownerId: "owner_id", team: "team_json",
    scope: "scope_json", requirements: "requirements_json", design: "design_json", notes: "notes",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (patch.status === "completed") values.completed_at = new Date().toISOString();
  if (!Object.keys(values).length) return getProject(orgId, projectId);
  values.updated_at = new Date().toISOString();
  update("projects", projectId, values);
  return getProject(orgId, projectId);
}

/* ══════════════════════════════════════════════════════════════════════════
   Services & pricing (§31)
   ══════════════════════════════════════════════════════════════════════════ */

interface ServiceRow {
  id: string; org_id: string; key: string; name: string; category: string; description: string | null;
  starting_price: number; price: number | null; currency: string; billing: string;
  timeline_days_min: number; timeline_days_max: number; features_json: string; addons_json: string;
  complexity_weight: number; is_active: number; sort_order: number;
}

function mapService(row: ServiceRow): Service {
  return {
    id: row.id,
    orgId: row.org_id,
    key: row.key,
    name: row.name,
    category: row.category,
    description: row.description,
    startingPrice: row.starting_price,
    price: row.price,
    currency: row.currency,
    billing: row.billing,
    timelineDaysMin: row.timeline_days_min,
    timelineDaysMax: row.timeline_days_max,
    features: parseJson<string[]>(row.features_json, []),
    addons: parseJson<{ name: string; price: number }[]>(row.addons_json, []),
    complexityWeight: row.complexity_weight,
    isActive: toBool(row.is_active),
    sortOrder: row.sort_order,
  };
}

export function listServices(orgId: string, includeInactive = false): Service[] {
  return all<ServiceRow>(
    `SELECT * FROM services WHERE org_id = ? ${includeInactive ? "" : "AND is_active = 1"} ORDER BY sort_order ASC, name ASC`,
    [orgId],
  ).map(mapService);
}

export function getService(orgId: string, serviceId: string): Service | null {
  const row = one<ServiceRow>("SELECT * FROM services WHERE id = ? AND org_id = ?", [serviceId, orgId]);
  return row ? mapService(row) : null;
}

export function upsertService(orgId: string, input: {
  id?: string;
  key: string;
  name: string;
  category?: string;
  description?: string | null;
  startingPrice?: number;
  price?: number | null;
  currency?: string;
  billing?: string;
  timelineDaysMin?: number;
  timelineDaysMax?: number;
  features?: string[];
  addons?: { name: string; price: number }[];
  complexityWeight?: number;
  isActive?: boolean;
  sortOrder?: number;
}): Service {
  if (input.id) {
    const existing = getService(orgId, input.id);
    if (existing) {
      update("services", input.id, {
        name: input.name,
        category: input.category ?? existing.category,
        description: input.description ?? existing.description,
        starting_price: input.startingPrice ?? existing.startingPrice,
        price: input.price ?? existing.price,
        billing: input.billing ?? existing.billing,
        timeline_days_min: input.timelineDaysMin ?? existing.timelineDaysMin,
        timeline_days_max: input.timelineDaysMax ?? existing.timelineDaysMax,
        features_json: input.features ?? existing.features,
        addons_json: input.addons ?? existing.addons,
        complexity_weight: input.complexityWeight ?? existing.complexityWeight,
        is_active: input.isActive === undefined ? (existing.isActive ? 1 : 0) : input.isActive ? 1 : 0,
        sort_order: input.sortOrder ?? existing.sortOrder,
      });
      return getService(orgId, input.id)!;
    }
  }

  const id = newId("svc");
  insert("services", {
    id,
    org_id: orgId,
    key: input.key,
    name: input.name,
    category: input.category ?? "website",
    description: input.description ?? null,
    starting_price: input.startingPrice ?? 0,
    price: input.price ?? null,
    currency: input.currency ?? "GBP",
    billing: input.billing ?? "one_off",
    timeline_days_min: input.timelineDaysMin ?? 7,
    timeline_days_max: input.timelineDaysMax ?? 30,
    features_json: input.features ?? [],
    addons_json: input.addons ?? [],
    complexity_weight: input.complexityWeight ?? 1,
    is_active: input.isActive === false ? 0 : 1,
    sort_order: input.sortOrder ?? 0,
  });
  return getService(orgId, id)!;
}

export function deleteService(orgId: string, serviceId: string): void {
  run("DELETE FROM services WHERE id = ? AND org_id = ?", [serviceId, orgId]);
}

interface PlanRow {
  id: string; org_id: string; name: string; description: string | null; price: number; currency: string;
  billing: string; pages_included: number | null; features_json: string; is_popular: number;
  is_active: number; sort_order: number;
}

function mapPlan(row: PlanRow): PricingPlan {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    price: row.price,
    currency: row.currency,
    billing: row.billing,
    pagesIncluded: row.pages_included,
    features: parseJson<string[]>(row.features_json, []),
    isPopular: toBool(row.is_popular),
    isActive: toBool(row.is_active),
    sortOrder: row.sort_order,
  };
}

export function listPricingPlans(orgId: string, includeInactive = false): PricingPlan[] {
  return all<PlanRow>(
    `SELECT * FROM pricing_plans WHERE org_id = ? ${includeInactive ? "" : "AND is_active = 1"} ORDER BY sort_order ASC`,
    [orgId],
  ).map(mapPlan);
}

export function upsertPricingPlan(orgId: string, input: {
  id?: string; name: string; description?: string | null; price?: number; currency?: string;
  billing?: string; pagesIncluded?: number | null; features?: string[];
  isPopular?: boolean; isActive?: boolean; sortOrder?: number;
}): PricingPlan {
  if (input.id) {
    const existing = one<PlanRow>("SELECT * FROM pricing_plans WHERE id = ? AND org_id = ?", [input.id, orgId]);
    if (existing) {
      update("pricing_plans", input.id, {
        name: input.name,
        description: input.description ?? existing.description,
        price: input.price ?? existing.price,
        billing: input.billing ?? existing.billing,
        pages_included: input.pagesIncluded ?? existing.pages_included,
        features_json: input.features ?? parseJson<string[]>(existing.features_json, []),
        is_popular: input.isPopular === undefined ? existing.is_popular : input.isPopular ? 1 : 0,
        is_active: input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
        sort_order: input.sortOrder ?? existing.sort_order,
      });
      return mapPlan(one<PlanRow>("SELECT * FROM pricing_plans WHERE id = ?", [input.id])!);
    }
  }
  const id = newId("pln");
  insert("pricing_plans", {
    id,
    org_id: orgId,
    name: input.name,
    description: input.description ?? null,
    price: input.price ?? 0,
    currency: input.currency ?? "GBP",
    billing: input.billing ?? "one_off",
    pages_included: input.pagesIncluded ?? null,
    features_json: input.features ?? [],
    is_popular: input.isPopular ? 1 : 0,
    is_active: input.isActive === false ? 0 : 1,
    sort_order: input.sortOrder ?? 0,
  });
  return mapPlan(one<PlanRow>("SELECT * FROM pricing_plans WHERE id = ?", [id])!);
}

export function deletePricingPlan(orgId: string, planId: string): void {
  run("DELETE FROM pricing_plans WHERE id = ? AND org_id = ?", [planId, orgId]);
}

/** Seed the agency's default catalogue on first run. */
export function seedDefaultCatalogue(orgId: string): void {
  const existing = one<{ c: number }>("SELECT COUNT(*) AS c FROM services WHERE org_id = ?", [orgId]);
  if ((existing?.c ?? 0) > 0) return;

  const services: Omit<Parameters<typeof upsertService>[1], "id">[] = [
    { key: "website_design", name: "Website Design", category: "website", description: "Custom-designed website built around your conversion goals, with a component library and full mobile support.", startingPrice: 2400, timelineDaysMin: 14, timelineDaysMax: 35, features: ["Custom UI design", "Responsive across all devices", "Component library", "Two rounds of revision"], complexityWeight: 1.2, sortOrder: 1 },
    { key: "website_redesign", name: "Website Redesign", category: "website", description: "Rebuild of an existing website that fixes measured performance, mobile, SEO and conversion problems.", startingPrice: 2800, timelineDaysMin: 14, timelineDaysMax: 40, features: ["Full audit-driven rebuild", "Content migration", "Redirect mapping", "Conversion optimisation"], complexityWeight: 1.25, sortOrder: 2 },
    { key: "wordpress_development", name: "WordPress Development", category: "platform", description: "WordPress build with a clean custom theme, editor-friendly content structure and no bloated page builders.", startingPrice: 2200, timelineDaysMin: 14, timelineDaysMax: 30, features: ["Custom theme", "Gutenberg blocks", "Speed-tuned", "Security hardening"], complexityWeight: 1.1, sortOrder: 3 },
    { key: "ecommerce_development", name: "E-commerce Development", category: "commerce", description: "Online store with product catalogue, secure checkout, payments, shipping rules and abandoned-basket recovery.", startingPrice: 5200, timelineDaysMin: 28, timelineDaysMax: 70, features: ["Product catalogue", "Secure checkout", "Payment providers", "Shipping & tax rules", "Order management"], complexityWeight: 1.9, sortOrder: 4 },
    { key: "landing_pages", name: "Landing Pages", category: "website", description: "High-converting single-page campaigns for paid traffic, with A/B test variants.", startingPrice: 900, timelineDaysMin: 5, timelineDaysMax: 12, features: ["Conversion-focused layout", "Form and tracking setup", "A/B variant", "Speed optimised"], complexityWeight: 0.7, sortOrder: 5 },
    { key: "seo", name: "SEO", category: "marketing", description: "Technical SEO foundation plus local search work, structured data and content structure.", startingPrice: 1100, billing: "one_off", timelineDaysMin: 14, timelineDaysMax: 45, features: ["Technical audit and fixes", "Local SEO and Google Business Profile", "Structured data", "Keyword mapping"], complexityWeight: 1, sortOrder: 6 },
    { key: "website_maintenance", name: "Website Maintenance", category: "support", description: "Ongoing care plan: updates, backups, security monitoring, uptime alerts and minor content changes.", startingPrice: 85, billing: "monthly", timelineDaysMin: 0, timelineDaysMax: 0, features: ["Weekly backups", "Security patching", "Uptime monitoring", "Two hours of changes monthly"], complexityWeight: 0.3, sortOrder: 7 },
    { key: "speed_optimization", name: "Speed Optimization", category: "performance", description: "Performance work on an existing site: image pipeline, caching, script reduction and Core Web Vitals tuning.", startingPrice: 750, timelineDaysMin: 5, timelineDaysMax: 14, features: ["Asset optimisation", "Caching configuration", "Script audit", "Before/after Core Web Vitals report"], complexityWeight: 0.6, sortOrder: 8 },
    { key: "conversion_optimization", name: "Conversion Optimization", category: "marketing", description: "Research-led improvements to enquiry paths, forms, CTAs and trust signals, measured against baseline.", startingPrice: 1200, billing: "monthly", timelineDaysMin: 20, timelineDaysMax: 60, features: ["Baseline measurement", "Funnel review", "CTA and form testing", "Monthly reporting"], complexityWeight: 0.9, sortOrder: 9 },
    { key: "copywriting", name: "Conversion Copywriting", category: "content", description: "Service-page, homepage and CTA copy written for the way your customers actually decide.", startingPrice: 950, timelineDaysMin: 7, timelineDaysMax: 21, features: ["Message hierarchy", "Service page copy", "CTA and microcopy", "SEO-aware structure"], complexityWeight: 0.8, sortOrder: 10 },
  ];
  services.forEach((service) => upsertService(orgId, service));

  const plans = [
    { name: "Essential", description: "For small local businesses that need a credible, fast, mobile-first site that generates enquiries.", price: 2400, pagesIncluded: 5, features: ["5-page custom design", "Mobile-first build", "Contact form and click-to-call", "Local SEO foundation", "Analytics with conversion tracking", "30 days post-launch support"], sortOrder: 1 },
    { name: "Professional", description: "Our most popular scope: a conversion-focused site with booking, proof sections and a local SEO programme.", price: 5200, pagesIncluded: 12, features: ["Everything in Essential", "Up to 12 pages", "Online booking integration", "Conversion copywriting", "Google Business Profile optimisation", "Monthly enquiry reporting", "90 days post-launch support"], isPopular: true, sortOrder: 2 },
    { name: "Growth", description: "For businesses competing in a crowded market where content, speed and conversion all need to be excellent.", price: 9800, pagesIncluded: 25, features: ["Everything in Professional", "Up to 25 pages plus service-area pages", "Content strategy and writing", "Advanced integrations", "Speed and accessibility programme", "Conversion testing programme", "Quarterly strategy review", "Care plan included for 6 months"], sortOrder: 3 },
  ];
  plans.forEach((plan) => upsertPricingPlan(orgId, plan));
}

/* ══════════════════════════════════════════════════════════════════════════
   Notifications (§21, §55)
   ══════════════════════════════════════════════════════════════════════════ */

interface NotificationRow {
  id: string; org_id: string; user_id: string | null; type: string; severity: string; title: string;
  body: string | null; entity_type: string | null; entity_id: string | null; action_url: string | null;
  icon: string | null; channels_json: string; read_at: string | null; dismissed_at: string | null; created_at: string;
}

function mapNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    type: row.type as NotificationType,
    severity: row.severity as Severity,
    title: row.title,
    body: row.body,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actionUrl: row.action_url,
    icon: row.icon,
    channels: parseJson<string[]>(row.channels_json, []),
    readAt: row.read_at,
    dismissedAt: row.dismissed_at,
    createdAt: row.created_at,
  };
}

export function createNotification(orgId: string, input: {
  userId?: string | null;
  type: NotificationType;
  severity?: Severity;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actionUrl?: string | null;
  icon?: string | null;
  channels?: string[];
}): Notification {
  const id = newId("ntf");
  insert("notifications", {
    id,
    org_id: orgId,
    user_id: input.userId ?? null,
    type: input.type,
    severity: input.severity ?? "info",
    title: input.title,
    body: input.body ?? null,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    action_url: input.actionUrl ?? null,
    icon: input.icon ?? null,
    channels_json: input.channels ?? ["in_app"],
    created_at: new Date().toISOString(),
  });
  return mapNotification(one<NotificationRow>("SELECT * FROM notifications WHERE id = ?", [id])!);
}

export function listNotifications(orgId: string, filter: { userId?: string; unreadOnly?: boolean; limit?: number } = {}): Notification[] {
  const clauses = ["org_id = ?", "(dismissed_at IS NULL)"];
  const params: unknown[] = [orgId];
  if (filter.userId) {
    clauses.push("(user_id IS NULL OR user_id = ?)");
    params.push(filter.userId);
  }
  if (filter.unreadOnly) clauses.push("read_at IS NULL");
  return all<NotificationRow>(
    `SELECT * FROM notifications WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, Math.min(filter.limit ?? 50, 200)],
  ).map(mapNotification);
}

export function unreadNotificationCount(orgId: string, userId?: string): number {
  const params: unknown[] = [orgId];
  let extra = "";
  if (userId) {
    extra = " AND (user_id IS NULL OR user_id = ?)";
    params.push(userId);
  }
  return one<{ c: number }>(`SELECT COUNT(*) AS c FROM notifications WHERE org_id = ? AND read_at IS NULL AND dismissed_at IS NULL${extra}`, params)?.c ?? 0;
}

export function markNotificationRead(orgId: string, notificationId: string): void {
  run("UPDATE notifications SET read_at = ? WHERE id = ? AND org_id = ?", [new Date().toISOString(), notificationId, orgId]);
}

export function markAllNotificationsRead(orgId: string, userId?: string): void {
  const params: unknown[] = [new Date().toISOString(), orgId];
  let extra = "";
  if (userId) {
    extra = " AND (user_id IS NULL OR user_id = ?)";
    params.push(userId);
  }
  run(`UPDATE notifications SET read_at = ? WHERE org_id = ? AND read_at IS NULL${extra}`, params);
}

export function dismissNotification(orgId: string, notificationId: string): void {
  run("UPDATE notifications SET dismissed_at = ? WHERE id = ? AND org_id = ?", [new Date().toISOString(), notificationId, orgId]);
}

/* ══════════════════════════════════════════════════════════════════════════
   Alert rules & alerts (§54)
   ══════════════════════════════════════════════════════════════════════════ */

interface AlertRuleRow {
  id: string; org_id: string; name: string; description: string | null; enabled: number;
  conditions_json: string; actions_json: string; cooldown_minutes: number; trigger_count: number;
  last_triggered_at: string | null; created_at: string; updated_at: string;
}

function mapAlertRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    description: row.description,
    enabled: toBool(row.enabled),
    conditions: parseJson<AlertRule["conditions"]>(row.conditions_json, []),
    actions: parseJson<string[]>(row.actions_json, []),
    cooldownMinutes: row.cooldown_minutes,
    triggerCount: row.trigger_count,
    lastTriggeredAt: row.last_triggered_at,
    createdAt: row.created_at,
  };
}

export function listAlertRules(orgId: string): AlertRule[] {
  return all<AlertRuleRow>("SELECT * FROM alert_rules WHERE org_id = ? ORDER BY created_at ASC", [orgId]).map(mapAlertRule);
}

export function createAlertRule(orgId: string, input: {
  name: string;
  description?: string | null;
  conditions: AlertRule["conditions"];
  actions: string[];
  cooldownMinutes?: number;
  enabled?: boolean;
}): AlertRule {
  const id = newId("alr");
  const timestamp = new Date().toISOString();
  insert("alert_rules", {
    id,
    org_id: orgId,
    name: input.name,
    description: input.description ?? null,
    enabled: input.enabled === false ? 0 : 1,
    conditions_json: input.conditions,
    actions_json: input.actions,
    cooldown_minutes: input.cooldownMinutes ?? 60,
    trigger_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return mapAlertRule(one<AlertRuleRow>("SELECT * FROM alert_rules WHERE id = ?", [id])!);
}

export function updateAlertRule(orgId: string, ruleId: string, patch: {
  name?: string; description?: string | null; enabled?: boolean;
  conditions?: AlertRule["conditions"]; actions?: string[]; cooldownMinutes?: number;
}): AlertRule | null {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.enabled !== undefined) values.enabled = patch.enabled ? 1 : 0;
  if (patch.conditions) values.conditions_json = patch.conditions;
  if (patch.actions) values.actions_json = patch.actions;
  if (patch.cooldownMinutes !== undefined) values.cooldown_minutes = patch.cooldownMinutes;
  if (Object.keys(values).length === 0) return null;
  values.updated_at = new Date().toISOString();
  update("alert_rules", ruleId, values);
  const row = one<AlertRuleRow>("SELECT * FROM alert_rules WHERE id = ? AND org_id = ?", [ruleId, orgId]);
  return row ? mapAlertRule(row) : null;
}

export function recordAlert(orgId: string, input: {
  ruleId?: string | null;
  leadId?: string | null;
  businessId?: string | null;
  severity?: Severity;
  title: string;
  body?: string | null;
  channels?: string[];
  delivery?: Record<string, unknown>;
}): string {
  const id = newId("alt");
  insert("alerts", {
    id,
    org_id: orgId,
    rule_id: input.ruleId ?? null,
    lead_id: input.leadId ?? null,
    business_id: input.businessId ?? null,
    severity: input.severity ?? "warning",
    title: input.title,
    body: input.body ?? null,
    channels_json: input.channels ?? [],
    delivery_json: input.delivery ?? {},
    created_at: new Date().toISOString(),
  });
  if (input.ruleId) {
    run("UPDATE alert_rules SET trigger_count = trigger_count + 1, last_triggered_at = ? WHERE id = ?", [new Date().toISOString(), input.ruleId]);
  }
  return id;
}

export function listAlerts(orgId: string, limit = 50): { id: string; title: string; body: string | null; severity: string; leadId: string | null; createdAt: string; delivery: Record<string, unknown> }[] {
  return all<{ id: string; title: string; body: string | null; severity: string; lead_id: string | null; created_at: string; delivery_json: string }>(
    "SELECT id, title, body, severity, lead_id, created_at, delivery_json FROM alerts WHERE org_id = ? ORDER BY created_at DESC LIMIT ?",
    [orgId, limit],
  ).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    leadId: row.lead_id,
    createdAt: row.created_at,
    delivery: parseJson<Record<string, unknown>>(row.delivery_json, {}),
  }));
}

export function seedDefaultAlertRules(orgId: string): void {
  const existing = one<{ c: number }>("SELECT COUNT(*) AS c FROM alert_rules WHERE org_id = ?", [orgId]);
  if ((existing?.c ?? 0) > 0) return;
  const rules = [
    {
      name: "High-intent lead",
      description: "Fires when a prospect shows strong buying intent in conversation or requests a call.",
      conditions: [
        { field: "leadScore", operator: "gte", value: 80 },
        { field: "intent", operator: "in", value: ["high_intent", "wants_call", "wants_pricing", "wants_demo", "ready_to_start"] },
      ],
      actions: ["whatsapp", "email", "create_task", "mark_hot", "notify_assignee"],
      cooldownMinutes: 30,
    },
    {
      name: "Premium proposal viewed",
      description: "Fires when a proposal worth more than £5,000 is opened by the prospect.",
      conditions: [{ field: "proposalViewed", operator: "eq", value: true }],
      actions: ["notify_owner", "create_task"],
      cooldownMinutes: 120,
    },
    {
      name: "No website, strong reviews",
      description: "Fires when a business with no website and 30+ reviews enters the pipeline.",
      conditions: [
        { field: "websiteStatus", operator: "eq", value: "none" },
        { field: "reviewCount", operator: "gte", value: 30 },
      ],
      actions: ["mark_hot", "create_task"],
      cooldownMinutes: 1440,
    },
    {
      name: "Proposal accepted",
      description: "Fires when a prospect accepts a proposal so the handover to delivery starts immediately.",
      conditions: [{ field: "proposalAccepted", operator: "eq", value: true }],
      actions: ["whatsapp", "email", "create_task", "notify_owner"],
      cooldownMinutes: 5,
    },
  ];
  rules.forEach((rule) => createAlertRule(orgId, rule));
}

/* ══════════════════════════════════════════════════════════════════════════
   Jobs (§45, §46)
   ══════════════════════════════════════════════════════════════════════════ */

interface JobRow {
  id: string; org_id: string | null; queue: string; type: string; label: string | null; status: string;
  priority: number; progress: number; stage: string | null; payload_json: string; result_json: string;
  attempts: number; max_attempts: number; error: string | null; created_by: string | null;
  scheduled_at: string; started_at: string | null; completed_at: string | null; duration_ms: number | null; created_at: string;
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    orgId: row.org_id,
    queue: row.queue,
    type: row.type as JobType,
    label: row.label,
    status: row.status as JobStatus,
    priority: row.priority,
    progress: row.progress,
    stage: row.stage,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    result: parseJson<Record<string, unknown>>(row.result_json, {}),
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    error: row.error,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

export function enqueueJob(orgId: string | null, input: {
  type: JobType;
  label?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
  scheduledAt?: string;
  queue?: string;
  createdBy?: string | null;
}): Job {
  // Collapse duplicate queued work for the same target.
  const dedupeKey = JSON.stringify(input.payload ?? {});
  const existing = one<JobRow>(
    `SELECT * FROM jobs WHERE type = ? AND status IN ('queued','running') AND payload_json = ? AND COALESCE(org_id,'') = COALESCE(?,'') LIMIT 1`,
    [input.type, dedupeKey, orgId],
  );
  if (existing) return mapJob(existing);

  const id = newId("job");
  const timestamp = new Date().toISOString();
  insert("jobs", {
    id,
    org_id: orgId,
    queue: input.queue ?? "default",
    type: input.type,
    label: input.label ?? null,
    status: "queued",
    priority: input.priority ?? 5,
    progress: 0,
    payload_json: input.payload ?? {},
    result_json: {},
    attempts: 0,
    max_attempts: input.maxAttempts ?? 3,
    created_by: input.createdBy ?? null,
    scheduled_at: input.scheduledAt ?? timestamp,
    created_at: timestamp,
  });
  return mapJob(one<JobRow>("SELECT * FROM jobs WHERE id = ?", [id])!);
}

export function getJob(orgId: string | null, jobId: string): Job | null {
  const row = one<JobRow>("SELECT * FROM jobs WHERE id = ?", [jobId]);
  if (!row) return null;
  if (orgId && row.org_id && row.org_id !== orgId) return null;
  return mapJob(row);
}

export function claimNextJob(types?: JobType[]): Job | null {
  const typeFilter = types?.length ? `AND type IN (${types.map(() => "?").join(",")})` : "";
  const params: unknown[] = types?.length ? [...types] : [];
  const row = one<JobRow>(
    `SELECT * FROM jobs WHERE status = 'queued' AND scheduled_at <= datetime('now') ${typeFilter}
     ORDER BY priority ASC, scheduled_at ASC LIMIT 1`,
    params,
  );
  if (!row) return null;

  const timestamp = new Date().toISOString();
  const claimed = run(
    "UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1, progress = 1 WHERE id = ? AND status = 'queued'",
    [timestamp, row.id],
  );
  if (claimed.changes === 0) return null;
  return getJob(null, row.id);
}

export function updateJobProgress(jobId: string, progress: number, stage: string, log?: string): void {
  update("jobs", jobId, { progress: Math.max(0, Math.min(100, Math.round(progress))), stage });
  if (log) addJobLog(jobId, "info", log);
}

export function completeJob(jobId: string, result: Record<string, unknown> = {}): void {
  const job = getJob(null, jobId);
  const timestamp = new Date().toISOString();
  const durationMs = job?.startedAt ? Date.now() - new Date(job.startedAt).getTime() : null;
  update("jobs", jobId, { status: "succeeded", progress: 100, stage: "Complete", result_json: result, completed_at: timestamp, duration_ms: durationMs, error: null });
  addJobLog(jobId, "info", "Job completed");
}

export function failJob(jobId: string, error: string): { retrying: boolean; attempts: number } {
  const job = getJob(null, jobId);
  if (!job) return { retrying: false, attempts: 0 };
  const timestamp = new Date().toISOString();
  const willRetry = job.attempts < job.maxAttempts;
  update("jobs", jobId, {
    status: willRetry ? "retrying" : "failed",
    error,
    completed_at: willRetry ? null : timestamp,
    scheduled_at: willRetry ? new Date(Date.now() + Math.min(10, job.attempts) * 30_000).toISOString() : job.scheduledAt,
    stage: willRetry ? `Retrying (attempt ${job.attempts + 1} of ${job.maxAttempts})` : "Failed",
  });
  if (willRetry) {
    run("UPDATE jobs SET status = 'queued' WHERE id = ?", [jobId]);
  }
  addJobLog(jobId, "error", error);
  return { retrying: willRetry, attempts: job.attempts };
}

export function cancelJob(jobId: string): void {
  update("jobs", jobId, { status: "cancelled", completed_at: new Date().toISOString(), stage: "Cancelled" });
}

export function addJobLog(jobId: string, level: string, message: string, meta: Record<string, unknown> = {}): void {
  insert("job_logs", {
    id: newId("jlg"),
    job_id: jobId,
    level,
    message,
    meta_json: meta,
    created_at: new Date().toISOString(),
  });
}

export function listJobs(orgId: string, filter: { status?: JobStatus[]; type?: JobType[]; limit?: number; offset?: number } = {}): { items: Job[]; total: number } {
  const clauses = ["org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.status?.length) {
    clauses.push(`status IN (${filter.status.map(() => "?").join(",")})`);
    params.push(...filter.status);
  }
  if (filter.type?.length) {
    clauses.push(`type IN (${filter.type.map(() => "?").join(",")})`);
    params.push(...filter.type);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<JobRow>(
    `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 50, 200), filter.offset ?? 0],
  ).map(mapJob);
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM jobs ${where}`, params)?.total ?? 0;
  return { items, total };
}

export function listJobLogs(jobId: string, limit = 100): { id: string; level: string; message: string; meta: Record<string, unknown>; createdAt: string }[] {
  return all<{ id: string; level: string; message: string; meta_json: string; created_at: string }>(
    "SELECT * FROM job_logs WHERE job_id = ? ORDER BY created_at ASC LIMIT ?",
    [jobId, limit],
  ).map((row) => ({ id: row.id, level: row.level, message: row.message, meta: parseJson<Record<string, unknown>>(row.meta_json, {}), createdAt: row.created_at }));
}

export function jobStats(orgId: string): { queued: number; running: number; failed: number; succeeded: number; oldestQueuedAt: string | null } {
  const row = one<{ queued: number; running: number; failed: number; succeeded: number }>(
    `SELECT SUM(CASE WHEN status IN ('queued','retrying') THEN 1 ELSE 0 END) AS queued,
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded
     FROM jobs WHERE org_id = ?`,
    [orgId],
  );
  const oldest = one<{ scheduled_at: string }>(
    "SELECT scheduled_at FROM jobs WHERE org_id = ? AND status IN ('queued','retrying') ORDER BY scheduled_at ASC LIMIT 1",
    [orgId],
  );
  return { queued: row?.queued ?? 0, running: row?.running ?? 0, failed: row?.failed ?? 0, succeeded: row?.succeeded ?? 0, oldestQueuedAt: oldest?.scheduled_at ?? null };
}

/* ══════════════════════════════════════════════════════════════════════════
   Discovery runs
   ══════════════════════════════════════════════════════════════════════════ */

export function createDiscoveryRun(orgId: string, input: {
  query: Record<string, unknown>;
  jobId?: string | null;
  providers?: string[];
  createdBy?: string | null;
}): DiscoveryRun {
  const id = newId("dsc");
  insert("discovery_runs", {
    id,
    org_id: orgId,
    job_id: input.jobId ?? null,
    query_json: input.query,
    status: "queued",
    providers_json: input.providers ?? [],
    created_by: input.createdBy ?? null,
    created_at: new Date().toISOString(),
  });
  return getDiscoveryRun(orgId, id)!;
}

export function getDiscoveryRun(orgId: string, runId: string): DiscoveryRun | null {
  const row = one<{
    id: string; org_id: string; job_id: string | null; query_json: string; status: string;
    providers_json: string; found_count: number; new_count: number; duplicate_count: number;
    audited_count: number; error: string | null; created_at: string; completed_at: string | null;
  }>("SELECT * FROM discovery_runs WHERE id = ? AND org_id = ?", [runId, orgId]);
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.org_id,
    jobId: row.job_id,
    query: parseJson<Record<string, unknown>>(row.query_json, {}),
    status: row.status,
    providers: parseJson<string[]>(row.providers_json, []),
    foundCount: row.found_count,
    newCount: row.new_count,
    duplicateCount: row.duplicate_count,
    auditedCount: row.audited_count,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export function updateDiscoveryRun(runId: string, patch: Partial<DiscoveryRun>): void {
  const columnMap: Record<string, string> = {
    status: "status", foundCount: "found_count", newCount: "new_count",
    duplicateCount: "duplicate_count", auditedCount: "audited_count", error: "error",
    providers: "providers_json", completedAt: "completed_at",
  };
  const values: Record<string, unknown> = {};
  Object.entries(patch).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) values[column] = value;
  });
  if (!Object.keys(values).length) return;
  update("discovery_runs", runId, values);
}

export function listDiscoveryRuns(orgId: string, limit = 20): DiscoveryRun[] {
  const rows = all<{
    id: string; org_id: string; job_id: string | null; query_json: string; status: string;
    providers_json: string; found_count: number; new_count: number; duplicate_count: number;
    audited_count: number; error: string | null; created_at: string; completed_at: string | null;
  }>("SELECT * FROM discovery_runs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?", [orgId, limit]);
  return rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    jobId: row.job_id,
    query: parseJson<Record<string, unknown>>(row.query_json, {}),
    status: row.status,
    providers: parseJson<string[]>(row.providers_json, []),
    foundCount: row.found_count,
    newCount: row.new_count,
    duplicateCount: row.duplicate_count,
    auditedCount: row.audited_count,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   Integrations (§42)
   ══════════════════════════════════════════════════════════════════════════ */

export interface IntegrationDefinition {
  key: string;
  name: string;
  category: string;
  description: string;
  requiredEnv: string[];
  docsUrl: string;
  configurable: boolean;
  optionalEnv?: string[];
}

export function listIntegrations(orgId: string): Integration[] {
  return all<{
    id: string; org_id: string; key: string; name: string; category: string; description: string | null;
    status: string; required_env_json: string; config_json: string; secret_enc: string | null;
    docs_url: string | null; connected_at: string | null; last_checked_at: string | null;
    last_error: string | null; updated_at: string;
  }>("SELECT * FROM integrations WHERE org_id = ? ORDER BY category ASC, name ASC", [orgId]).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    key: row.key,
    name: row.name,
    category: row.category,
    description: row.description,
    status: row.status as IntegrationStatus,
    requiredEnv: parseJson<string[]>(row.required_env_json, []),
    config: parseJson<Record<string, unknown>>(row.config_json, {}),
    hasSecret: Boolean(row.secret_enc),
    docsUrl: row.docs_url,
    connectedAt: row.connected_at,
    lastCheckedAt: row.last_checked_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  }));
}

export function getIntegration(orgId: string, key: string): Integration | null {
  return listIntegrations(orgId).find((i) => i.key === key) ?? null;
}

export function upsertIntegration(orgId: string, input: {
  key: string;
  name: string;
  category: string;
  description?: string;
  requiredEnv?: string[];
  status?: IntegrationStatus;
  config?: Record<string, unknown>;
  secretEnc?: string | null;
  docsUrl?: string;
  lastError?: string | null;
}): Integration {
  const existing = one<{ id: string }>("SELECT id FROM integrations WHERE org_id = ? AND key = ?", [orgId, input.key]);
  const timestamp = new Date().toISOString();
  if (existing) {
    const values: Record<string, unknown> = { updated_at: timestamp, last_checked_at: timestamp };
    if (input.status) {
      values.status = input.status;
      values.connected_at = input.status === "connected" ? timestamp : null;
    }
    if (input.config) values.config_json = input.config;
    if (input.secretEnc !== undefined) values.secret_enc = input.secretEnc;
    if (input.lastError !== undefined) values.last_error = input.lastError;
    update("integrations", existing.id, values);
  } else {
    insert("integrations", {
      id: newId("itg"),
      org_id: orgId,
      key: input.key,
      name: input.name,
      category: input.category,
      description: input.description ?? null,
      status: input.status ?? "not_connected",
      required_env_json: input.requiredEnv ?? [],
      config_json: input.config ?? {},
      secret_enc: input.secretEnc ?? null,
      docs_url: input.docsUrl ?? null,
      connected_at: input.status === "connected" ? timestamp : null,
      last_checked_at: timestamp,
      last_error: input.lastError ?? null,
      updated_at: timestamp,
    });
  }
  return listIntegrations(orgId).find((i) => i.key === input.key)!;
}

export function seedIntegrations(orgId: string, definitions: IntegrationDefinition[]): void {
  const existing = new Set(all<{ key: string }>("SELECT key FROM integrations WHERE org_id = ?", [orgId]).map((r) => r.key));
  definitions.forEach((definition) => {
    if (existing.has(definition.key)) return;
    const envPresent = definition.requiredEnv.every((name) => Boolean(process.env[name]));
    upsertIntegration(orgId, {
      key: definition.key,
      name: definition.name,
      category: definition.category,
      description: definition.description,
      requiredEnv: definition.requiredEnv,
      docsUrl: definition.docsUrl,
      status: envPresent ? "connected" : "not_connected",
    });
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   Webhooks (§41)
   ══════════════════════════════════════════════════════════════════════════ */

export function recordWebhook(orgId: string | null, input: {
  direction?: string;
  provider: string;
  event?: string | null;
  url?: string | null;
  status?: string;
  signatureOk?: boolean | null;
  payload?: Record<string, unknown>;
  responseCode?: number | null;
  error?: string | null;
}): string {
  const id = newId("whk");
  insert("webhooks", {
    id,
    org_id: orgId,
    direction: input.direction ?? "inbound",
    provider: input.provider,
    event: input.event ?? null,
    url: input.url ?? null,
    status: input.status ?? "received",
    signature_ok: input.signatureOk === null || input.signatureOk === undefined ? null : input.signatureOk ? 1 : 0,
    payload_json: input.payload ?? {},
    response_code: input.responseCode ?? null,
    attempts: 1,
    error: input.error ?? null,
    received_at: new Date().toISOString(),
  });
  return id;
}

export function listWebhooks(orgId: string, limit = 100): {
  id: string; provider: string; event: string | null; status: string; signatureOk: boolean | null;
  responseCode: number | null; error: string | null; receivedAt: string; payload: Record<string, unknown>;
}[] {
  return all<{
    id: string; provider: string; event: string | null; status: string; signature_ok: number | null;
    response_code: number | null; error: string | null; received_at: string; payload_json: string;
  }>("SELECT * FROM webhooks WHERE org_id = ? ORDER BY received_at DESC LIMIT ?", [orgId, limit]).map((row) => ({
    id: row.id,
    provider: row.provider,
    event: row.event,
    status: row.status,
    signatureOk: row.signature_ok === null ? null : toBool(row.signature_ok),
    responseCode: row.response_code,
    error: row.error,
    receivedAt: row.received_at,
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   Audit logs (§41, §51)
   ══════════════════════════════════════════════════════════════════════════ */

export function writeAuditLog(orgId: string | null, input: {
  actorUserId?: string | null;
  actorType?: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  ipHash?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}): void {
  insert("audit_logs", {
    id: newId("aud"),
    org_id: orgId,
    actor_user_id: input.actorUserId ?? null,
    actor_type: input.actorType ?? "user",
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    ip_hash: input.ipHash ?? null,
    user_agent: input.userAgent ?? null,
    meta_json: input.meta ?? {},
    created_at: new Date().toISOString(),
  });
}

export function listAuditLogs(orgId: string, filter: { limit?: number; offset?: number; action?: string; entityType?: string } = {}): {
  items: { id: string; action: string; entityType: string | null; entityId: string | null; actorType: string; actorName: string | null; meta: Record<string, unknown>; createdAt: string }[];
  total: number;
} {
  const clauses = ["a.org_id = ?"];
  const params: unknown[] = [orgId];
  if (filter.action) { clauses.push("a.action LIKE ?"); params.push(`%${filter.action}%`); }
  if (filter.entityType) { clauses.push("a.entity_type = ?"); params.push(filter.entityType); }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const items = all<{
    id: string; action: string; entity_type: string | null; entity_id: string | null; actor_type: string;
    actor_name: string | null; meta_json: string; created_at: string;
  }>(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.actor_type, u.name AS actor_name, a.meta_json, a.created_at
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${where}
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Math.min(filter.limit ?? 60, 300), filter.offset ?? 0],
  ).map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actorType: row.actor_type,
    actorName: row.actor_name,
    meta: parseJson<Record<string, unknown>>(row.meta_json, {}),
    createdAt: row.created_at,
  }));
  const total = one<{ total: number }>(`SELECT COUNT(*) AS total FROM audit_logs a ${where}`, params)?.total ?? 0;
  return { items, total };
}

export function listAppLogs(orgId: string, filter: { scope?: string; level?: string; limit?: number } = {}): {
  id: string; level: string; scope: string; message: string; meta: Record<string, unknown>; createdAt: string;
}[] {
  const clauses = ["(org_id = ? OR org_id IS NULL)"];
  const params: unknown[] = [orgId];
  if (filter.scope) { clauses.push("scope = ?"); params.push(filter.scope); }
  if (filter.level) { clauses.push("level = ?"); params.push(filter.level); }
  return all<{ id: string; level: string; scope: string; message: string; meta_json: string; created_at: string }>(
    `SELECT * FROM app_logs WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
    [...params, Math.min(filter.limit ?? 100, 500)],
  ).map((row) => ({ id: row.id, level: row.level, scope: row.scope, message: row.message, meta: parseJson<Record<string, unknown>>(row.meta_json, {}), createdAt: row.created_at }));
}

export function listAiInteractions(orgId: string, limit = 60): {
  id: string; feature: string; provider: string; model: string | null; latencyMs: number;
  promptTokens: number; outputTokens: number; costEstimate: number; status: string; error: string | null; createdAt: string;
}[] {
  return all<{
    id: string; feature: string; provider: string; model: string | null; latency_ms: number;
    prompt_tokens: number; output_tokens: number; cost_estimate: number; status: string;
    error: string | null; created_at: string;
  }>(
    "SELECT id, feature, provider, model, latency_ms, prompt_tokens, output_tokens, cost_estimate, status, error, created_at FROM ai_interactions WHERE org_id = ? ORDER BY created_at DESC LIMIT ?",
    [orgId, limit],
  ).map((row) => ({
    id: row.id,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    latencyMs: row.latency_ms,
    promptTokens: row.prompt_tokens,
    outputTokens: row.output_tokens,
    costEstimate: row.cost_estimate,
    status: row.status,
    error: row.error,
    createdAt: row.created_at,
  }));
}

export function aiUsageSummary(orgId: string): { total: number; byFeature: { feature: string; count: number; avgLatency: number }[]; costEstimate: number; errorRate: number } {
  const total = one<{ c: number }>("SELECT COUNT(*) AS c FROM ai_interactions WHERE org_id = ?", [orgId])?.c ?? 0;
  const byFeature = all<{ feature: string; count: number; avg_latency: number }>(
    "SELECT feature, COUNT(*) AS count, AVG(latency_ms) AS avg_latency FROM ai_interactions WHERE org_id = ? GROUP BY feature ORDER BY count DESC",
    [orgId],
  ).map((row) => ({ feature: row.feature, count: row.count, avgLatency: Math.round(row.avg_latency ?? 0) }));
  const cost = one<{ total: number }>("SELECT COALESCE(SUM(cost_estimate),0) AS total FROM ai_interactions WHERE org_id = ?", [orgId])?.total ?? 0;
  const errors = one<{ c: number }>("SELECT COUNT(*) AS c FROM ai_interactions WHERE org_id = ? AND status != 'ok'", [orgId])?.c ?? 0;
  return { total, byFeature, costEstimate: cost, errorRate: total ? Math.round((errors / total) * 100) : 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
   Saved views & settings
   ══════════════════════════════════════════════════════════════════════════ */

export function listSavedViews(orgId: string, scope: string, userId?: string): { id: string; name: string; filters: Record<string, unknown>; isShared: boolean }[] {
  const params: unknown[] = [orgId, scope];
  let extra = "";
  if (userId) {
    extra = " AND (user_id IS NULL OR user_id = ?)";
    params.push(userId);
  }
  return all<{ id: string; name: string; filters_json: string; is_shared: number }>(
    `SELECT * FROM saved_views WHERE org_id = ? AND scope = ?${extra} ORDER BY created_at DESC LIMIT 50`,
    params,
  ).map((row) => ({ id: row.id, name: row.name, filters: parseJson<Record<string, unknown>>(row.filters_json, {}), isShared: toBool(row.is_shared) }));
}

export function saveView(orgId: string, input: { scope: string; name: string; filters: Record<string, unknown>; userId?: string | null; isShared?: boolean }): string {
  const id = newId("svw");
  insert("saved_views", {
    id,
    org_id: orgId,
    user_id: input.userId ?? null,
    scope: input.scope,
    name: input.name,
    filters_json: input.filters,
    is_shared: input.isShared ? 1 : 0,
    created_at: new Date().toISOString(),
  });
  return id;
}

export function deleteSavedView(orgId: string, viewId: string): void {
  run("DELETE FROM saved_views WHERE id = ? AND org_id = ?", [viewId, orgId]);
}

export function setSetting(orgId: string, scope: string, key: string, value: unknown): void {
  const existing = one<{ id: string }>("SELECT id FROM settings WHERE org_id = ? AND scope = ? AND key = ?", [orgId, scope, key]);
  const timestamp = new Date().toISOString();
  if (existing) {
    update("settings", existing.id, { value_json: value, updated_at: timestamp });
    return;
  }
  insert("settings", {
    id: newId("set"),
    org_id: orgId,
    scope,
    key,
    value_json: value,
    updated_at: timestamp,
  });
}

export function getSetting<T>(orgId: string, scope: string, key: string, fallback: T): T {
  const row = one<{ value_json: string }>("SELECT value_json FROM settings WHERE org_id = ? AND scope = ? AND key = ?", [orgId, scope, key]);
  return row ? parseJson<T>(row.value_json, fallback) : fallback;
}

/* ══════════════════════════════════════════════════════════════════════════
   Global search (§28)
   ══════════════════════════════════════════════════════════════════════════ */

export function globalSearch(orgId: string, query: string, limitPerType = 5): import("./types").SearchResult[] {
  const term = query.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const results: import("./types").SearchResult[] = [];

  all<{ id: string; name: string; city: string | null; industry: string | null; lead_id: string | null; lead_score: number | null; status: string | null }>(
    `SELECT b.id, b.name, b.city, b.industry, l.id AS lead_id, l.lead_score, l.status
     FROM businesses b LEFT JOIN leads l ON l.business_id = b.id
     WHERE b.org_id = ? AND (b.name LIKE ? OR b.city LIKE ? OR b.industry LIKE ?)
     ORDER BY COALESCE(b.review_count,0) DESC LIMIT ?`,
    [orgId, like, like, like, limitPerType],
  ).forEach((row) => {
    results.push({
      type: "lead",
      id: row.lead_id ?? row.id,
      title: row.name,
      subtitle: [row.industry, row.city].filter(Boolean).join(" · "),
      url: row.lead_id ? `/leads/${row.lead_id}` : `/businesses/${row.id}`,
      score: row.lead_score,
      status: row.status,
    });
  });

  all<{ id: string; name: string; city: string | null; industry: string | null; website_status: string }>(
    `SELECT id, name, city, industry, website_status FROM businesses
     WHERE org_id = ? AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.business_id = businesses.id)
       AND (name LIKE ? OR city LIKE ?) LIMIT ?`,
    [orgId, like, like, limitPerType],
  ).forEach((row) => {
    results.push({
      type: "business",
      id: row.id,
      title: row.name,
      subtitle: [row.industry, row.city].filter(Boolean).join(" · "),
      url: `/businesses/${row.id}`,
      status: row.website_status,
    });
  });

  all<{ id: string; name: string; email: string | null; phone: string | null }>(
    `SELECT id, name, email, phone FROM contacts WHERE org_id = ? AND (name LIKE ? OR email LIKE ? OR phone LIKE ?) LIMIT ?`,
    [orgId, like, like, like, limitPerType],
  ).forEach((row) => {
    results.push({ type: "contact", id: row.id, title: row.name, subtitle: row.email ?? row.phone, url: `/leads?q=${encodeURIComponent(row.name)}` });
  });

  all<{ id: string; title: string; number: string; status: string; total: number; business_name: string }>(
    `SELECT p.id, p.title, p.number, p.status, p.total, b.name AS business_name
     FROM proposals p JOIN businesses b ON b.id = p.business_id
     WHERE p.org_id = ? AND (p.title LIKE ? OR p.number LIKE ? OR b.name LIKE ?) LIMIT ?`,
    [orgId, like, like, like, limitPerType],
  ).forEach((row) => {
    results.push({ type: "proposal", id: row.id, title: `${row.number} · ${row.title}`, subtitle: row.business_name, url: `/proposals/${row.id}`, status: row.status });
  });

  all<{ id: string; business_name: string; summary: string | null; intent_score: number; status: string }>(
    `SELECT c.id, b.name AS business_name, c.summary, c.intent_score, c.status
     FROM conversations c JOIN businesses b ON b.id = c.business_id
     WHERE c.org_id = ? AND (b.name LIKE ? OR c.summary LIKE ?) LIMIT ?`,
    [orgId, like, like, limitPerType],
  ).forEach((row) => {
    results.push({ type: "conversation", id: row.id, title: row.business_name, subtitle: row.summary?.slice(0, 90) ?? null, url: `/conversations/${row.id}`, score: row.intent_score, status: row.status });
  });

  all<{ id: string; name: string; status: string; target_count: number }>(
    `SELECT id, name, status, target_count FROM campaigns WHERE org_id = ? AND name LIKE ? LIMIT ?`,
    [orgId, like, limitPerType],
  ).forEach((row) => {
    results.push({ type: "campaign", id: row.id, title: row.name, subtitle: `${row.target_count} recipients`, url: `/campaigns/${row.id}`, status: row.status });
  });

  all<{ id: string; name: string; code: string; status: string; business_name: string }>(
    `SELECT p.id, p.name, p.code, p.status, b.name AS business_name FROM projects p JOIN businesses b ON b.id = p.business_id
     WHERE p.org_id = ? AND (p.name LIKE ? OR p.code LIKE ?) LIMIT ?`,
    [orgId, like, like, limitPerType],
  ).forEach((row) => {
    results.push({ type: "project", id: row.id, title: `${row.code} · ${row.name}`, subtitle: row.business_name, url: `/projects/${row.id}`, status: row.status });
  });

  all<{ id: string; title: string; status: string; due_at: string | null }>(
    `SELECT id, title, status, due_at FROM tasks WHERE org_id = ? AND title LIKE ? LIMIT ?`,
    [orgId, like, limitPerType],
  ).forEach((row) => {
    results.push({ type: "task", id: row.id, title: row.title, subtitle: row.due_at ? `Due ${row.due_at.slice(0, 10)}` : null, url: `/tasks?focus=${row.id}`, status: row.status });
  });

  return results;
}

export type { ProjectStatus, EmailStyle };
