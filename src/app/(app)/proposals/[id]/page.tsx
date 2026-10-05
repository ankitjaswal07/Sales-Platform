import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { approvalChecks, proposalTimeline } from "@/lib/services/proposal";
import { getProposal } from "@/lib/db/repo/engagement";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Proposal" };

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return null;
  const { id } = await params;
  const proposal = getProposal(session.organization.id, id);
  if (!proposal) return <SectionNotice href="/proposals" phase="Phase 3 — proposal detail" facts={[]} />;

  const checks = approvalChecks(session.organization.id, proposal);
  const timeline = proposalTimeline(session.organization.id, proposal.id);

  return (
    <SectionNotice
      href="/proposals"
      phase="Phase 3 — proposal detail"
      facts={[
        { label: "Number", value: proposal.number },
        { label: "Status", value: proposal.status.replace(/_/g, " ") },
        { label: "Approval blockers", value: String(checks.blockers.length), hint: checks.allowed ? "Ready to approve" : "Resolve before sending" },
      ]}
      todo={[
        "The document view with its generated sections, scope, timeline and investment table.",
        "Approve / request changes controls, wired to the checks already enforced server-side.",
        "The engagement panel: who opened it, for how long, which sections they read and whether they clicked the CTA.",
      ]}
      notes={[
        ...checks.blockers.map((blocker) => `Blocker: ${blocker}`),
        ...checks.warnings.map((warning) => `Check: ${warning}`),
        ...(timeline.length ? [`${timeline.length} timeline events recorded so far.`] : []),
      ]}
    />
  );
}
