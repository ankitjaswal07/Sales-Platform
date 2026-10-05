import type {
  AuditFinding,
  AuditMetric,
  CampaignStatus,
  ConversationStatus,
  IntentLevel,
  JobStatus,
  JobType,
  LeadStatus,
  NotificationType,
  PaletteToken,
  ProposalLineItem,
  ProposalSection,
  ProposalStatus,
  ProjectStatus,
  Severity,
  TaskPriority,
  TaskStatus,
  Temperature,
  UserRole,
  WebsiteStatus,
  EmailStyle,
  IntegrationStatus,
} from "../../types";
import type { ConceptPreset } from "../../ai/types";
import type { BusinessAnalysis, ConceptPreview, GeneratedConcept } from "../../ai/types";
import type { PriceEstimate } from "../../types";

/** Database-facing view models. Column names never leak past this module. */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  logoUrl: string | null;
  brandPrimary: string;
  brandAccent: string;
  brandFont: string;
  address: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  currency: string;
  plan: string;
  settings: OrgSettings;
  onboarding: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface OrgSettings {
  branding: {
    primary: string;
    accent: string;
    font: string;
    proposalTemplate: "signature" | "editorial" | "technical" | "compact";
    showAgencyLogo: boolean;
  };
  sales: {
    defaultCurrency: string;
    defaultValidityDays: number;
    followUpCadence: number[];
    requireProposalApproval: boolean;
    autoSendUnder: number;
  };
  notifications: {
    email: boolean;
    whatsapp: boolean;
    browser: boolean;
    highIntent: boolean;
    proposalOpened: boolean;
    dailyDigest: boolean;
    quietHours: { from: string; to: string };
  };
  ai: {
    tone: string;
    aggressiveness: "conservative" | "measured" | "direct";
    qualificationRules: "light" | "standard" | "thorough";
    discloseAi: boolean;
    model: string;
  };
  leadScoring: {
    weights: {
      businessQuality: number;
      websiteOpportunity: number;
      buyingPotential: number;
      contactability: number;
      buyingIntent: number;
    };
    hotThreshold: number;
    warmThreshold: number;
  };
  pipeline: { customStages: string[]; slaHours: number };
  security: { enforceMfa: boolean; sessionHours: number; ipAllowlist: string[]; requireApprovalForDeletion: boolean };
  data: { retentionDays: number; autoDeleteLostAfterDays: number; allowExports: boolean };
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: UserRole;
  title: string | null;
  phone: string | null;
  avatarUrl: string | null;
  status: string;
  mfaEnabled: boolean;
  timezone: string | null;
  quotaMonthly: number | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Business {
  id: string;
  orgId: string;
  name: string;
  legalName: string | null;
  industry: string | null;
  category: string | null;
  description: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  socials: Record<string, string>;
  hours: { day: string; open: string; close: string }[];
  rating: number | null;
  reviewCount: number;
  priceLevel: number | null;
  employeeRange: string | null;
  revenueRange: string | null;
  yearsInBusiness: number | null;
  listingProvider: string | null;
  listingId: string | null;
  listingUrl: string | null;
  listingCategories: string[];
  attributes: Record<string, unknown>;
  screenshotUrl: string | null;
  websiteStatus: WebsiteStatus;
  dataSource: string | null;
  dataConfidence: number | null;
  isDemo: boolean;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Joined aggregates, present when the caller asked for them. */
  websiteScore?: number | null;
  opportunityScore?: number | null;
  openFindings?: number | null;
}

export interface Contact {
  id: string;
  orgId: string;
  businessId: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  phoneE164: string | null;
  linkedinUrl: string | null;
  isPrimary: boolean;
  source: string | null;
  emailStatus: string;
  phoneStatus: string;
  timezone: string | null;
  tags: string[];
  notes: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Website {
  id: string;
  orgId: string;
  businessId: string;
  url: string;
  normalizedUrl: string;
  host: string;
  status: string;
  https: boolean;
  httpStatus: number | null;
  redirectChain: { from: string; to: string; status: number }[];
  cms: string | null;
  tech: string[];
  pageCount: number;
  hasViewport: boolean | null;
  hasSitemap: boolean | null;
  hasRobots: boolean | null;
  copyrightYear: number | null;
  estAgeYears: number | null;
  screenshotUrl: string | null;
  lastCrawledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Audit {
  id: string;
  orgId: string;
  websiteId: string | null;
  businessId: string;
  jobId: string | null;
  status: "queued" | "running" | "complete" | "failed" | "blocked";
  engineVersion: string;
  mode: "live" | "modelled";
  overallScore: number | null;
  performance: number | null;
  mobile: number | null;
  seo: number | null;
  ux: number | null;
  accessibility: number | null;
  conversion: number | null;
  technical: number | null;
  content: number | null;
  trust: number | null;
  metrics: AuditMetric[];
  findings: AuditFinding[];
  opportunities: AuditFinding[];
  pages: { url: string; status: number; title: string | null; byteLength: number; ttfbMs: number }[];
  tech: string[];
  coreWebVitals: Record<string, unknown>;
  notes: string | null;
  error: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  url?: string | null;
}

export interface Lead {
  id: string;
  orgId: string;
  businessId: string;
  contactId: string | null;
  campaignId: string | null;
  discoveryRunId: string | null;
  reference: string;
  source: string;
  status: LeadStatus;
  stageKey: string;
  stagePosition: number;
  temperature: Temperature;
  priority: number;
  ownerId: string | null;
  tags: string[];
  websiteScore: number | null;
  opportunityScore: number | null;
  leadScore: number | null;
  businessQuality: number | null;
  buyingPotential: number | null;
  contactability: number | null;
  intent: IntentLevel;
  intentScore: number;
  estimatedValue: number | null;
  currency: string;
  confidence: number | null;
  nextAction: string | null;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  lastContactedAt: string | null;
  wonAt: string | null;
  lostAt: string | null;
  lostReason: string | null;
  disqualified: boolean;
  optOut: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  /** Joined */
  business?: Business | null;
  contact?: Contact | null;
  owner?: { id: string; name: string; avatarUrl: string | null } | null;
  scoreFactors?: import("../../scoring/lead").LeadScoreResult | null;
}

export interface Activity {
  id: string;
  orgId: string;
  leadId: string | null;
  businessId: string | null;
  contactId: string | null;
  userId: string | null;
  type: string;
  channel: string | null;
  subject: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  isSystem: boolean;
  occurredAt: string;
  createdAt: string;
  actorName?: string | null;
}

export interface Conversation {
  id: string;
  orgId: string;
  leadId: string | null;
  businessId: string;
  contactId: string | null;
  channel: string;
  status: ConversationStatus;
  aiEnabled: boolean;
  assignedUserId: string | null;
  intent: IntentLevel;
  intentScore: number;
  sentiment: string;
  summary: string | null;
  publicToken: string | null;
  unreadForOrg: number;
  messageCount: number;
  escalatedAt: string | null;
  lastMessageAt: string | null;
  lastAiAt: string | null;
  createdAt: string;
  updatedAt: string;
  businessName?: string;
  contactName?: string | null;
  assignedName?: string | null;
}

export interface Message {
  id: string;
  orgId: string;
  conversationId: string;
  role: "prospect" | "ai" | "agent" | "system";
  authorUserId: string | null;
  authorLabel: string | null;
  body: string;
  intent: IntentLevel | null;
  intentScore: number | null;
  signals: { phrase: string; meaning: string; weight: number }[];
  createdAt: string;
}

export interface Proposal {
  id: string;
  orgId: string;
  leadId: string | null;
  businessId: string;
  contactId: string | null;
  auditId: string | null;
  conceptId: string | null;
  number: string;
  title: string;
  status: ProposalStatus;
  template: string;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  monthlyRetainer: number;
  timelineWeeks: number | null;
  sections: ProposalSection[];
  lineItems: ProposalLineItem[];
  design: Record<string, unknown>;
  concept: Record<string, unknown>;
  pricingSource: string;
  aiGenerated: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  publicToken: string | null;
  version: number;
  validUntil: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  viewCount: number;
  timeSpentSeconds: number;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  businessName?: string;
  contactName?: string | null;
  leadStatus?: LeadStatus | null;
}

export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  industry: string | null;
  location: string | null;
  criteria: Record<string, unknown>;
  sequence: { step: number; dayOffset: number; name: string; style: EmailStyle; intent: string }[];
  status: CampaignStatus;
  dailyCap: number;
  requireApproval: boolean;
  ownerId: string | null;
  targetCount: number;
  startedAt: string | null;
  completedAt: string | null;
  pausedReason: string | null;
  createdAt: string;
  updatedAt: string;
  stats?: CampaignStats;
}

export interface CampaignStats {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  interested: number;
  unsubscribed: number;
  bounced: number;
  converted: number;
  openRate: number;
  replyRate: number;
  conversionRate: number;
}

export interface EmailRecord {
  id: string;
  orgId: string;
  campaignId: string | null;
  leadId: string | null;
  businessId: string | null;
  contactId: string | null;
  direction: string;
  style: EmailStyle | null;
  fromAddress: string | null;
  toAddress: string;
  subject: string;
  bodyText: string | null;
  bodyHtml: string | null;
  provider: string | null;
  status: string;
  error: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  businessName?: string;
}

export interface Notification {
  id: string;
  orgId: string;
  userId: string | null;
  type: NotificationType;
  severity: Severity;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  icon: string | null;
  channels: string[];
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  orgId: string;
  leadId: string | null;
  businessId: string | null;
  projectId: string | null;
  title: string;
  description: string | null;
  type: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  assignedUserId: string | null;
  createdBy: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  businessName?: string | null;
  assigneeName?: string | null;
}

export interface Service {
  id: string;
  orgId: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  startingPrice: number;
  price: number | null;
  currency: string;
  billing: string;
  timelineDaysMin: number;
  timelineDaysMax: number;
  features: string[];
  addons: { name: string; price: number }[];
  complexityWeight: number;
  isActive: boolean;
  sortOrder: number;
}

export interface PricingPlan {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  billing: string;
  pagesIncluded: number | null;
  features: string[];
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface Project {
  id: string;
  orgId: string;
  leadId: string | null;
  businessId: string;
  proposalId: string | null;
  code: string;
  name: string;
  status: ProjectStatus;
  health: string;
  startDate: string | null;
  deadline: string | null;
  completedAt: string | null;
  budget: number | null;
  currency: string;
  ownerId: string | null;
  team: { userId: string; role: string }[];
  scope: { name: string; detail: string }[];
  requirements: string[];
  design: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  businessName?: string;
  ownerName?: string | null;
  taskCounts?: { open: number; done: number };
}

export interface Job {
  id: string;
  orgId: string | null;
  queue: string;
  type: JobType;
  label: string | null;
  status: JobStatus;
  priority: number;
  progress: number;
  stage: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface Integration {
  id: string;
  orgId: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  status: IntegrationStatus;
  requiredEnv: string[];
  config: Record<string, unknown>;
  hasSecret: boolean;
  docsUrl: string | null;
  connectedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface AlertRule {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  conditions: { field: string; operator: string; value: unknown }[];
  actions: string[];
  cooldownMinutes: number;
  triggerCount: number;
  lastTriggeredAt: string | null;
  createdAt: string;
}

export interface ConceptRecord extends GeneratedConcept {
  id: string;
  businessId: string;
  leadId: string | null;
  isSelected: boolean;
  createdAt: string;
  preset: ConceptPreset;
  preview: ConceptPreview;
  palette: PaletteToken[];
}

export interface DiscoveryRun {
  id: string;
  orgId: string;
  jobId: string | null;
  query: Record<string, unknown>;
  status: string;
  providers: string[];
  foundCount: number;
  newCount: number;
  duplicateCount: number;
  auditedCount: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ProposalViewRecord {
  id: string;
  proposalId: string;
  sessionKey: string;
  durationSeconds: number;
  maxScroll: number;
  sectionsViewed: string[];
  ctaClicks: string[];
  openedAt: string;
  lastSeenAt: string;
}

export interface SavedView {
  id: string;
  orgId: string;
  userId: string | null;
  scope: string;
  name: string;
  filters: Record<string, unknown>;
  isShared: boolean;
  createdAt: string;
}

export interface AnalyticsSummary {
  leads: {
    total: number;
    byStatus: Record<string, number>;
    newThisWeek: number;
    newThisMonth: number;
    hot: number;
    warm: number;
    cold: number;
    uncontacted: number;
    followedUpDue: number;
  };
  websites: {
    withoutWebsite: number;
    poor: number;
    outdated: number;
    slow: number;
    poorMobile: number;
    poorSeo: number;
    highOpportunity: number;
    audited: number;
    averageScore: number | null;
  };
  sales: {
    proposalsSent: number;
    proposalsOpened: number;
    proposalOpenRate: number;
    proposalsAccepted: number;
    proposalAcceptanceRate: number;
    conversionRate: number;
    contactRate: number;
    responseRate: number;
    meetingRate: number;
    closeRate: number;
    averageLeadValue: number;
    pipelineValue: number;
    wonRevenue: number;
    lostRevenue: number;
    averageDealSize: number;
    averageSalesCycleDays: number;
  };
  activity: {
    newLeads: number;
    auditsCompleted: number;
    proposalsGenerated: number;
    conversationsStarted: number;
    interestedProspects: number;
    qualifiedLeads: number;
    alertsGenerated: number;
  };
  timeline: { date: string; leads: number; audits: number; proposals: number; conversations: number; won: number; revenue: number }[];
  funnel: { stage: string; label: string; count: number; value: number }[];
  topIndustries: { industry: string; leads: number; won: number; conversionRate: number }[];
  topLocations: { location: string; leads: number; won: number; conversionRate: number }[];
  topAgents: { userId: string; name: string; leads: number; won: number; revenue: number; responseRate: number }[];
  topCampaigns: { id: string; name: string; sent: number; replied: number; interested: number; converted: number; replyRate: number }[];
  bestOpportunities: OpportunityCard[];
}

export interface OpportunityCard {
  leadId: string;
  businessId: string;
  businessName: string;
  industry: string | null;
  city: string | null;
  websiteUrl: string | null;
  websiteScore: number | null;
  opportunityScore: number | null;
  leadScore: number | null;
  temperature: Temperature;
  rating: number | null;
  reviewCount: number;
  whyThisLead: string;
  recommendedAction: string;
  topFinding: string | null;
  estimatedValue: number | null;
  currency: string;
}

export interface TimelineEvent {
  id: string;
  type: string;
  label: string;
  detail?: string | null;
  at: string;
  tone?: string;
  actor?: string | null;
}

export interface SearchResult {
  type: "lead" | "business" | "contact" | "proposal" | "conversation" | "campaign" | "project" | "task";
  id: string;
  title: string;
  subtitle: string | null;
  url: string;
  score?: number | null;
  status?: string | null;
}

export type { BusinessAnalysis, PriceEstimate, GeneratedConcept };
