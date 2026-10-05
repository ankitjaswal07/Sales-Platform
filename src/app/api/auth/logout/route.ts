import { endSession } from "@/lib/auth/session";
import { route, json } from "@/lib/api/http";

export const POST = route({ auth: false }, async () => {
  await endSession();
  return json({ ok: true });
});
