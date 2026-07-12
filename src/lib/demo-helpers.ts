import { db } from "@/lib/db";
import { extractAuthContext, type AuthContext } from "@/lib/auth-context";

/**
 * Get the local organization ID.
 * Returns the first organization's ID from the database.
 */
export async function getLocalOrgId(): Promise<string> {
  const org = await db.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!org) {
    throw new Error("No organization found. Please run the seed script first.");
  }
  return org.id;
}

/**
 * Get the first org ID or a specific one from query params.
 */
export async function getOrgId(req: Request): Promise<string> {
  const url = new URL(req.url);
  const queryOrgId = url.searchParams.get("orgId");
  if (queryOrgId) return queryOrgId;
  return getLocalOrgId();
}

/**
 * Get the local user ID (first user in first org).
 */
export async function getLocalUserId(): Promise<string> {
  const member = await db.orgMember.findFirst({
    orderBy: { createdAt: "asc" },
    select: { userId: true },
  });
  if (!member) {
    throw new Error("No org member found. Please run the seed script first.");
  }
  return member.userId;
}

/** @deprecated Use getLocalUserId() instead */
export const getDemoUserId = getLocalUserId;

/** @deprecated Use getLocalOrgId() instead */
export const getDemoOrgId = getLocalOrgId;

/**
 * Get authentication context from a request.
 *
 * Checks (in order):
 * 1. Authorization: Bearer <token> header (session token)
 * 2. x-api-key header (API key authentication)
 * 3. Falls back to local mode (first user / first org)
 *
 * @example
 * ```ts
 * const { userId, orgId, role, method } = await getAuthContext(req);
 * ```
 */
export async function getAuthContext(req: Request): Promise<AuthContext> {
  return extractAuthContext(req);
}