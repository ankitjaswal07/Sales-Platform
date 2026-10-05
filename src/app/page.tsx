import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";

/**
 * The root path is a router, not a page: signed-in users land on the command
 * centre, everyone else on sign-in. The marketing landing page lives at
 * `/welcome` while it is being built (§Phase 5).
 */
export default async function RootPage() {
  const session = await currentSession();
  redirect(session ? "/dashboard" : "/login");
}
