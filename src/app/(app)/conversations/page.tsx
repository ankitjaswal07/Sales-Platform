import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { inbox } from "@/lib/services/conversation";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Conversations" };

export default async function ConversationsPage() {
  const session = await currentSession();
  if (!session) return null;
  const { items: threads, total } = inbox(session.organization.id, {});

  return (
    <SectionNotice
      href="/conversations"
      phase="Phase 3 — agent inbox"
      facts={[
        { label: "Conversations", value: String(total) },
        { label: "Awaiting a human", value: String(threads.filter((c) => c.status === "human_takeover" || c.status === "awaiting_contact").length) },
        { label: "AI handled", value: String(threads.filter((c) => c.status === "ai_active").length) },
      ]}
      todo={[
        "The thread view with intent score, sentiment and the signals that produced them.",
        "Take over / hand back controls, with the AI paused mid-conversation the moment a human steps in.",
        "The escalation queue for threads that crossed the intent threshold or asked to be left alone.",
      ]}
      notes={[
        "The AI identifies itself as AI in its opening message and never claims to be a person.",
        "Opt-out language is honoured across every channel and suppresses the whole business immediately.",
        "A human taking over pauses the AI rather than fighting it for the thread.",
      ]}
    />
  );
}
