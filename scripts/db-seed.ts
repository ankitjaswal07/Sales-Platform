/**
 * Seeds the demo workspace.
 *
 * Run with: npm run db:seed
 *
 * `--conditions=react-server` makes the `server-only` guard a no-op, which is
 * exactly what it is inside a server runtime. Everything the script writes is
 * labelled as demo data in the database.
 */
import { getDb } from "../src/lib/db/index.ts";
import { seedDemoData } from "../src/lib/db/seed.ts";

const force = process.argv.includes("--force");

try {
  getDb();
  const result = seedDemoData({ force });
  console.log("");
  console.log("  LeadForge demo workspace");
  console.log("  ─────────────────────────────────────────────");
  console.log(`  Organisation   ${result.orgId}`);
  console.log(`  Users          ${result.users}`);
  console.log(`  Businesses     ${result.businesses}`);
  console.log(`  Leads          ${result.leads}`);
  console.log(`  Audits         ${result.audits}  (modelled demo data — clearly labelled)`);
  console.log(`  Conversations  ${result.conversations}`);
  console.log(`  Proposals      ${result.proposals}`);
  console.log(`  Tasks          ${result.tasks}`);
  console.log(`  Projects       ${result.projects}`);
  console.log("");
  console.log(`  Sign in with   alex@northlight.studio / ${result.password}`);
  console.log("  Change the password, or set SEED_PASSWORD, before exposing this instance.");
  console.log("");
} catch (error) {
  console.error("Seeding failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
