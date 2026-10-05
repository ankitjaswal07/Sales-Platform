import type {
  AuditFinding,
  ConceptSection,
  IntentLevel,
  PaletteToken,
  PriceEstimate,
  ProposalLineItem,
  ProposalSection,
  TypographyChoice,
} from "../types";

/**
 * Every AI call in the platform goes through this contract.
 *
 * The provider is abstracted (§67) so the model can be swapped without touching
 * a single feature. Each feature declares the *shape* it needs and a
 * deterministic local implementation that satisfies it — meaning the product is
 * fully functional with no API key, and an LLM only ever replaces the language,
 * never the facts.
 */

export type AIProviderName = "local" | "openai" | "anthropic" | "azure-openai" | "openrouter";

export interface AICompletionRequest {
  system: string;
  user: string;
  /** Ask for strict JSON when the feature needs structured output. */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Feature key for logging/observability. */
  feature: string;
  entity?: { type: string; id: string };
  orgId?: string | null;
  userId?: string | null;
}

export interface AICompletionResult {
  text: string;
  provider: AIProviderName;
  model: string;
  latencyMs: number;
  promptTokens: number;
  outputTokens: number;
  costEstimate: number;
  /** Populated when the response violated a guardrail (§52). */
  guardrailFlags: string[];
  degraded: boolean;
  error?: string;
}

/* ── Business analysis (§8) ──────────────────────────────────────────────── */

export interface BusinessAnalysis {
  opportunitySummary: string;
  whyTheyAreAClient: string;
  mainProblems: { title: string; detail: string; severity: "critical" | "high" | "medium" | "low"; evidenceRef?: string }[];
  businessStrengths: string[];
  websiteWeaknesses: string[];
  recommendedImprovements: { title: string; detail: string; impact: string }[];
  suggestedStructure: string[];
  suggestedCta: { primary: string; secondary: string; placement: string[] };
  suggestedDesignStyle: string;
  suggestedFeatures: { name: string; reason: string; priority: "must" | "should" | "could" }[];
  estimatedComplexity: { level: "simple" | "standard" | "premium" | "bespoke"; rationale: string; timelineWeeks: [number, number] };
  talkingPoints: string[];
  objections: { objection: string; response: string }[];
  confidence: number;
  /** Distinguishes measured facts from AI opinion (§52). */
  verifiedFacts: string[];
  aiInterpretation: string[];
  generatedBy: "local_engine" | AIProviderName;
}

/* ── Design recommendation (§9) & concept (§10) ──────────────────────────── */

export interface DesignRecommendation {
  style: string;
  styleRationale: string;
  mood: string[];
  palette: PaletteToken[];
  typography: TypographyChoice;
  layout: string;
  hero: { headline: string; subheadline: string; cta: string; secondaryCta: string; notes: string };
  navigation: string[];
  sections: ConceptSection[];
  contentStructure: { page: string; purpose: string; keyElements: string[] }[];
  images: string[];
  icons: string[];
  animations: string[];
  conversionStrategy: string[];
  pages: string[];
  features: string[];
  designNotes: string;
  accessibilityNotes: string[];
  generatedBy: "local_engine" | AIProviderName;
}

export type ConceptPreset =
  | "premium"
  | "minimal"
  | "corporate"
  | "modern"
  | "luxury"
  | "brand_colors"
  | "playful"
  | "technical";

export const CONCEPT_PRESETS: { key: ConceptPreset; label: string; description: string }[] = [
  { key: "premium", label: "More Premium", description: "Confident typography, generous space, restrained motion" },
  { key: "minimal", label: "More Minimal", description: "Fewer elements, high contrast, content-first" },
  { key: "corporate", label: "More Corporate", description: "Structured, credential-led, formal grid" },
  { key: "modern", label: "More Modern", description: "Expressive layout, bold scale, subtle gradient" },
  { key: "luxury", label: "More Luxury", description: "Editorial serif, deep palette, cinematic imagery" },
  { key: "brand_colors", label: "Use Brand Colors", description: "Derived from the agency's own brand palette" },
  { key: "playful", label: "More Playful", description: "Warm colours, rounded forms, friendly voice" },
  { key: "technical", label: "More Technical", description: "Data-dense, precise, specification-led" },
];

export interface WireframeBlock {
  id: string;
  label: string;
  columns: 1 | 2 | 3 | 4;
  height: "sm" | "md" | "lg" | "xl";
  notes: string;
}

export interface ConceptPreview {
  wireframe: WireframeBlock[];
  heroPreview: { headline: string; subheadline: string; cta: string; palette: string[] };
}

export interface GeneratedConcept extends DesignRecommendation {
  preset: ConceptPreset;
  preview: ConceptPreview;
  changeSummary: string;
}

/* ── Proposal (§13) ──────────────────────────────────────────────────────── */

export interface ProposalDraft {
  title: string;
  subtitle: string;
  executiveSummary: string;
  currentSituation: string;
  problemsIdentified: { title: string; detail: string; evidence: string }[];
  recommendedSolution: string;
  proposedWebsite: { structure: string[]; designDirection: string; designNotes: string };
  recommendedPages: { name: string; purpose: string }[];
  recommendedFeatures: { name: string; benefit: string }[];
  benefits: { title: string; detail: string; metric?: string }[];
  timeline: { phase: string; duration: string; detail: string; deliverables: string[] }[];
  investment: { lineItems: ProposalLineItem[]; subtotal: number; total: number; currency: string };
  estimate: PriceEstimate;
  nextSteps: string[];
  callToAction: { heading: string; body: string; buttonLabel: string };
  beforeAfter: { current: string[]; recommended: string[] };
  sections: ProposalSection[];
  confidence: number;
  verifiedFactsUsed: string[];
  generatedBy: "local_engine" | AIProviderName;
}

/* ── Outreach email (§24) ────────────────────────────────────────────────── */

export interface OutreachEmailDraft {
  subject: string;
  preheader: string;
  body: string;
  bodyHtml: string;
  style: string;
  personalizationUsed: string[];
  /** Any factual claim in the email must trace back to one of these. */
  evidenceRefs: string[];
  followUpInDays: number;
  plainSummary: string;
}

/* ── Conversation (§16, §17, §18) ────────────────────────────────────────── */

export interface IntentDetection {
  intent: IntentLevel;
  score: number;
  confidence: number;
  signals: { phrase: string; meaning: string; weight: number }[];
  sentiment: "positive" | "neutral" | "negative";
  shouldEscalate: boolean;
  escalationReason?: string;
  suggestedLeadStatus?: string;
  summary: string;
}

export interface ChatReply {
  message: string;
  intent: IntentDetection;
  /** Visible to the human agent, not the prospect. */
  internalNote: string;
  suggestedQuestions: string[];
  handoffRecommended: boolean;
  handoffReason?: string;
}

/* ── AI command centre (§38) ─────────────────────────────────────────────── */

export interface CommandInterpretation {
  intent: "search_leads" | "search_businesses" | "run_discovery" | "generate_proposals" | "analytics_query" | "pipeline_action" | "explain" | "unknown";
  summary: string;
  filters: {
    industries?: string[];
    locations?: string[];
    countries?: string[];
    minLeadScore?: number;
    maxWebsiteScore?: number;
    minReviews?: number;
    maxReviews?: number;
    websiteStatus?: string[];
    statuses?: string[];
    temperatures?: string[];
    intents?: string[];
    notContacted?: boolean;
    ownerId?: string;
    tags?: string[];
    limit?: number;
    days?: number;
    sort?: "lead_score" | "opportunity" | "created_at" | "reviews" | "rating";
  };
  actions: { type: string; label: string; destructive: boolean; requiresConfirmation: boolean; payload?: Record<string, unknown> }[];
  explanation: string;
  confidence: number;
  needsConfirmation: boolean;
}

/* ── Shared helpers ──────────────────────────────────────────────────────── */

export interface AIFeatureContext {
  orgId?: string | null;
  userId?: string | null;
  businessName: string;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  websiteUrl?: string | null;
  findings?: AuditFinding[];
  scores?: Record<string, number | null> | null;
  cms?: string | null;
  brandColors?: string[];
  tone?: string;
}

export function findingsToEvidence(findings: AuditFinding[] | undefined, limit = 8): string[] {
  if (!findings?.length) return [];
  return findings
    .filter((f) => f.severity !== "positive")
    .slice(0, limit)
    .map((f) => `[${f.severity}] ${f.title} — ${f.evidence}`);
}
