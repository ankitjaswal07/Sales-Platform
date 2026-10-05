import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { assistantOverview } from "@/lib/services/assistant";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "AI Assistant" };

export default async function AssistantPage() {
  const session = await currentSession();
  if (!session) return null;

  const overview = assistantOverview(session.organization.id);

  return (
    <SectionNotice
      href="/assistant"
      phase="Phase 4 — assistant surface"
      facts={[
        { label: "Capabilities", value: String(overview.capabilities.length) },
        { label: "Briefing sections", value: String(overview.sections.length) },
        { label: "Example commands", value: String(overview.capabilities.filter((c) => c.example).length) },
      ]}
      todo={[
        "The chat surface: ask in plain language and get a grounded answer that cites the records it used.",
        "The command centre with confirmation gates for anything destructive (deleting, bulk sending, exporting).",
        "Per-lead advice: \u201cwhat should I say to this prospect?\u201d rendered as a ready-to-send draft with its evidence.",
      ]}
      notes={[
        "AI never pretends to be human, never guarantees an outcome, and never invents a fact about a prospect.",
        "Every suggested message traces back to a stored audit finding or business record.",
        "Destructive commands require an explicit confirmation step before anything changes.",
      ]}
    />
  );
}
