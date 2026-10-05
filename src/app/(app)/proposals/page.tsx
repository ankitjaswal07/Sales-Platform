import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { listProposals } from "@/lib/db/repo/engagement";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Proposals" };

export default async function ProposalsPage() {
  const session = await currentSession();
  if (!session) return null;
  const { items, total } = listProposals(session.organization.id, { limit: 200 });

  return (
    <SectionNotice
      href="/proposals"
      phase="Phase 3 — proposal workspace"
      facts={[
        { label: "Proposals", value: String(total) },
        { label: "Awaiting approval", value: String(items.filter((p) => p.status === "pending_approval").length) },
        { label: "Opened by prospects", value: String(items.filter((p) => p.viewedAt).length) },
      ]}
      todo={[
        "The proposal editor with the four templates, live preview and PDF export.",
        "The approval gate UI, showing exactly which checks pass before a proposal can be sent.",
        "The share link with view tracking: opens, time spent, sections read and CTA clicks.",
      ]}
      notes={[
        "Prices are always presented as an estimate with their derivation, never as a guaranteed quote.",
        "Nothing can be sent externally until a human with approval rights signs off that version.",
        "Before/after comparisons use the prospect\u2019s own public site and only ever illustrate, respecting third-party rights.",
      ]}
    />
  );
}
