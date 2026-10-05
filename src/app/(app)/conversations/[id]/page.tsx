import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { conversationSummaryFor } from "@/lib/services/conversation";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Conversation" };

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return null;
  const { id } = await params;
  const summary = conversationSummaryFor(session.organization.id, id);

  if (!summary) {
    return <SectionNotice href="/conversations" phase="Phase 3 — thread view" facts={[]} />;
  }

  return (
    <SectionNotice
      href="/conversations"
      phase="Phase 3 — thread view"
      facts={[
        { label: "Status", value: summary.conversation.status.replace(/_/g, " ") },
        { label: "Intent score", value: `${Math.round(summary.conversation.intentScore)}/100` },
        { label: "Messages", value: String(summary.messages.length) },
      ]}
      todo={[
        "Render this thread with the AI/agent/prospect roles clearly distinguished.",
        "The takeover control, plus the internal note the AI wrote for the agent.",
        "Inline next-message suggestions grounded in this conversation\u2019s own intent signals.",
      ]}
      notes={[
        `Channel: ${summary.conversation.channel.replace(/_/g, " ")}.`,
        "Internal notes are only ever shown to your team, never to the prospect.",
      ]}
    />
  );
}
