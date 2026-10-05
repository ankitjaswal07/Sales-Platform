import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/db/repo/ops";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const session = await currentSession();
  if (!session) return null;
  const { items, total } = listProjects(session.organization.id, { limit: 100 });

  return (
    <SectionNotice
      href="/projects"
      phase="Phase 5 — delivery"
      facts={[
        { label: "Projects", value: String(total) },
        { label: "In progress", value: String(items.filter((p) => !["completed", "on_hold"].includes(p.status)).length) },
        { label: "Completed", value: String(items.filter((p) => p.status === "completed").length) },
      ]}
      todo={[
        "The project workspace: phases, deliverables, owners and client sign-off.",
        "Conversion flow for a won lead, carrying the approved proposal scope across.",
        "Retainer and maintenance tracking for completed builds.",
      ]}
      notes={[
        "Winning a lead converts it into a project with its scope and price already attached.",
        "Nothing is created in the delivery side until the proposal was approved by a human.",
      ]}
    />
  );
}
