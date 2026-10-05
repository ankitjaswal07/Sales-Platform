/**
 * LeadForge — canonical database schema (SQLite dialect).
 *
 * The runtime uses an embedded SQLite database so the platform is fully
 * functional with zero external services. `prisma/schema.prisma` mirrors this
 * model for the PostgreSQL production target; the repository layer
 * (`src/lib/db/repo`) is the only code that touches SQL, so switching drivers
 * is a contained change. See docs/ARCHITECTURE.md → "Data layer".
 *
 * Conventions
 *  - ids: text, prefix_base36 (readable in logs, sortable enough for demo scale)
 *  - timestamps: ISO-8601 UTC strings, `*_at` naming
 *  - booleans: INTEGER 0/1
 *  - collections/objects: JSON text, suffixed `_json`
 *  - every tenant-scoped table carries `org_id` (multi-tenancy ready, §48)
 */

export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ═══════════════════════════════════════════════════════════════════════════
-- Tenancy, identity & access
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS organizations (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  legal_name        TEXT,
  logo_url          TEXT,
  brand_primary     TEXT DEFAULT '#5b5bd6',
  brand_accent      TEXT DEFAULT '#e8763a',
  brand_font        TEXT DEFAULT 'Geist',
  address           TEXT,
  city              TEXT,
  country           TEXT,
  email             TEXT,
  phone             TEXT,
  website           TEXT,
  timezone          TEXT DEFAULT 'Europe/London',
  currency          TEXT DEFAULT 'GBP',
  plan              TEXT NOT NULL DEFAULT 'scale',
  settings_json     TEXT NOT NULL DEFAULT '{}',
  onboarding_json   TEXT NOT NULL DEFAULT '{}',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  permissions_json  TEXT NOT NULL DEFAULT '[]',
  is_system         INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  password_hash     TEXT NOT NULL,
  name              TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'sales_agent',
  title             TEXT,
  phone             TEXT,
  avatar_url        TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  mfa_enabled       INTEGER NOT NULL DEFAULT 0,
  mfa_secret_enc    TEXT,
  timezone          TEXT DEFAULT 'Europe/London',
  quota_monthly     INTEGER,
  last_login_at     TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (org_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id, status);

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash        TEXT NOT NULL UNIQUE,
  ip_hash           TEXT,
  user_agent        TEXT,
  expires_at        TEXT NOT NULL,
  revoked_at        TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  prefix            TEXT NOT NULL,
  key_hash          TEXT NOT NULL UNIQUE,
  scopes_json       TEXT NOT NULL DEFAULT '[]',
  last_used_at      TEXT,
  expires_at        TEXT,
  revoked_at        TEXT,
  created_at        TEXT NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Business intelligence
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS businesses (
  id                    TEXT PRIMARY KEY,
  org_id                TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  legal_name            TEXT,
  industry              TEXT,
  category              TEXT,
  description           TEXT,
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  state                 TEXT,
  country               TEXT,
  postal_code           TEXT,
  latitude              REAL,
  longitude             REAL,
  phone                 TEXT,
  email                 TEXT,
  website_url           TEXT,
  socials_json          TEXT NOT NULL DEFAULT '{}',
  hours_json            TEXT NOT NULL DEFAULT '[]',
  rating                REAL,
  review_count          INTEGER DEFAULT 0,
  price_level           INTEGER,
  employee_range        TEXT,
  revenue_range         TEXT,
  years_in_business     INTEGER,
  listing_provider      TEXT,
  listing_id            TEXT,
  listing_url           TEXT,
  listing_categories_json TEXT NOT NULL DEFAULT '[]',
  attributes_json       TEXT NOT NULL DEFAULT '{}',
  screenshot_url        TEXT,
  website_status        TEXT NOT NULL DEFAULT 'unknown',
  data_source           TEXT,
  data_confidence       REAL DEFAULT 0.8,
  is_demo               INTEGER NOT NULL DEFAULT 0,
  last_verified_at      TEXT,
  created_by            TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (org_id, name, city)
);
CREATE INDEX IF NOT EXISTS idx_biz_org        ON businesses(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_biz_industry   ON businesses(org_id, industry);
CREATE INDEX IF NOT EXISTS idx_biz_geo        ON businesses(org_id, country, city);
CREATE INDEX IF NOT EXISTS idx_biz_webstatus  ON businesses(org_id, website_status);
CREATE INDEX IF NOT EXISTS idx_biz_reviews    ON businesses(org_id, review_count DESC);
CREATE INDEX IF NOT EXISTS idx_biz_rating     ON businesses(org_id, rating DESC);
CREATE INDEX IF NOT EXISTS idx_biz_postcode   ON businesses(org_id, postal_code);

CREATE TABLE IF NOT EXISTS contacts (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_id       TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  title             TEXT,
  email             TEXT,
  phone             TEXT,
  phone_e164        TEXT,
  linkedin_url      TEXT,
  is_primary        INTEGER NOT NULL DEFAULT 0,
  source            TEXT,
  email_status      TEXT NOT NULL DEFAULT 'unverified',
  phone_status      TEXT NOT NULL DEFAULT 'unverified',
  timezone          TEXT,
  tags_json         TEXT NOT NULL DEFAULT '[]',
  notes             TEXT,
  last_verified_at  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_biz   ON contacts(business_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(org_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts(org_id, phone_e164);

CREATE TABLE IF NOT EXISTS websites (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  normalized_url    TEXT NOT NULL,
  host              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'unchecked',
  https             INTEGER NOT NULL DEFAULT 0,
  http_status       INTEGER,
  redirect_chain_json TEXT NOT NULL DEFAULT '[]',
  cms               TEXT,
  tech_json         TEXT NOT NULL DEFAULT '[]',
  page_count        INTEGER DEFAULT 0,
  has_viewport      INTEGER,
  has_sitemap       INTEGER,
  has_robots        INTEGER,
  copyright_year    INTEGER,
  est_age_years     INTEGER,
  screenshot_url    TEXT,
  last_crawled_at   TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (org_id, normalized_url)
);
CREATE INDEX IF NOT EXISTS idx_websites_biz    ON websites(business_id);
CREATE INDEX IF NOT EXISTS idx_websites_status ON websites(org_id, status);

CREATE TABLE IF NOT EXISTS website_audits (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  website_id        TEXT REFERENCES websites(id) ON DELETE CASCADE,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  job_id            TEXT,
  status            TEXT NOT NULL DEFAULT 'queued',
  engine_version    TEXT NOT NULL DEFAULT '1.0.0',
  mode              TEXT NOT NULL DEFAULT 'live',
  overall_score     INTEGER,
  performance       INTEGER,
  mobile            INTEGER,
  seo               INTEGER,
  ux                INTEGER,
  accessibility     INTEGER,
  conversion        INTEGER,
  technical         INTEGER,
  content           INTEGER,
  trust             INTEGER,
  metrics_json      TEXT NOT NULL DEFAULT '{}',
  findings_json     TEXT NOT NULL DEFAULT '[]',
  opportunities_json TEXT NOT NULL DEFAULT '[]',
  pages_json        TEXT NOT NULL DEFAULT '[]',
  tech_json         TEXT NOT NULL DEFAULT '[]',
  core_web_vitals_json TEXT NOT NULL DEFAULT '{}',
  notes             TEXT,
  error             TEXT,
  duration_ms       INTEGER,
  started_at        TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audits_biz   ON website_audits(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audits_score ON website_audits(org_id, overall_score);
CREATE INDEX IF NOT EXISTS idx_audits_subs  ON website_audits(org_id, performance, seo, mobile);

-- ═══════════════════════════════════════════════════════════════════════════
-- Leads, scoring & pipeline
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS lead_stages (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL,
  type          TEXT NOT NULL DEFAULT 'open',
  color         TEXT,
  probability   INTEGER NOT NULL DEFAULT 10,
  sla_hours     INTEGER,
  is_active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS leads (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id        TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  campaign_id       TEXT,
  discovery_run_id  TEXT,
  reference         TEXT NOT NULL,
  source            TEXT NOT NULL DEFAULT 'discovery',
  status            TEXT NOT NULL DEFAULT 'new',
  stage_key         TEXT NOT NULL DEFAULT 'new',
  stage_position    INTEGER NOT NULL DEFAULT 0,
  temperature       TEXT NOT NULL DEFAULT 'cold',
  priority          INTEGER NOT NULL DEFAULT 0,
  owner_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  tags_json         TEXT NOT NULL DEFAULT '[]',
  website_score     INTEGER,
  opportunity_score INTEGER,
  lead_score        INTEGER,
  business_quality  INTEGER,
  buying_potential  INTEGER,
  contactability    INTEGER,
  intent            TEXT NOT NULL DEFAULT 'unknown',
  intent_score      INTEGER NOT NULL DEFAULT 0,
  estimated_value   INTEGER,
  currency          TEXT NOT NULL DEFAULT 'GBP',
  confidence        INTEGER DEFAULT 50,
  next_action       TEXT,
  next_follow_up_at TEXT,
  last_activity_at  TEXT,
  last_contacted_at TEXT,
  won_at            TEXT,
  lost_at           TEXT,
  lost_reason       TEXT,
  disqualified      INTEGER NOT NULL DEFAULT 0,
  opt_out           INTEGER NOT NULL DEFAULT 0,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_org      ON leads(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_stage    ON leads(org_id, stage_position, priority DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score    ON leads(org_id, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_temp     ON leads(org_id, temperature, lead_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_owner    ON leads(org_id, owner_id, status);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(org_id, next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_leads_intent   ON leads(org_id, intent);

CREATE TABLE IF NOT EXISTS lead_scores (
  id                  TEXT PRIMARY KEY,
  org_id              TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id             TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  business_quality    INTEGER NOT NULL DEFAULT 0,
  website_opportunity INTEGER NOT NULL DEFAULT 0,
  buying_potential    INTEGER NOT NULL DEFAULT 0,
  contactability      INTEGER NOT NULL DEFAULT 0,
  buying_intent       INTEGER NOT NULL DEFAULT 0,
  total               INTEGER NOT NULL DEFAULT 0,
  tier                TEXT NOT NULL DEFAULT 'cold',
  factors_json        TEXT NOT NULL DEFAULT '[]',
  reason              TEXT,
  computed_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scores_lead ON lead_scores(lead_id, computed_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Conversations & outreach
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS conversations (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id           TEXT REFERENCES leads(id) ON DELETE CASCADE,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id        TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  channel           TEXT NOT NULL DEFAULT 'web_chat',
  status            TEXT NOT NULL DEFAULT 'ai_active',
  ai_enabled        INTEGER NOT NULL DEFAULT 1,
  assigned_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  intent            TEXT NOT NULL DEFAULT 'unknown',
  intent_score      INTEGER NOT NULL DEFAULT 0,
  sentiment         TEXT NOT NULL DEFAULT 'neutral',
  summary           TEXT,
  transcript_url    TEXT,
  public_token      TEXT UNIQUE,
  unread_for_org    INTEGER NOT NULL DEFAULT 0,
  message_count     INTEGER NOT NULL DEFAULT 0,
  escalated_at      TEXT,
  last_message_at   TEXT,
  last_ai_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conv_org   ON conversations(org_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_lead  ON conversations(lead_id);
CREATE INDEX IF NOT EXISTS idx_conv_intent ON conversations(org_id, intent_score DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL,
  author_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_label      TEXT,
  body              TEXT NOT NULL,
  intent            TEXT,
  intent_score      INTEGER,
  signals_json      TEXT NOT NULL DEFAULT '[]',
  ai_interaction_id TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS campaigns (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  industry          TEXT,
  location          TEXT,
  criteria_json     TEXT NOT NULL DEFAULT '{}',
  sequence_json     TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL DEFAULT 'draft',
  daily_cap         INTEGER NOT NULL DEFAULT 50,
  require_approval  INTEGER NOT NULL DEFAULT 1,
  owner_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  target_count      INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT,
  completed_at      TEXT,
  paused_reason     TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id       TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  lead_id           TEXT REFERENCES leads(id) ON DELETE CASCADE,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id        TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  step              INTEGER NOT NULL DEFAULT 0,
  state             TEXT NOT NULL DEFAULT 'pending',
  skip_reason       TEXT,
  last_sent_at      TEXT,
  next_send_at      TEXT,
  replied_at        TEXT,
  bounced_at        TEXT,
  unsubscribed_at   TEXT,
  engaged           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (campaign_id, business_id)
);
CREATE INDEX IF NOT EXISTS idx_recip_campaign ON campaign_recipients(campaign_id, state);
CREATE INDEX IF NOT EXISTS idx_recip_next     ON campaign_recipients(state, next_send_at);

CREATE TABLE IF NOT EXISTS emails (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id       TEXT REFERENCES campaigns(id) ON DELETE SET NULL,
  lead_id           TEXT REFERENCES leads(id) ON DELETE SET NULL,
  business_id       TEXT REFERENCES businesses(id) ON DELETE SET NULL,
  contact_id        TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  user_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  direction         TEXT NOT NULL DEFAULT 'outbound',
  style             TEXT,
  from_address      TEXT,
  to_address        TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body_text         TEXT,
  body_html         TEXT,
  provider          TEXT,
  provider_message_id TEXT,
  status            TEXT NOT NULL DEFAULT 'queued',
  error             TEXT,
  opened_at         TEXT,
  clicked_at        TEXT,
  replied_at        TEXT,
  bounced_at        TEXT,
  sent_at           TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emails_lead     ON emails(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_campaign ON emails(campaign_id, status);

CREATE TABLE IF NOT EXISTS outreach_optouts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT,
  domain        TEXT,
  reason        TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_optout_email ON outreach_optouts(org_id, email);

-- ═══════════════════════════════════════════════════════════════════════════
-- Proposals & concepts
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS proposals (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id           TEXT REFERENCES leads(id) ON DELETE SET NULL,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id        TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  audit_id          TEXT REFERENCES website_audits(id) ON DELETE SET NULL,
  concept_id        TEXT,
  number            TEXT NOT NULL,
  title             TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft',
  template          TEXT NOT NULL DEFAULT 'signature',
  currency          TEXT NOT NULL DEFAULT 'GBP',
  subtotal          INTEGER NOT NULL DEFAULT 0,
  discount          INTEGER NOT NULL DEFAULT 0,
  tax               INTEGER NOT NULL DEFAULT 0,
  total             INTEGER NOT NULL DEFAULT 0,
  monthly_retainer  INTEGER DEFAULT 0,
  timeline_weeks    INTEGER,
  sections_json     TEXT NOT NULL DEFAULT '[]',
  line_items_json   TEXT NOT NULL DEFAULT '[]',
  design_json       TEXT NOT NULL DEFAULT '{}',
  concept_json      TEXT NOT NULL DEFAULT '{}',
  pricing_source    TEXT NOT NULL DEFAULT 'ai_recommended',
  ai_generated      INTEGER NOT NULL DEFAULT 1,
  approved_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_at       TEXT,
  public_token      TEXT UNIQUE,
  version           INTEGER NOT NULL DEFAULT 1,
  valid_until       TEXT,
  sent_at           TEXT,
  viewed_at         TEXT,
  view_count        INTEGER NOT NULL DEFAULT 0,
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  accepted_at       TEXT,
  declined_at       TEXT,
  decline_reason    TEXT,
  notes             TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prop_org    ON proposals(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prop_lead   ON proposals(lead_id);
CREATE INDEX IF NOT EXISTS idx_prop_status ON proposals(org_id, status);
CREATE INDEX IF NOT EXISTS idx_prop_token  ON proposals(public_token);

CREATE TABLE IF NOT EXISTS proposal_views (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  proposal_id       TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  session_key       TEXT NOT NULL,
  viewer_ip_hash    TEXT,
  user_agent        TEXT,
  referrer          TEXT,
  duration_seconds  INTEGER NOT NULL DEFAULT 0,
  max_scroll        REAL NOT NULL DEFAULT 0,
  sections_viewed_json TEXT NOT NULL DEFAULT '[]',
  cta_clicks_json   TEXT NOT NULL DEFAULT '[]',
  opened_at         TEXT NOT NULL,
  last_seen_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pview_prop ON proposal_views(proposal_id, opened_at DESC);

CREATE TABLE IF NOT EXISTS website_concepts (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  lead_id           TEXT REFERENCES leads(id) ON DELETE SET NULL,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  variant           TEXT NOT NULL DEFAULT 'primary',
  preset            TEXT NOT NULL DEFAULT 'premium',
  style             TEXT NOT NULL,
  palette_json      TEXT NOT NULL DEFAULT '{}',
  typography_json   TEXT NOT NULL DEFAULT '{}',
  structure_json    TEXT NOT NULL DEFAULT '[]',
  content_json      TEXT NOT NULL DEFAULT '{}',
  design_notes      TEXT,
  conversion_json   TEXT NOT NULL DEFAULT '{}',
  preview_json      TEXT NOT NULL DEFAULT '{}',
  parent_id         TEXT,
  is_selected       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_concept_biz  ON website_concepts(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_concept_lead ON website_concepts(lead_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Operations: tasks, projects, catalog, notifications, alerts
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS activities (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id       TEXT REFERENCES leads(id) ON DELETE CASCADE,
  business_id   TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  contact_id    TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  type          TEXT NOT NULL,
  channel       TEXT,
  subject       TEXT,
  body          TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  is_system     INTEGER NOT NULL DEFAULT 0,
  occurred_at   TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_act_lead ON activities(lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_org  ON activities(org_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id           TEXT REFERENCES leads(id) ON DELETE CASCADE,
  business_id       TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  project_id        TEXT REFERENCES projects(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  description       TEXT,
  type              TEXT NOT NULL DEFAULT 'follow_up',
  priority          TEXT NOT NULL DEFAULT 'medium',
  status            TEXT NOT NULL DEFAULT 'open',
  due_at            TEXT,
  assigned_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  completed_at      TEXT,
  reminder_sent_at  TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_due  ON tasks(org_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_lead ON tasks(lead_id);

CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id           TEXT REFERENCES leads(id) ON DELETE SET NULL,
  business_id       TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  proposal_id       TEXT REFERENCES proposals(id) ON DELETE SET NULL,
  code              TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'discovery',
  health            TEXT NOT NULL DEFAULT 'on_track',
  start_date        TEXT,
  deadline          TEXT,
  completed_at      TEXT,
  budget            INTEGER,
  currency          TEXT NOT NULL DEFAULT 'GBP',
  owner_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  team_json         TEXT NOT NULL DEFAULT '[]',
  scope_json        TEXT NOT NULL DEFAULT '[]',
  requirements_json TEXT NOT NULL DEFAULT '[]',
  design_json       TEXT NOT NULL DEFAULT '{}',
  notes             TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id, status);

CREATE TABLE IF NOT EXISTS services (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'website',
  description       TEXT,
  starting_price    INTEGER NOT NULL DEFAULT 0,
  price             INTEGER,
  currency          TEXT NOT NULL DEFAULT 'GBP',
  billing           TEXT NOT NULL DEFAULT 'one_off',
  timeline_days_min INTEGER NOT NULL DEFAULT 7,
  timeline_days_max INTEGER NOT NULL DEFAULT 30,
  features_json     TEXT NOT NULL DEFAULT '[]',
  addons_json       TEXT NOT NULL DEFAULT '[]',
  complexity_weight REAL NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS pricing_plans (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  price         INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'GBP',
  billing       TEXT NOT NULL DEFAULT 'one_off',
  pages_included INTEGER,
  features_json TEXT NOT NULL DEFAULT '[]',
  is_popular    INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'info',
  title         TEXT NOT NULL,
  body          TEXT,
  entity_type   TEXT,
  entity_id     TEXT,
  action_url    TEXT,
  icon          TEXT,
  channels_json TEXT NOT NULL DEFAULT '[]',
  read_at       TEXT,
  dismissed_at  TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(org_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(org_id, read_at);

CREATE TABLE IF NOT EXISTS alert_rules (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  conditions_json   TEXT NOT NULL DEFAULT '[]',
  actions_json      TEXT NOT NULL DEFAULT '[]',
  cooldown_minutes  INTEGER NOT NULL DEFAULT 60,
  trigger_count     INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TEXT,
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id       TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
  lead_id       TEXT REFERENCES leads(id) ON DELETE CASCADE,
  business_id   TEXT REFERENCES businesses(id) ON DELETE CASCADE,
  severity      TEXT NOT NULL DEFAULT 'high',
  title         TEXT NOT NULL,
  body          TEXT,
  channels_json TEXT NOT NULL DEFAULT '[]',
  delivery_json TEXT NOT NULL DEFAULT '{}',
  acknowledged_at TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(org_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- Platform: jobs, integrations, AI, observability
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  queue         TEXT NOT NULL DEFAULT 'default',
  type          TEXT NOT NULL,
  label         TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',
  priority      INTEGER NOT NULL DEFAULT 5,
  progress      INTEGER NOT NULL DEFAULT 0,
  stage         TEXT,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  result_json   TEXT NOT NULL DEFAULT '{}',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  error         TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at  TEXT NOT NULL,
  started_at    TEXT,
  completed_at  TEXT,
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_jobs_org    ON jobs(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS job_logs (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  level         TEXT NOT NULL DEFAULT 'info',
  message       TEXT NOT NULL,
  meta_json     TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_joblogs_job ON job_logs(job_id, created_at);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  query_json    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  providers_json TEXT NOT NULL DEFAULT '[]',
  found_count   INTEGER NOT NULL DEFAULT 0,
  new_count     INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  audited_count INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  completed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_discovery_org ON discovery_runs(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integrations (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key               TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'not_connected',
  required_env_json TEXT NOT NULL DEFAULT '[]',
  config_json       TEXT NOT NULL DEFAULT '{}',
  secret_enc        TEXT,
  docs_url          TEXT,
  connected_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  connected_at      TEXT,
  last_checked_at   TEXT,
  last_error        TEXT,
  updated_at        TEXT NOT NULL,
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS webhooks (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL DEFAULT 'inbound',
  provider      TEXT NOT NULL,
  event         TEXT,
  url           TEXT,
  status        TEXT NOT NULL DEFAULT 'received',
  signature_ok  INTEGER,
  payload_json  TEXT NOT NULL DEFAULT '{}',
  response_code INTEGER,
  attempts      INTEGER NOT NULL DEFAULT 1,
  error         TEXT,
  received_at   TEXT NOT NULL,
  next_retry_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(org_id, received_at DESC);

CREATE TABLE IF NOT EXISTS ai_interactions (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  feature       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT,
  entity_type   TEXT,
  entity_id     TEXT,
  prompt        TEXT,
  response      TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  cost_estimate REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'ok',
  error         TEXT,
  guardrail_flags_json TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_org ON ai_interactions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_feature ON ai_interactions(feature, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_type    TEXT NOT NULL DEFAULT 'user',
  action        TEXT NOT NULL,
  entity_type   TEXT,
  entity_id     TEXT,
  ip_hash       TEXT,
  user_agent    TEXT,
  meta_json     TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auditlog_org    ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditlog_entity ON audit_logs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS app_logs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  level         TEXT NOT NULL DEFAULT 'info',
  scope         TEXT NOT NULL,
  message       TEXT NOT NULL,
  meta_json     TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_applogs ON app_logs(scope, created_at DESC);

CREATE TABLE IF NOT EXISTS saved_views (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL,
  name          TEXT NOT NULL,
  filters_json  TEXT NOT NULL DEFAULT '{}',
  is_shared     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope         TEXT NOT NULL DEFAULT 'agency',
  key           TEXT NOT NULL,
  value_json    TEXT NOT NULL DEFAULT 'null',
  updated_at    TEXT NOT NULL,
  UNIQUE (org_id, scope, key)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Single-use launch tokens for signed sign-ins from external systems
-- (currently the WordPress connector). The primary key gives replay protection:
-- a second use of the same nonce fails the insert.
CREATE TABLE IF NOT EXISTS sso_launch_tokens (
  nonce      TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sso_expiry ON sso_launch_tokens(expires_at);
`;

/** Idempotent additive migrations applied after the base schema. */
export const MIGRATIONS: string[] = [];
