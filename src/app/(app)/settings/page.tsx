import type { Metadata } from "next";
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
    />
  );
}
