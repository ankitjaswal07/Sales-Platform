import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { pipelineBoard } from "@/lib/services/pipeline";
import { listStages } from "@/lib/db/repo/org";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const session = await currentSession();
  if (!session) return null;
  const board = pipelineBoard(session.organization.id, { limitPerStage: 200 });
  const stages = listStages(session.organization.id);

  return (
    <SectionNotice
      href="/pipeline"
      phase="Phase 3 — Kanban board"
      facts={[
        { label: "Stages", value: String(stages.length) },
        { label: "Leads on the board", value: String(board.metrics.totalLeads) },
        { label: "Weighted forecast", value: board.metrics.weightedValue ? String(Math.round(board.metrics.weightedValue)) : "\u2014", hint: `Stalled: ${board.metrics.staleCount}` },
      ]}
      todo={[
        "Drag-and-drop across stages, with the same validation the service layer already enforces.",
        "Per-stage value totals, ageing indicators and stall warnings.",
        "Saved board views per user, plus bulk actions on a selection.",
      ]}
      notes={[
        "Stage moves are permission-checked and written to the activity timeline, so the audit trail survives a drag.",
        "Forecasts use each stage\u2019s probability, and the number is always labelled as a weighted estimate.",
      ]}
    />
  );
}
