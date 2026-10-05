import type { Metadata } from "next";
import fs from "node:fs";
import path from "node:path";
import { currentSession } from "@/lib/auth/session";
import { listIntegrations, listAlertRules } from "@/lib/db/repo/ops";
import { listRoles, listStages, listUsers } from "@/lib/db/repo/org";
import { listServices } from "@/lib/db/repo/ops";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await currentSession();
  if (!session) return null;
  const orgId = session.organization.id;
  const integrations = listIntegrations(orgId);
  const connected = integrations.filter((i) => i.status === "connected").length;

  // The WordPress connector zip, if this deployment has built one.
  const downloadsDir = path.join(process.cwd(), "public", "downloads");
  const connectorZips = fs.existsSync(downloadsDir)
    ? fs.readdirSync(downloadsDir).filter((name) => name.startsWith("leadforge-connector") && name.endsWith(".zip")).sort().reverse()
    : [];
  const connectorConfigured = Boolean(process.env.WORDPRESS_CONNECTOR_SECRET);

  return (
    <SectionNotice
      href="/settings"
      phase="Phase 5 — settings workspace"
      facts={[
        { label: "Integrations connected", value: `${connected}/${integrations.length}`, hint: "Unconnected ones name the exact environment variable needed" },
        { label: "Team members", value: String(listUsers(orgId).length) },
        { label: "Roles", value: String(listRoles(orgId).length) },
        { label: "Pipeline stages", value: String(listStages(orgId).length) },
        { label: "Services priced", value: String(listServices(orgId).length) },
        { label: "Alert rules", value: String(listAlertRules(orgId).length) },
      ]}
      todo={[
        "Agency profile and brand, used on every proposal and email.",
        "Team management: invites, the seven roles and their permission matrix.",
        "Pipeline stage editor, service catalogue, alert rules, retention and data export/deletion.",
        "Integration setup screens that show real connection state and test the credentials they are given.",
      ]}
      notes={[
        "No setting is decorative: each one maps to a value the services already read.",
        "API keys are stored encrypted at rest and are never rendered back into the browser.",
      ]}
    >
      <div className="mt-4 space-y-2 rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold">WordPress connector</p>
          <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${connectorConfigured ? "bg-success-soft text-success-soft-foreground" : "bg-warning-soft text-warning-soft-foreground"}`}>
            {connectorConfigured ? "Shared secret configured" : "WORDPRESS_CONNECTOR_SECRET not set"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          WordPress cannot run this app (it is PHP; LeadForge is Node.js), but the connector plugin gives your WordPress
          site signed one-click sign-in, an embed shortcode and a dashboard widget.
        </p>
        {connectorConfigured ? null : (
          <p className="text-xs text-warning-soft-foreground">
            Set <code className="rounded bg-surface-muted px-1 font-mono">WORDPRESS_CONNECTOR_SECRET</code> to 32+ random
            characters and restart before installing the plugin — until then its signed requests will be refused, by design.
          </p>
        )}
        {connectorZips.length > 0 ? (
          <p className="text-xs">
            <a href={`/downloads/${connectorZips[0]}`} className="font-medium text-primary hover:underline">
              Download {connectorZips[0]}
            </a>{" "}
            <span className="text-subtle-foreground">
              ({Math.max(1, Math.round(fs.statSync(path.join(downloadsDir, connectorZips[0]!)).size / 1024))} KB) then
              upload it under Plugins → Add New → Upload Plugin.
            </span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No package has been built yet. Run <code className="rounded bg-surface-muted px-1 font-mono">npm run wp:package</code>{" "}
            to produce one, or see <code className="rounded bg-surface-muted px-1 font-mono">docs/WORDPRESS.md</code>.
          </p>
        )}
      </div>
    </SectionNotice>
  );
}
