import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { taskCounts } from "@/lib/db/repo/ops";
import { leadsNeedingFollowUp } from "@/lib/db/repo/lead";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage() {
  const session = await currentSession();
  if (!session) return null;
  const counts = taskCounts(session.organization.id);
  const followUps = leadsNeedingFollowUp(session.organization.id, 50);

  return (
    <SectionNotice
      href="/tasks"
      phase="Phase 3 — task board"
      facts={[
        { label: "Open", value: String(counts.open) },
        { label: "Due today", value: String(counts.today) },
        { label: "Overdue", value: String(counts.overdue), hint: `${followUps.length} leads need a follow-up` },
      ]}
      todo={[
        "Today / upcoming / overdue groupings with inline completion.",
        "Auto-generated follow-ups from conversations, proposals and stalled pipeline stages.",
        "Assignment and per-agent workload balancing.",
      ]}
      notes={[
        "Tasks are created automatically when a lead goes quiet, a proposal is opened or a conversation needs a human.",
        "Completing a task writes to the lead timeline so the history stays complete.",
      ]}
    />
  );
}
