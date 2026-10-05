import type { Metadata } from "next";
import { currentSession } from "@/lib/auth/session";
import { countBusinesses, findDuplicateBusinesses, findDuplicateContacts } from "@/lib/db/repo/business";
import { SectionNotice } from "@/components/shell/section-notice";

export const metadata: Metadata = { title: "Businesses" };

export default async function BusinessesPage() {
  const session = await currentSession();
  if (!session) return null;
  const duplicateBusinesses = findDuplicateBusinesses(session.organization.id);
  const duplicateContacts = findDuplicateContacts(session.organization.id);

  return (
    <SectionNotice
      href="/businesses"
      phase="Phase 2 — business profiles"
      facts={[
        { label: "Businesses", value: String(countBusinesses(session.organization.id)) },
        { label: "Duplicate groups", value: String(duplicateBusinesses.length) },
        { label: "Contact duplicates", value: String(duplicateContacts.length) },
      ]}
      todo={[
        "The business directory with location, industry, size and website-status filters.",
        "The full profile: contacts, opening hours, review history, website history and every audit on record.",
        "The dedupe and merge workflow for records that arrived from two different sources.",
      ]}
      notes={[
        "Public business contact details only \u2014 role addresses are labelled as such and personal data is never harvested.",
        "Every field shows where it came from and when it was last confirmed.",
      ]}
    />
  );
}
