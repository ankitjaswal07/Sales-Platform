=== LeadForge Connector ===
Contributors: leadforge
Tags: crm, lead generation, sales, ai, sso
Requires at least: 5.8
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 1.0.0
License: Apache-2.0
License URI: https://www.apache.org/licenses/LICENSE-2.0

Connects WordPress to your LeadForge workspace: signed one-click sign-in, an embed shortcode, and a dashboard widget showing live workspace status.

== Description ==

**LeadForge Connector is a bridge, not the application.**

LeadForge — the AI website-sales command centre — is a Node.js application with
its own database. WordPress runs PHP, so the app itself cannot be installed as a
plugin or theme. This plugin connects a WordPress site to a LeadForge instance
running elsewhere (a subdomain such as `app.example.com`).

= What it does =

* **Signed one-click sign-in.** A user's "Open LeadForge" button carries a
  single-use, HMAC-signed link that expires in 3 minutes. No password is ever
  sent between WordPress and LeadForge, and the link cannot be replayed. The
  account must already exist in LeadForge — the connector can sign someone in,
  it can never create access.
* **Shortcodes.** `[leadforge_link]` for a button, `[leadforge]` to embed the
  workspace in a page.
* **Dashboard widget.** Shows whether the workspace is answering, plus lead,
  hot-lead, uncontacted and proposal counts read from the app.
* **Honest status.** The settings screen tests the real connection and reports
  exactly what failed, instead of implying success.

= What it does not do =

* It does not run LeadForge inside WordPress (impossible — different runtime).
* It does not store your leads, proposals or audit data in the WordPress
  database. That data lives in the LeadForge workspace.
* It does not create LeadForge accounts. Invite people in LeadForge first.

== Installation ==

1. Upload the `leadforge-connector` folder to `/wp-content/plugins/`, or upload
   the supplied zip through *Plugins → Add New → Upload Plugin*.
2. Activate the plugin.
3. Go to **LeadForge → Settings**.
4. Enter your workspace URL, e.g. `https://app.example.com`.
5. Enter the shared secret. On the LeadForge server set
   `WORDPRESS_CONNECTOR_SECRET` to the same value (32+ random characters):
   `openssl rand -base64 32`. Restart the LeadForge app afterwards.
6. Save. The screen tests the connection and tells you if it is not working.

== Frequently Asked Questions ==

= Can I run LeadForge itself in WordPress? =

No. It is a Next.js/Node.js application with an embedded SQLite database and a
background worker. WordPress cannot execute Node.js code. See
`docs/DEPLOYMENT.md` in the application repository for the hosting options.

= Why is the embedded iframe sign-in failing? =

Browsers increasingly block third-party cookies inside iframes, which stops a
session from being set. Use a subdomain of the same site and open the app in its
own tab for the most reliable experience.

= Do users need matching accounts? =

Yes. The signed link names an email address; that address must already exist as
an active user in the LeadForge workspace.

== Changelog ==

= 1.0.0 =
* First release: signed sign-in, shortcodes, dashboard widget, connection tests.
