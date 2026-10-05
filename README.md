# LeadForge

**AI website-sales command centre** — discover businesses whose websites are
holding them back, understand exactly what is wrong, and run the whole
conversation through to a signed project.

![status](https://img.shields.io/badge/status-phase%201%20core%20complete-blue)
![stack](https://img.shields.io/badge/stack-Next.js%2015%20%C2%B7%20React%2019%20%C2%B7%20TypeScript-informational)

---

## Run it locally

```bash
npm install
npm run db:seed      # creates data/leadforge.db and the demo workspace
npm run dev          # http://localhost:3000
```

**Demo sign-in:** `alex@northlight.studio` / `leadforge-demo`
(override the password with `SEED_PASSWORD` before seeding a real instance).

The platform works end to end with **no API keys at all**: SQLite for storage and
a deterministic reasoning engine for AI. Every optional integration is exactly
that — optional — and the product reports its real connection state rather than
pretending.

```bash
npm run typecheck    # tsc --noEmit
npm test             # 73-check self-test suite (scoring, AI, discovery, DB, queue)
npm run build        # production build
npm run jobs:tick    # drain the background job queue once
```

## Hosting it

Full guide: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.

| Environment | Supported |
| --- | --- |
| VPS / dedicated server | ✅ recommended |
| Docker (VPS, Railway, Render, Fly.io) | ✅ `docker compose up -d --build` |
| cPanel / Plesk with "Setup Node.js App" | ⚠️ works, drive the queue from cron |
| Managed WordPress hosting | ❌ PHP only — cannot run this app |
| Serverless (Vercel/Lambda) | ❌ as-is: needs a writable disk and a long-lived process |

It is a Node.js app, not a WordPress plugin. The usual arrangement is WordPress
on `example.com` and LeadForge on `app.example.com`, linked from a menu item or
embedded with an iframe (see the guide).

### Using it with WordPress

The **LeadForge Connector** plugin (in `wordpress-plugin/`, packaged by
`npm run wp:package`) links a WordPress site to a running workspace:

- signed one-click sign-in from wp-admin — single-use, 3-minute HMAC links, no
  password ever crossing between the two systems;
- `[leadforge_link]` and `[leadforge]` shortcodes for buttons and embeds;
- a dashboard widget showing live workspace status and lead counts;
- a settings screen that tests the real connection and reports what failed.

It is a bridge, not the app: WordPress cannot execute Node.js, so the workspace
still needs Node hosting. Full guide, including what is impossible and why:
**[docs/WORDPRESS.md](docs/WORDPRESS.md)**.

```bash
npm run wp:package   # → public/downloads/leadforge-connector-1.0.0.zip
npm run wp:lint      # structural check of the plugin (heuristic; run php -l too)
```

Health check: `GET /api/health`. Scheduled work on timer-less hosts:
`POST /api/jobs/tick` with an `x-cron-secret` header.

## What is built

- **Core platform** — normalised data layer (28+ tables), repositories, RBAC
  across seven roles, audit logging, rate limiting, secret encryption.
- **Audit engine** — robots-aware fetching, nine weighted dimensions, explicit
  non-claims about what could not be measured.
- **Scoring** — overall website score, website opportunity score, buying
  potential, contactability, buying intent and a weighted lead total.
- **AI engines** — business analysis, design recommendations, concept presets,
  proposals, six outreach styles, chat with intent detection, command parsing,
  and guardrails that strip prohibited promises and flag unsupported claims.
- **Services** — discovery, contacts, pricing, proposals, outreach,
  conversations with human takeover, campaigns, pipeline, projects, alerts,
  notifications, exports, observability.
- **Jobs** — 14 handlers with real progress reporting, retries with backoff and
  job logs.
- **UI** — sign-in, dashboard with *Today's Best Opportunities*, lead list and
  lead detail with working proposal/conversation/re-score actions, plus honest
  in-build screens for the remaining destinations.
- **WordPress connector** — plugin with signed sign-in, shortcodes, dashboard
  widget, and the matching signed endpoints in the app.

## What is not built yet

The remaining feature screens (Lead Finder, Pipeline board, Conversations inbox,
Proposals workspace, Campaigns, Analytics, Settings) are designed and their
service layers are implemented, but their UIs are still to come. Their
navigation entries resolve to pages that state what works today and what is
missing — no fake charts, no dead buttons.

## Licence

Apache 2.0 — see [LICENSE](LICENSE).
