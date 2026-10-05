"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, FileText, MessagesSquare, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";

interface OpportunityActionsProps {
  leadId: string;
  businessName: string;
  /** True when a proposal already exists, so we send the user to it instead of duplicating work. */
  hasProposal: boolean;
  proposalId?: string | null;
  hasConversation: boolean;
  conversationId?: string | null;
}

type Busy = "proposal" | "conversation" | "rescore" | null;

/**
 * The three actions the dashboard's "Today's Best Opportunities" widget promises:
 * view the lead, generate a proposal, or start the conversation. Each one calls
 * a real endpoint and reports exactly what happened.
 */
export function OpportunityActions({
  leadId,
  businessName,
  hasProposal,
  proposalId,
  hasConversation,
  conversationId,
}: OpportunityActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);

  async function post(kind: Exclude<Busy, null>, url: string) {
    setBusy(kind);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: kind === "conversation" ? JSON.stringify({ channel: "web_chat" }) : JSON.stringify({}),
      });
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        toast.error(typeof payload.error === "string" ? payload.error : "That action could not be completed.");
        return;
      }

      if (kind === "proposal") {
        toast.success(`Proposal ${String(payload.number ?? "")} drafted for ${businessName}`, {
          description: "Status: draft. Nothing has been sent — a proposal must be approved by a human first.",
          action: { label: "Review", onClick: () => router.push(`/proposals/${String(payload.proposalId)}`) },
        });
      } else if (kind === "conversation") {
        toast.success(payload.created ? "Conversation opened" : "Conversation already open", {
          description: "The AI agent introduces itself as AI in its first message.",
        });
        router.push(`/conversations/${String(payload.conversationId)}`);
      } else {
        toast.success(`Re-scored ${businessName}`, {
          description: `New lead score ${String(payload.total ?? "—")} · ${String(payload.temperature ?? "")}`,
        });
      }
      router.refresh();
    } catch {
      toast.error("The server could not be reached.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={() => router.push(`/leads/${leadId}`)}>
        View lead
        <ArrowRight className="size-3.5" />
      </Button>

      {hasProposal && proposalId ? (
        <Button variant="ghost" size="sm" onClick={() => router.push(`/proposals/${proposalId}`)}>
          <FileText className="size-3.5" />
          Open proposal
        </Button>
      ) : (
        <Button
          variant="primary"
          size="sm"
          loading={busy === "proposal"}
          disabled={busy !== null}
          onClick={() => post("proposal", `/api/leads/${leadId}/proposal`)}
        >
          <FileText className="size-3.5" />
          Generate proposal
        </Button>
      )}

      {hasConversation && conversationId ? (
        <Button variant="ghost" size="sm" onClick={() => router.push(`/conversations/${conversationId}`)}>
          <MessagesSquare className="size-3.5" />
          Open conversation
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          loading={busy === "conversation"}
          disabled={busy !== null}
          onClick={() => post("conversation", `/api/leads/${leadId}/conversation`)}
        >
          <MessagesSquare className="size-3.5" />
          Start conversation
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        title="Re-score this lead from its current data"
        aria-label={`Re-score ${businessName}`}
        loading={busy === "rescore"}
        disabled={busy !== null}
        onClick={() => post("rescore", `/api/leads/${leadId}/rescore`)}
      >
        {busy === "rescore" ? null : <RefreshCw className="size-3.5" />}
      </Button>
    </div>
  );
}

export function OpportunityLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-xs font-medium text-primary hover:underline">
      {children}
    </Link>
  );
}
