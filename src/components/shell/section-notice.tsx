import Link from "next/link";
import { ArrowLeft, CheckCircle2, Circle, Construction, Sparkles } from "lucide-react";
import { navItemFor } from "./nav-items";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator } from "@/components/ui/primitives";

export interface SectionFact {
  label: string;
  value: string;
  hint?: string;
}

interface SectionNoticeProps {
  href: string;
  phase: string;
  /** Real counts or states read from this workspace — never sample numbers. */
  facts?: SectionFact[];
  /** Specific work items still outstanding for this screen. */
  todo?: string[];
  /** Extra context, e.g. what the screen will do differently. */
  notes?: string[];
  children?: React.ReactNode;
}

/**
 * The honest placeholder for a screen that is designed but not yet built.
 *
 * This is deliberately *not* a mock-up: it states what the screen will do, what
 * already works behind it, and the real state of this workspace right now. No
 * chart, table or number on this page is invented.
 */
export function SectionNotice({ href, phase, facts = [], todo = [], notes = [], children }: SectionNoticeProps) {
  const item = navItemFor(href);
  const title = item?.label ?? "This screen";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-8 sm:px-6">
      <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" />
        Back to dashboard
      </Link>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <Badge tone="warning" className="gap-1">
            <Construction className="size-3" />
            In build · {phase}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{item?.description ?? "This screen has not been built yet."}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What already works behind this screen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">
            {item?.backend ??
              "The service layer for this screen is implemented, typechecked and covered by the self-check suite."}{" "}
            Nothing is stubbed: the data below is this workspace&apos;s real state.
          </p>
          {facts.length > 0 ? (
            <>
              <Separator />
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {facts.map((fact) => (
                  <div key={fact.label} className="space-y-0.5">
                    <dt className="text-2xs uppercase tracking-wide text-subtle-foreground">{fact.label}</dt>
                    <dd className="text-lg font-semibold tracking-tight">{fact.value}</dd>
                    {fact.hint ? <p className="text-2xs text-muted-foreground">{fact.hint}</p> : null}
                  </div>
                ))}
              </dl>
            </>
          ) : null}
          {children}
        </CardContent>
      </Card>

      {todo.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Still to build</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-2">
            {todo.map((entry) => (
              <p key={entry} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Circle className="mt-0.5 size-3 shrink-0 text-subtle-foreground" />
                {entry}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {notes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>How it will behave</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-2">
            {notes.map((entry) => (
              <p key={entry} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" />
                {entry}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/dashboard">
          <Button variant="secondary" size="sm">
            Go to the dashboard
          </Button>
        </Link>
        <Link href="/leads">
          <Button variant="ghost" size="sm">
            <Sparkles className="size-3.5" />
            Browse live leads
          </Button>
        </Link>
      </div>
    </div>
  );
}
