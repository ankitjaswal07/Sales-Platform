import { NextResponse } from "next/server";
import { route, errorResponse, ApiError } from "@/lib/api/http";
import { findUserByEmail, getPrimaryOrganization } from "@/lib/db/repo/org";
import { startSession, requestMeta, auditAction } from "@/lib/auth/session";
import { verifyLaunchToken, logConnectorAttempt, connectorState } from "@/lib/api/connector";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { hashPii } from "@/lib/ids";
import { writeAuditLog } from "@/lib/db/repo/ops";

/**
 * Signed sign-in from the WordPress connector.
 *
 * A GET so the connector can render a plain link ("Open LeadForge"), and a POST
 * so other systems can use it as an API. Both are single-use and short-lived:
 * see `src/lib/api/connector.ts` for the scheme and its four acceptance rules.
 *
 * The account must already exist in this workspace — the connector can sign a
 * user in, but it can never create one, so a leaked secret cannot mint access.
 */
async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const query = url.searchParams;

  let body: Record<string, unknown> = {};
  if (request.method !== "GET") {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new ApiError(400, "The request body was not valid JSON.", "bad_request");
      }
    }
  }

  const pick = (key: string): string | null => {
    const value = (body[key] ?? query.get(key)) as unknown;
    return typeof value === "string" && value.length ? value : null;
  };

  const organization = getPrimaryOrganization();
  if (!organization) {
    throw new ApiError(503, "This workspace has not been initialised. Run `npm run db:seed` first.", "not_initialised");
  }

  const email = pick("email");
  const wantsRedirect = request.method === "GET" && query.get("redirect") !== "0";

  const state = connectorState();
  if (!state.configured) {
    throw new ApiError(503, state.reason ?? "Signed WordPress sign-in is not configured.", "connector_not_configured");
  }

  const verdict = verifyLaunchToken({
    action: "sso",
    orgId: organization.id,
    email: email ?? "",
    ts: pick("ts"),
    nonce: pick("nonce"),
    signature: pick("sig") ?? pick("signature"),
    source: pick("source") ?? "wordpress",
  });

  if (!verdict.ok) {
    logConnectorAttempt({ orgId: organization.id, action: "sso", email, ok: false, reason: verdict.reason });
    const status = verdict.reason === "not_configured" ? 503 : verdict.reason === "expired" || verdict.reason === "replayed" ? 410 : 401;
    throw new ApiError(status, verdict.message ?? "The launch link was rejected.", verdict.reason ?? "rejected");
  }

  const user = findUserByEmail(organization.id, email as string);
  if (!user) {
    logConnectorAttempt({ orgId: organization.id, action: "sso", email, ok: false, reason: "unknown_user" });
    throw new ApiError(
      404,
      `No LeadForge account exists for ${email}. An administrator must invite that address first — the connector cannot create accounts.`,
      "unknown_user",
    );
  }
  if (user.status !== "active") {
    logConnectorAttempt({ orgId: organization.id, action: "sso", email, ok: false, reason: "suspended" });
    throw new ApiError(403, "That account is suspended.", "suspended");
  }

  await startSession(user.id);

  const meta = await requestMeta();
  logConnectorAttempt({ orgId: organization.id, action: "sso", email: user.email, ok: true });
  // The audit trail must show that this session came from outside the app.
  writeAuditLog(organization.id, {
    actorUserId: user.id,
    actorType: "user",
    action: "auth.sso_login",
    entityType: "user",
    entityId: user.id,
    ipHash: hashPii(meta.ip),
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    meta: { source: pick("source") ?? "wordpress", linkedFrom: url.origin },
  });

  if (wantsRedirect) {
    // Two things matter here. First, the base: behind a proxy the request URL
    // carries the internal address (0.0.0.0:3000), so APP_URL wins when set.
    // Second, the path: only a relative path is allowed, otherwise `next` would
    // be an open redirect.
    const configured = process.env.APP_URL?.trim();
    const base = configured && /^https?:\/\//.test(configured) ? configured.replace(/\/$/, "") : url.origin;

    const requested = url.searchParams.get("next") ?? "/dashboard";
    const safePath = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";

    return NextResponse.redirect(new URL(safePath, base));
  }
  return NextResponse.json(
    { ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } },
    { headers: { "cache-control": "no-store" } },
  );
}

export const GET = async (request: Request) => {
  try {
    return await handle(request);
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST = route({ auth: false, rateLimit: RATE_LIMITS.auth }, async (request) => handle(request));
void auditAction;
