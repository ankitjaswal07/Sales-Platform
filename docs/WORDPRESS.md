# Using LeadForge from WordPress

> **The short version:** LeadForge is a Node.js application. WordPress runs PHP.
> The app **cannot** be installed as a WordPress plugin or theme, and its data
> will never live in your WordPress database. What you *can* do — and what this
> page covers — is run LeadForge beside WordPress and connect the two with the
> **LeadForge Connector** plugin.

```
example.com            →  WordPress (unchanged, PHP)
app.example.com        →  LeadForge (Node.js, port 3000, HTTPS)
                          └── LeadForge Connector plugin links the two
```

---

## 1. What the connector plugin does

| Feature | What it actually does |
| --- | --- |
| **Signed one-click sign-in** | The "Open LeadForge" button carries a single-use, HMAC-signed link (expires in 3 minutes). No password is ever sent between the two systems, and a link cannot be replayed. |
| **Admin menu** | A top-level **LeadForge** menu item, either straight to the app or via an in-between page with a status panel. |
| **Shortcodes** | `[leadforge_link]` renders a signed launch button. `[leadforge]` embeds the workspace in a page. |
| **Dashboard widget** | Shows whether the workspace is answering, plus lead / hot-lead / uncontacted / proposal counts read live from the app. |
| **Connection tests** | The settings screen checks `/api/health` and makes a real signed request, then reports exactly what passed or failed. |

## What it deliberately does **not** do

- It does not run LeadForge inside WordPress. That is not possible — different runtime.
- It does not store leads, proposals, audits or conversations in the WordPress
  database. That data belongs to the app.
- It does not create LeadForge accounts. A signed link can only sign in an
  **existing, active** user; the plugin cannot mint access.
- It does not expose API keys to the browser. The shared secret stays in
  `wp_options` and in the app's environment.

---

## 2. Before you start

1. **A host that can run Node.js** for the app — a VPS, or cPanel with
   "Setup Node.js App". See [DEPLOYMENT.md](DEPLOYMENT.md). Managed WordPress
   hosts (Kinsta, WP Engine, Flywheel, Pressable) cannot do this.
2. **A subdomain** for the app, e.g. `app.example.com`, with HTTPS. Session
   cookies are `secure` in production, so plain HTTP will not keep you signed in.
3. **Matching user accounts.** The email address of each WordPress user who will
   open the app must exist as an active user in the LeadForge workspace.
4. **WordPress 5.8+** and **PHP 7.4+**.

---

## 3. Step-by-step setup

### 3.1 Generate the shared secret

```bash
openssl rand -base64 32
```

### 3.2 Give it to the app

In the LeadForge server's `.env.local`:

```bash
WORDPRESS_CONNECTOR_SECRET=paste-the-same-value-here
APP_URL=https://app.example.com
```

`APP_URL` matters: it is what signed launch links redirect to (behind a proxy the
request itself may carry an internal address). Restart the app afterwards:

```bash
sudo systemctl restart leadforge      # or: docker compose up -d
```

Verify the app is happy:

```bash
curl -fsS https://app.example.com/api/health
```

### 3.3 Install the plugin

Download the zip from the app itself:

```
https://app.example.com/downloads/leadforge-connector-1.0.0.zip
```

(or rebuild it from source with `npm run wp:package`).

In WordPress: **Plugins → Add New → Upload Plugin → choose the zip → Install →
Activate**.

### 3.4 Configure it

Go to **LeadForge → Settings** and fill in:

| Field | Value |
| --- | --- |
| LeadForge URL | `https://app.example.com` (no trailing slash) |
| Shared secret | the value from step 3.1 (24+ characters; it is rejected below that) |
| Sign users in automatically | leave ticked for single-click sign-in |
| Show the LeadForge dashboard widget | your choice |
| The admin menu opens LeadForge directly | your choice |
| Embed height | default height for `[leadforge]`, e.g. `900` |

Save. The screen then runs two real tests: an unsigned health check, and a signed
status request. Both results are shown as they are — including failures.

### 3.5 Put it in front of your team

- **Menu:** a **LeadForge** item now appears in wp-admin. Anyone with the
  `read` capability sees it; the signed link identifies whoever clicks it.
- **A button on a page:**

  ```
  [leadforge_link label="Open LeadForge"]
  ```

- **An embedded workspace:**

  ```
  [leadforge height="1000" path="/dashboard"]
  ```

  Note the cookie caveat in §5 before relying on the embed.

---

## 4. How the signed sign-in works

```
WordPress                                   LeadForge
─────────                                   ─────────
email   = current user's email
ts      = unix seconds now
nonce   = 16 random bytes
sig     = base64url(HMAC-SHA256(secret,
            "sso|{email}|{ts}|{nonce}"))
                    │
                    ├── GET /api/auth/sso?email&ts&nonce&sig&next ──▶
                                                          verify HMAC (constant time)
                                                          verify |now − ts| ≤ 180s
                                                          claim nonce (single use, PK)
                                                          look up existing active user
                                                          start session, write audit log
                    ◀── 307 + httpOnly session cookie ────
```

Rejections are specific, which makes them fixable rather than mysterious:

| Response | Meaning |
| --- | --- |
| `503 connector_not_configured` | `WORDPRESS_CONNECTOR_SECRET` is unset (or shorter than 24 characters) on the app. |
| `401 bad_signature` | The two secrets differ, or the link was edited. |
| `410 expired` | The link is older than 3 minutes. Click the button again. |
| `410 replayed` | That exact link was already used. Open a fresh one from WordPress. |
| `404 unknown_user` | That email has no account in the workspace. Invite them in LeadForge first. |

Every attempt — accepted or not — is logged with its reason, and successful
sign-ins are written to the audit trail as `auth.sso_login`.

---

## 5. Embedding: the honest caveats

The iframe works, and the app sends no `X-Frame-Options` header so nothing blocks
it by default. But:

- **Third-party cookies.** Sign-in *inside* an iframe requires the browser to
  accept cookies for the app's domain in a third-party context. Chrome and Safari
  restrict this, and it changes between releases. If a user is repeatedly bounced
  to the sign-in screen inside the embed, this is why.
- **Mitigation:** serve the app on a subdomain of the same registrable domain
  (`app.example.com` beside `example.com`) and prefer `[leadforge_link]`, which
  opens the app in its own tab. Cookies are then first-party and signing in
  sticks.
- **Do not** add `X-Frame-Options: DENY` or `Content-Security-Policy:
  frame-ancestors 'none'` at your reverse proxy if you intend to embed.

If you never embed, add those headers — they are good hardening.

---

## 6. What you cannot do (and why)

| Want | Possible? | Why |
| --- | --- | --- |
| Install LeadForge as a WP plugin | ❌ | It is Node.js; WordPress executes PHP. |
| Keep LeadForge data in the WP database | ❌ | The app owns its own SQLite database, schema and migrations. |
| Show live lead tables inside wp-admin | ⚠️ Partly | The widget shows counts only. Returning prospect names would mean exposing customer data to any WordPress admin session — deliberately out of scope. |
| Use your WordPress theme for the app's UI | ❌ | Different frontends. The app has its own design system (dark/light, responsive). |
| Put the app behind WordPress logins | ✅ Effectively | That is exactly what the signed sign-in does, with stricter rules (existing accounts, single-use links, 3-minute expiry). |

> If what you actually want is a **WordPress-native CRM**, that is a different
> product: PHP, WP tables, WP users — it would be a from-scratch rewrite that
> shares nothing with this codebase. Worth deciding deliberately rather than
> discovering halfway.

---

## 7. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Widget says "not answering" | Wrong URL, DNS, firewall, or the app is down | `curl https://app.example.com/api/health` from the WordPress server. Hosts often block outbound HTTPS. |
| "Signed requests are failing: signature did not match" | The two secrets differ, or there is whitespace | Re-copy the secret into **LeadForge → Settings**. Secrets are case-sensitive. |
| "Signed requests are failing: requests must be signed within 180 seconds" | The WordPress server's clock is wrong | Enable NTP: `timedatectl set-ntp true`. |
| Every click lands on the sign-in screen | Cookies or redirect base | Check `APP_URL` is set and HTTPS works end to end. |
| "No LeadForge account exists for …" | Missing user | Invite them in LeadForge, then retry. |
| Menu item missing | Capability | The menu needs `read`; the settings page needs `manage_options`. |
| Plugin will not activate | PHP version | Needs PHP 7.4+. |
| Iframe blank, no error | Third-party cookies | See §5 — use the link instead. |

---

## 8. Uninstalling

Deactivating and deleting the plugin removes **only** its own options and cached
responses. It never touches the LeadForge application or its data. To fully
disconnect, also remove `WORDPRESS_CONNECTOR_SECRET` from the app's environment
and restart it — the signed endpoints then return `503` and stay closed.

---

## 9. Files in this repository

```
wordpress-plugin/leadforge-connector/
├── leadforge-connector.php            # plugin bootstrap, admin menu, screens
├── includes/
│   ├── class-leadforge-signer.php      # HMAC signing, mirrors connector.ts
│   ├── class-leadforge-settings.php    # options, validation, settings UI, status boxes
│   ├── class-leadforge-api.php         # health + signed status HTTP client
│   ├── class-leadforge-shortcode.php   # [leadforge_link] and [leadforge]
│   └── class-leadforge-widget.php      # wp-admin dashboard widget
├── assets/admin.css                    # admin styling (namespaced)
├── readme.txt                          # WordPress.org-style readme
└── uninstall.php                       # removes plugin options only
```

Rebuild the installable zip after any change:

```bash
npm run wp:package      # → public/downloads/leadforge-connector-<version>.zip
```

The corresponding app-side code is
`src/lib/api/connector.ts`, `src/app/api/auth/sso/route.ts` and
`src/app/api/integrations/wordpress/status/route.ts`.
