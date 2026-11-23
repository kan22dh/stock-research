// Access control for the whole app (added 2026-11-23).
//
// Until then production was fully public: anyone could read /positions, call
// the server actions (create/close positions, AI analysis) and trigger the
// 300-second sync/cron routes — and the repo is public, so the routes are
// discoverable. Two ways in, both checked here:
//
//   1. Browser: HTTP Basic auth (BASIC_AUTH_USER / BASIC_AUTH_PASSWORD).
//      The browser re-sends it on same-origin fetches and server actions.
//   2. Machines: `Authorization: Bearer <CRON_SECRET>`. Vercel Cron sends this
//      automatically once CRON_SECRET is set; the GitHub watchdog sends it
//      from a repo secret.
//
// src/proxy.ts runs this for every request. Route handlers and server actions
// check again (requireAuth / assertAuthorized) so a proxy bypass alone is not
// enough to reach the data.
//
// Fail-closed: in production, missing env vars mean nobody gets in. In
// `next dev` with nothing configured, everything is allowed.
import { createHash } from "node:crypto";
import { headers } from "next/headers";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Trim: values pasted into the Vercel dashboard often carry a trailing space/newline.
function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function configured(): boolean {
  return Boolean(
    env("CRON_SECRET") ||
      (env("BASIC_AUTH_USER") && env("BASIC_AUTH_PASSWORD")),
  );
}

export function isAuthorized(authorization: string | null): boolean {
  if (!configured()) return process.env.NODE_ENV === "development";
  if (!authorization) return false;

  const secret = env("CRON_SECRET");
  if (secret && authorization.startsWith("Bearer ")) {
    return safeEqual(authorization.slice(7).trim(), secret);
  }

  const user = env("BASIC_AUTH_USER");
  const pass = env("BASIC_AUTH_PASSWORD");
  if (user && pass && authorization.startsWith("Basic ")) {
    let decoded: string;
    try {
      decoded = atob(authorization.slice(6));
    } catch {
      return false;
    }
    return safeEqual(decoded, `${user}:${pass}`);
  }
  return false;
}

/** Route handlers: returns a 401 response to send, or null when allowed. */
export function requireAuth(req: Request): Response | null {
  if (isAuthorized(req.headers.get("authorization"))) return null;
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

/** Server actions: throws when the caller is not authorized. */
export async function assertAuthorized(): Promise<void> {
  const h = await headers();
  if (!isAuthorized(h.get("authorization"))) throw new Error("unauthorized");
}

/**
 * Public, value-free view of the auth config for /api/health: which variables
 * are present, plus a 6-hex fingerprint of CRON_SECRET (sha256 prefix) so a
 * mismatch with the local copy can be told apart from a missing variable.
 */
export function authConfigSummary() {
  const secret = env("CRON_SECRET");
  return {
    cronSecret: Boolean(secret),
    cronSecretFingerprint: secret
      ? createHash("sha256").update(secret).digest("hex").slice(0, 6)
      : null,
    basicAuth: Boolean(env("BASIC_AUTH_USER") && env("BASIC_AUTH_PASSWORD")),
  };
}
