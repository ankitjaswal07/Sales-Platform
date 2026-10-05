import {
  LayoutDashboard,
  Radar,
  Users,
  Building2,
  KanbanSquare,
  MessagesSquare,
  FileText,
  Send,
  CheckSquare,
  FolderKanban,
  BarChart3,
  Sparkles,
  Settings,
  type LucideIcon,
} from "lucide-react";

/**
 * The thirteen primary destinations (§48).
 *
 * `status` is deliberately part of the navigation model: an item that has not
 * been built yet still resolves to a real route that explains what the screen
 * will do and what it needs, rather than a dead link.
 */
export type NavStatus = "live" | "in_build";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  status: NavStatus;
  /** Short description used by the in-build notice. */
  description: string;
  /** What already works behind this screen, if anything. */
  backend?: string;
}

export const PRIMARY_NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Command",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        status: "live",
        description: "Today's numbers, what needs attention and the best opportunities to work right now.",
      },
      {
        href: "/lead-finder",
        label: "Lead Finder",
        icon: Radar,
        status: "in_build",
        description:
          "Natural-language and structured discovery: choose country, city, industry, size, rating and website status, then watch discovery, auditing and scoring run with live progress.",
        backend:
          "The discovery service, its legality guardrails, the sample dataset and the audit queue are all implemented and covered by tests.",
      },
      {
        href: "/assistant",
        label: "AI Assistant",
        icon: Sparkles,
        status: "in_build",
        description:
          'The global assistant: ask "what should I say to this prospect?" and get a grounded, evidence-backed next message, plus the command centre for searching and acting by voice of text.',
        backend: "Command parsing, lead advice and the next-message engine are implemented; the chat surface is next.",
      },
    ],
  },
  {
    section: "Pipeline",
    items: [
      {
        href: "/leads",
        label: "Leads",
        icon: Users,
        status: "live",
        description: "Every qualified prospect with its score, temperature, website opportunity and next action.",
      },
      {
        href: "/businesses",
        label: "Businesses",
        icon: Building2,
        status: "in_build",
        description: "The full business profile: location, contacts, opening hours, review history, website history and audit results.",
        backend: "Business, contact and website repositories are implemented, including dedupe and validation.",
      },
      {
        href: "/pipeline",
        label: "Pipeline",
        icon: KanbanSquare,
        status: "in_build",
        description: "Drag-and-drop Kanban across your customisable stages, with weighted forecasting and stalled-deal warnings.",
        backend: "The pipeline board, stage transitions, probability weights and stall detection all run in the service layer.",
      },
      {
        href: "/conversations",
        label: "Conversations",
        icon: MessagesSquare,
        status: "in_build",
        description:
          "The AI sales agent's inbox: intent score per thread, escalation alerts, and one-click human takeover that pauses the AI mid-conversation.",
        backend: "Chat, intent detection, escalation rules, takeover and hand-back are implemented and tested.",
      },
      {
        href: "/proposals",
        label: "Proposals",
        icon: FileText,
        status: "in_build",
        description:
          "Generate a proposal from an audit, approve it, share a tracked web link, and watch opens, time spent and CTA clicks arrive.",
        backend: "Proposal generation, approval gating, sending, and view/engagement tracking are all implemented.",
      },
    ],
  },
  {
    section: "Growth",
    items: [
      {
        href: "/campaigns",
        label: "Campaigns",
        icon: Send,
        status: "in_build",
        description: "Multi-step outreach sequences with daily caps, quiet hours, opt-out handling and per-campaign analytics.",
        backend: "Campaigns, recipients, sequencing, spam safeguards and reply tracking run in the service layer.",
      },
      {
        href: "/tasks",
        label: "Tasks",
        icon: CheckSquare,
        status: "in_build",
        description: "Follow-ups, call-backs and internal work, generated automatically from conversations and pipeline rules.",
        backend: "Tasks, follow-up scheduling and overdue detection are implemented.",
      },
      {
        href: "/projects",
        label: "Projects",
        icon: FolderKanban,
        status: "in_build",
        description: "What happens after a win: conversion to a project with phases, owners, deliverables and client sign-off.",
        backend: "Project conversion, phases and progress tracking are implemented.",
      },
      {
        href: "/analytics",
        label: "Analytics",
        icon: BarChart3,
        status: "in_build",
        description: "Funnel, source, industry and agent performance, plus the website opportunity map across your market.",
        backend: "The analytics engine computes every metric from real records — nothing is mocked.",
      },
    ],
  },
  {
    section: "Workspace",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        status: "in_build",
        description:
          "Agency profile, brand, team and roles, pipeline stages, service catalogue, alert rules, retention and integrations.",
        backend: "Settings, roles, stages, catalogue, alert rules and integration state are all stored and honoured today.",
      },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = PRIMARY_NAV.flatMap((group) => group.items);

export function navItemFor(pathname: string): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => item.href === pathname || pathname.startsWith(`${item.href}/`));
}
