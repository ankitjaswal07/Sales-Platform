import "server-only";

import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import {
  PermissionDeniedError,
  UnauthenticatedError,
  currentSession,
  ensureOrganization,
  requirePermission,
  requireSession,
  type SessionContext,
} from "../auth/session";
import type { Permission } from "../types";
import type { Organization, User } from "../db/repo/types";
import { logger } from "../logger";
import { checkRateLimit } from "../security/rate-limit";

/**
 * One place where every API route gets its security posture (§50).
 *
 * A route handler declares what it needs — a session, a permission, a schema —
 * and this wrapper supplies authentication, permission checks, request
 * validation, rate limiting and consistent error shapes. Nothing about that is
 * left to individual route authors, because that is how gaps appear.
 */

export interface ApiContext {
  /** Null only on routes that explicitly opt out of authentication. */
  session: SessionContext | null;
  organization: Organization;
  user: User | null;
  query: URLSearchParams;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, message, "bad_request", details);
export const notFound = (message = "Not found") => new ApiError(404, message, "not_found");
export const conflict = (message: string) => new ApiError(409, message, "conflict");

export function json<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as object, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.message, code: error.code, details: error.details }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return json(
      {
        error: "Some fields need attention.",
        code: "validation_error",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
      { status: 422 },
    );
  }
  if (error instanceof UnauthenticatedError) {
    return json({ error: "Sign in to continue.", code: "unauthenticated" }, { status: 401 });
  }
  if (error instanceof PermissionDeniedError) {
    return json({ error: error.message, code: "forbidden" }, { status: 403 });
  }
  const message = error instanceof Error ? error.message : "Unexpected server error.";
  logger.error("api", "Unhandled route error", { error: message });
  // Never leak stack traces or SQL to the client (§43).
  return json(
    { error: "Something went wrong on our side. The error has been logged.", code: "server_error" },
    { status: 500 },
  );
}

export interface RouteOptions<Body> {
  /** Requires a signed-in user. Defaults to true. */
  auth?: boolean;
  /** Permission required to touch this endpoint. */
  permission?: Permission;
  /** Zod schema the JSON body (or query, for GET) must satisfy. */
  schema?: ZodType<Body>;
  /** Requests allowed per window per user/IP. */
  rateLimit?: { limit: number; windowMs: number };
  /** Read the payload from the query string instead of the JSON body (GET routes). */
  source?: "body" | "query";
}

export interface Handler<Body> {
  (request: Request, payload: Body, context: ApiContext): Promise<Response> | Response;
}

type NextRouteContext = { params?: Promise<Record<string, string>> };

/**
 * Wraps a route handler with the platform's security floor.
 *
 * Returns a handler with the App Router signature, including the optional
 * dynamic-params argument that Next passes to nested routes.
 */
export function route<Body = undefined>(options: RouteOptions<Body>, handler: Handler<Body>) {
  return async function wrapped(request: Request, routeContext?: NextRouteContext) {
    try {
      const url = new URL(request.url);
      const rawPath = routeContext?.params ? await routeContext.params.catch(() => ({})) : {};
      const dynamic = Object.values(rawPath ?? {}).join("/");

      let session: SessionContext | null = null;
      if (options.auth !== false) {
        session = await requireSession();
        if (options.permission) requirePermission(session, options.permission);
      }

      if (options.rateLimit) {
        const identity = session?.user.id ?? request.headers.get("x-forwarded-for") ?? "anonymous";
        const verdict = checkRateLimit(`${url.pathname}:${identity}`, options.rateLimit.limit, options.rateLimit.windowMs);
        if (!verdict.allowed) {
          return json(
            { error: "Too many requests. Please slow down and try again shortly.", code: "rate_limited" },
            { status: 429, headers: { "retry-after": String(Math.ceil(verdict.retryAfterMs / 1000)) } },
          );
        }
      }

      let payload = undefined as Body;
      if (options.schema) {
        if ((options.source ?? (request.method === "GET" ? "query" : "body")) === "query") {
          const raw: Record<string, unknown> = {};
          url.searchParams.forEach((value, key) => {
            raw[key] = value;
          });
          payload = options.schema.parse(raw);
        } else {
          const text = await request.text();
          const parsed = text ? (JSON.parse(text) as unknown) : {};
          payload = options.schema.parse(parsed);
        }
      }

      const context: ApiContext = {
        session,
        user: session?.user ?? null,
        organization: session?.organization ?? ensureOrganization(),
        query: url.searchParams,
      };
      void dynamic;

      return await handler(request, payload, context);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return json({ error: "The request body was not valid JSON.", code: "bad_request" }, { status: 400 });
      }
      return errorResponse(error);
    }
  };
}

/** Resolves the dynamic segment values Next passes into a route handler. */
export async function paramsOf(routeContext?: NextRouteContext): Promise<Record<string, string>> {
  if (!routeContext?.params) return {};
  try {
    return await routeContext.params;
  } catch {
    return {};
  }
}

/** Reads a required dynamic parameter, failing loudly when it is missing. */
export async function requireParam(routeContext: NextRouteContext, key: string): Promise<string> {
  const params = await paramsOf(routeContext);
  const value = params[key];
  if (!value) throw badRequest(`The "${key}" parameter is required.`);
  return value;
}

/** Query helpers that coerce and clamp, so no route trusts raw input. */
export function intParam(query: URLSearchParams, key: string, fallback: number, min = 0, max = 500): number {
  const raw = query.get(key);
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function boolParam(query: URLSearchParams, key: string): boolean | undefined {
  const raw = query.get(key);
  if (raw === null || raw === "") return undefined;
  return raw === "true" || raw === "1";
}

export function listParam(query: URLSearchParams, key: string): string[] | undefined {
  const raw = query.get(key);
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}
