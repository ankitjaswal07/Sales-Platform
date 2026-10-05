# Deploying LeadForge

LeadForge is a **Node.js application** (Next.js 15, React 19) with its own
database and a background worker. It is not a WordPress plugin or theme, and it
cannot run inside PHP. So the honest answer to *"can I host it in a WordPress
environment?"* is:

> **Not inside WordPress — but yes, alongside it on the same hosting, if that
> hosting can run a Node.js app.** Most managed WordPress hosts cannot.

This document covers what works, what does not, and the exact steps for each
option.

---

## 1. Which WordPress host will run this?

| Hosting type | Can run LeadForge? | Why |
| --- | --- | --- |
| **VPS / dedicated server** (even one that also runs WordPress) | ✅ **Recommended** | Full Node.js, persistent processes, cron, filesystem control. |
| **cPanel / Plesk shared hosting with the "Setup Node.js App" feature** (CloudLinux + Passenger) | ⚠️ **Usually, with caveats** | Node runs, but long-lived timers are unreliable → drive the queue from cron. Native module builds can fail on some hosts. |
| **Docker-capable VPS or container platform** (Railway, Render, Fly.io, Hetzner + Docker) | ✅ | The repo ships a `Dockerfile` and `docker-compose.yml`. |
| **Managed WordPress hosts** (WP Engine, Kinsta, Flywheel, Pressable, WordPress.com) | ❌ **No** | They run PHP/WordPress only. Arbitrary Node apps are out of scope and usually against the plan's terms. |
| **Standard shared hosting without Node.js** | ❌ No | No Node runtime, no persistent processes. |
| **Serverless (Vercel, Netlify, Lambda)** | ❌ Not as-is | SQLite needs a writable disk and the worker needs a long-lived process. See §7. |

You do **not** have to move your WordPress site. The usual setup is:

```
example.com          → WordPress (unchanged, on its current host or on the VPS)
app.example.com      → LeadForge (Node.js, port 3000, reverse-proxied)
```

Your team links to it from a WordPress menu item, or embeds it in a page (§5).

---

## 2. Requirements

- **Node.js 20.9+** (22 LTS recommended) and npm.
- **A writable directory** for `data/` (SQLite database, WAL files, uploads).
- **~300 MB RAM** for the Node process, 1 vCPU is plenty for a small team.
- **HTTPS** in front of it. Cookies are marked `secure` in production, so the
  app will not sign you in over plain HTTP on a real domain.
- **One long-lived process**, *or* cron (§4).

Environment variables live in `.env.local`. Start from `.env.example`. The only
one you must set is `AUTH_SECRET`:

```bash
cp .env.example .env.local
node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))" >> .env.local
```

Set `SEED_PASSWORD` **before** the first seed so the demo accounts do not get the
published default password.

---

## 3. Option A — VPS with WordPress on the same server (recommended)

Tested path. Assumes Ubuntu/Debian, app in `/srv/leadforge`, WordPress already
serving `example.com`.

### 3.1 Install and build

```bash
sudo apt update && sudo apt install -y nodejs npm nginx certbot python3-certbot-nginx
sudo useradd -r -m -d /srv/leadforge -s /usr/sbin/nologin leadforge

sudo -u leadforge git clone <your-repo> /srv/leadforge/app
cd /srv/leadforge/app
sudo -u leadforge npm ci
sudo -u leadforge cp .env.example .env.local
# edit .env.local: AUTH_SECRET, SEED_PASSWORD, APP_URL=https://app.example.com
sudo -u leadforge npm run build
sudo -u leadforge npm run db:seed     # first run only
```

### 3.2 Run it as a service

`/etc/systemd/system/leadforge.service`:

```ini
[Unit]
Description=LeadForge
After=network.target

[Service]
Type=simple
User=leadforge
WorkingDirectory=/srv/leadforge/app
EnvironmentFile=/srv/leadforge/app/.env.local
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5
# The worker runs in-process, so this service must stay up.

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now leadforge
curl -fsS localhost:3000/api/health
```

### 3.3 Reverse proxy and TLS

`/etc/nginx/sites-available/app.example.com`:

```nginx
server {
  listen 80;
  server_name app.example.com;

  client_max_body_size 25m;   # imports and proposal exports

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;  # audits and AI calls can be slow
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/app.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.example.com
```

Point the DNS `A`/`CNAME` for `app.example.com` at the server first.

> **If you embed the app inside WordPress (§5), do not add
> `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`
> to this vhost** — it would block the iframe. If you never embed it, adding
> `frame-ancestors 'none'` is a sensible hardening step.

### 3.4 Backups

Everything the platform owns is in two places:

```bash
# 1. the database (use the SQLite backup command, never a plain copy of a live WAL database)
sudo -u leadforge sqlite3 /srv/leadforge/app/data/leadforge.db ".backup '/srv/backups/leadforge-$(date +%F).db'"

# 2. locally stored uploads/exports
sudo tar czf /srv/backups/leadforge-files-$(date +%F).tar.gz -C /srv/leadforge/app data/uploads
```

Add both to a nightly cron or your existing WordPress backup routine. Retention
settings inside the app (`settings.retentionDays`, default 730 days) control how
long records are kept, not how long your backups are kept.

---

## 4. Option B — cPanel / Plesk shared hosting with Node.js

Works on hosts that expose **"Setup Node.js App"** (CloudLinux's Node.js selector
backed by Phusion Passenger). If your panel has no Node.js section, this option
is not available — pick a VPS or a container platform instead.

### 4.1 Steps

1. **Check the Node version.** In *Setup Node.js App → Create Application*, the
   selector must offer **20.9 or newer**. If only 16/18 are available, stop here.
2. **Upload the code** (Git deployment, or upload and extract a zip of the repo
   into e.g. `~/leadforge`).
3. **Create the application:**
   - Node.js version: 20.x or 22.x
   - Application root: `leadforge`
   - Application URL: `app.example.com` (create the subdomain first)
   - Application startup file: **`server.js`**
   - Environment variables: add `AUTH_SECRET`, `NODE_ENV=production`,
     `APP_URL=https://app.example.com`, `DATABASE_PATH=data/leadforge.db`,
     `SEED_PASSWORD`, and `WORKER_ENABLED=false` (see 4.3).
4. **Install and build** — in the panel's "Run NPM Install" button, or over SSH:

   ```bash
   cd ~/leadforge
   npm ci                      # if this fails on better-sqlite3, see 4.4
   npm run build
   npm run db:seed             # first run only
   ```

   Make sure `~/leadforge/data` exists and is writable — that is where the
   database lives.
5. **Start** the application from the panel, then open
   `https://app.example.com/api/health`. It should return
   `{"status":"ok", ...}`.

### 4.2 What Passenger does and does not give you

Passenger spawns your app on the first request and may shut it down when idle.
That is fine for pages and API routes, but it means:

- **Timers between requests are unreliable** — the in-process worker may not be
  running when a job is due.
- **Deploys restarts the app** — in-flight background jobs resume from the queue
  on the next tick, which is exactly what the queue is designed for.

### 4.3 Drive the queue from cron instead

Set `WORKER_ENABLED=false` in the application's environment variables, then add a
cron job (cPanel → *Cron Jobs*, every 1–5 minutes):

```bash
curl -fsS -X POST -H "x-cron-secret: YOUR_CRON_SECRET" \
  "https://app.example.com/api/jobs/tick?schedule=1" > /dev/null
```

Add `CRON_SECRET=YOUR_CRON_SECRET` to the app's environment variables. Without
it, the endpoint refuses to run in production and tells you so; it is never open
to anonymous callers. `/api/health` reports `"driver":"cron"` in this mode, so
you can confirm the setup.

Prefer a command over HTTP? The same work is available as a CLI:

```bash
cd ~/leadforge && npm run jobs:tick
```

### 4.4 Known cPanel snags

| Symptom | Cause and fix |
| --- | --- |
| `npm ci` fails compiling `better-sqlite3` | No build toolchain. Ask the host to enable `gcc`/`make`/`python3`, or use a Docker/VPS deployment. Prebuilt binaries cover Linux x64/arm64 with Node 20/22, so this is less common than it used to be. |
| `EACCES` writing to `data/` | Fix permissions: `chmod -R u+rwX data` (and never `777`). |
| 502 from Passenger after a deploy | The old process is still holding the port. Restart the app from the panel ("Restart"), or touch `tmp/restart.txt` if the host uses Passenger's restart convention. |
| `Workspace has not been initialised` | The database is missing: run `npm run db:seed` once (with `SEED_PASSWORD` set). |
| Signed out constantly | The site is being served over HTTP, so the `secure` session cookie is dropped. Terminate TLS at the panel's HTTPS endpoint. |
| Long audits time out | Audits fetch other people's websites; raise the proxy timeout (Nginx `proxy_read_timeout`) and `AUDIT_TIMEOUT_MS`. |

---

## 5. Embedding it in a WordPress page

Two ways, both fine:

**A link (simplest).** Add a menu item or button pointing at
`https://app.example.com`.

**An iframe (feels in-site).** In a WordPress *Custom HTML* block:

```html
<iframe
  src="https://app.example.com/dashboard"
  title="LeadForge"
  style="width:100%;height:calc(100vh - 120px);border:0;border-radius:12px"
  loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
></iframe>
```

Notes:

- The app deliberately does **not** send `X-Frame-Options`, so it can be framed.
  Do not add that header at the proxy if you plan to embed it.
- For a seamless experience, put the iframe on a full-width, no-sidebar page
  template.
- Embedding only works from a domain if the browser allows third-party cookies
  for the iframe's origin. Chrome and Safari increasingly restrict these, which
  can break sign-in *inside* an iframe. If your team hits that, use the link
  approach, or serve the app on a subdomain of the same site (still the
  recommended layout) and open it in its own tab.

**What you cannot do:** install LeadForge as a WordPress plugin, render it with
PHP, or store its data in the WordPress MySQL database. Those are different
runtimes.

---

## 6. Option C — Docker (any VPS, or a container platform)

```bash
cp .env.example .env.local      # set AUTH_SECRET and SEED_PASSWORD at minimum
docker compose up -d --build
docker compose logs -f app
```

- The first start seeds the demo workspace automatically (unless
  `SEED_DEMO_DATA=false`).
- Data lives in the `leadforge-data` volume; `docker compose down` does **not**
  delete it. Back it up with
  `docker run --rm -v leadforge-data:/data -v "$PWD:/out" alpine tar czf /out/leadforge-data.tgz -C /data .`
- Health: `docker compose ps` should show `healthy` (the image ships a
  healthcheck against `/api/health`).
- Upgrading: `git pull && docker compose up -d --build`.

The image always seeds with `SEED_PASSWORD` if you supplied one, so rotate that
value and re-seed only if you want to reset the demo accounts.

---

## 7. What this deployment is *not* (yet)

Being explicit so nobody discovers it in production:

- **Single instance only.** The database is embedded SQLite (one writer) and the
  rate limiter is in-process, so running two containers against the same volume
  is not supported. Scale vertically.
- **No Postgres/Redis drivers.** `.env.example` mentions them as future options;
  only SQLite and the inline queue are implemented today. A multi-instance
  deployment needs that work done first.
- **Serverless is out of scope as-is.** `better-sqlite3` needs a writable
  filesystem and the worker needs a long-lived process. Hosting on Vercel would
  require moving to Postgres plus a scheduled-function queue.
- **Some integrations are unconfigured by default** — and the product says so.
  Without `GOOGLE_PLACES_API_KEY` discovery uses a clearly-labelled sample
  dataset; without `PAGESPEED_API_KEY` audits skip Core Web Vitals and record
  that they could not measure it; without `EMAIL_PROVIDER` emails are stored and
  marked `not_sent`; WhatsApp alerts require the official Cloud API credentials.
  Nothing pretends to be connected.

---

## 8. Post-deploy checklist

- [ ] `https://app.example.com/api/health` returns `status: ok`.
- [ ] `AUTH_SECRET` is a fresh random value (not the one from `.env.example`).
- [ ] `SEED_PASSWORD` was set before seeding; the demo password
      `leadforge-demo` is no longer valid.
- [ ] At least one real user account exists and the demo accounts are
      disabled or repurposed (Settings → Team, Phase 5 UI).
- [ ] HTTPS is terminating correctly and cookies survive a sign-in.
- [ ] If `WORKER_ENABLED=false`: cron hits `/api/jobs/tick` and `/api/health`
      reports `"driver":"cron"`.
- [ ] Backups cover `data/leadforge.db` **and** `data/uploads`.
- [ ] `LOG_LEVEL` is `info` (or `warn`), and logs are being collected.
- [ ] Retention (`retentionDays`) and data-deletion expectations are agreed with
      whoever owns compliance.
