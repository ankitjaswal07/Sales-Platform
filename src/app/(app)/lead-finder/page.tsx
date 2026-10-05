import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { listDiscoveryRuns } from "@/lib/db/repo/ops";
import { countBusinesses } from "@/lib/db/repo/business";
import { sampleListings } from "@/lib/services/sample-data";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Lead Finder" };

export default async function LeadFinderPage() {
  const session = await currentSession();
  if (!session) return null;
  const orgId = session.organization.id;

  const runs = listDiscoveryRuns(orgId, 20);
  const businesses = countBusinesses(orgId);
  const sample = sampleListings({ limit: 500 }).length;

  return (
    <SectionNotice
      href="/lead-finder"
      phase="Phase 2 — discovery UI"
      facts={[
        { label: "Businesses stored", value: String(businesses) },
        { label: "Discovery runs", value: String(runs.length), hint: runs.length ? `Last: ${(runs[0]!.providers ?? []).join(", ") || "sample data"} (${runs[0]!.status})` : "None yet" },
        { label: "Sample records available", value: String(sample), hint: "Used when no data provider is connected" },
      ]}
      todo={[
        "The search composer: natural language plus structured filters (country, city, industry, size, website status, rating, reviews).",
        "The run panel: live progress per stage (searching, deduping, auditing, scoring) with a cancel control.",
        "The results grid: sortable, selectable, with one-click \u201cadd to pipeline\u201d.",
      ]}
      notes={[
        "Discovery only ever reads legally available public business data \u2014 no scraping behind logins, no CAPTCHA or rate-limit circumvention, no private information.",
        "With no provider key configured it uses a clearly-labelled sample dataset, and every record says so.",
        "Running a search audits and scores what it finds, so results arrive with a website opportunity score rather than a bare list.",
      ]}
    />
  );
}
