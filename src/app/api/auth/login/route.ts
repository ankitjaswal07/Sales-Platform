import { z } from "zod";
import { startSession } from "@/lib/auth/session";
import { getPrimaryOrganization, verifyUserCredentials } from "@/lib/db/repo/org";
import { route, json, ApiError } from "@/lib/api/http";
import { RATE_LIMITS } from "@/lib/security/rate-limit";

const schema = z.object({
  email: z.string().trim().min(3).max(200),
  password: z.string().min(1).max(200),
});

export const POST = route(
  { auth: false, schema, rateLimit: RATE_LIMITS.auth },
  async (_request, body) => {
    const organization = getPrimaryOrganization();
    if (!organization) {
      throw new ApiError(
        503,
        "This workspace has no organisation yet. Run `npm run db:seed` to create the demo workspace.",
        "not_initialised",
      );
    }

    const result = verifyUserCredentials(organization.id, body.email, body.password);
    if ("error" in result) {
      // Deliberately the same message for unknown emails and wrong passwords:
      // the endpoint must not reveal which accounts exist.
      if (result.error === "suspended") {
        throw new ApiError(403, "That account is suspended. Ask an owner to re-enable it.", "suspended");
      }
      throw new ApiError(401, "Those credentials did not match an active account.", "invalid_credentials");
    }

    await startSession(result.user.id);
    return json({ ok: true, user: { id: result.user.id, name: result.user.name, role: result.user.role } });
  },
);
