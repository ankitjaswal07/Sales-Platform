import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { getPrimaryOrganization } from "@/lib/db/repo/org";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Sparkles, ShieldCheck, LineChart } from "lucide-react";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const session = await currentSession();
  if (session) redirect("/dashboard");

  const organization = getPrimaryOrganization();
  const demoHint =
    process.env.NODE_ENV === "production" || !organization
      ? null
      : { email: "alex@northlight.studio", password: process.env.SEED_PASSWORD ?? "leadforge-demo" };

  return (
    <main className="relative grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Left: the pitch, kept factual — no invented numbers. */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-surface-sunken p-10 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-40 -top-40 size-[36rem] rounded-full bg-primary/15 blur-3xl animate-aurora"
        />
        <div className="relative flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          LeadForge
        </div>

        <div className="relative max-w-xl space-y-6">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight">
            Find businesses that need better websites — and know exactly what to say to them.
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Discovery, auditing, scoring, proposals and the sales conversation in one command centre. Every claim the
            platform makes about a business traces back to something it actually measured.
          </p>
          <ul className="space-y-3 text-sm">
            {[
              { icon: LineChart, text: "Website audits across nine dimensions, with explicit limits on what could not be measured" },
              { icon: ShieldCheck, text: "AI drafts, humans approve — nothing leaves the platform without a named approver" },
              { icon: Sparkles, text: "Built-in reasoning engine works with no API key; a model only ever changes the wording" },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-foreground">
                  <Icon className="size-3" />
                </span>
                <span className="text-muted-foreground">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-2xs text-subtle-foreground">
          Discovery uses legally available public business data only. No scraping behind logins, no CAPTCHA bypassing,
          no private information.
        </p>
      </section>

      {/* Right: the form. */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h2 className="text-xl font-semibold tracking-tight">Sign in</h2>
            <p className="text-xs text-muted-foreground">
              {organization ? `Workspace: ${organization.name}` : "No workspace has been seeded yet."}
            </p>
          </div>

          {organization ? (
            <SignInForm demoHint={demoHint} />
          ) : (
            <div className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-xs text-warning-soft-foreground">
              <p className="font-medium">This instance has no data yet.</p>
              <p className="mt-1">
                Run <code className="rounded bg-surface px-1 py-0.5 font-mono">npm run db:seed</code> to create the demo
                workspace, then reload this page.
              </p>
            </div>
          )}

          <p className="text-2xs text-subtle-foreground">
            Sessions are stored as hashed tokens in an httpOnly cookie. Sign-in attempts are rate limited.
          </p>
        </div>
      </section>
    </main>
  );
}
