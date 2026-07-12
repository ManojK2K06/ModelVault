import { db } from "@/lib/db";
import { createHash } from "crypto";

export interface AuthContext {
  userId: string;
  orgId: string;
  role: string;
  method: "session" | "api-key" | "local";
}

/**
 * Extract authentication context from a request.
 *
 * Priority:
 * 1. Authorization: Bearer <token> — session token (format: "local-token-{userId}")
 * 2. x-api-key header — API key authentication
 * 3. Fallback to local mode (first user / first org)
 */
export async function extractAuthContext(req: Request): Promise<AuthContext> {
  const authHeader = req.headers.get("authorization");
  const apiKeyHeader = req.headers.get("x-api-key");

  // ── 1. Session token ──────────────────────────────────────────────
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();

    const sessionMatch = token.match(/^local-token-([a-zA-Z0-9]+)/);
    if (sessionMatch) {
      const userIdPrefix = sessionMatch[1];
      const user = await db.user.findFirst({
        where: { id: { startsWith: userIdPrefix } },
      });

      if (user) {
        const membership = await db.orgMember.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
        });

        if (membership) {
          return {
            userId: user.id,
            orgId: membership.orgId,
            role: membership.role,
            method: "session",
          };
        }
      }
    }
  }

  // ── 2. API key ────────────────────────────────────────────────────
  if (apiKeyHeader) {
    const keyHash = createHash("sha256").update(apiKeyHeader).digest("hex");

    const apiKey = await db.apiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });

    if (apiKey) {
      // Update lastUsedAt asynchronously (fire-and-forget)
      db.apiKey
        .update({
          where: { id: apiKey.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {
          /* best-effort */
        });

      // Find the first active member for the org to determine role
      const anyMember = await db.orgMember.findFirst({
        where: { orgId: apiKey.orgId },
        orderBy: { createdAt: "asc" },
      });

      return {
        userId: anyMember?.userId ?? apiKey.orgId,
        orgId: apiKey.orgId,
        role: anyMember?.role ?? "viewer",
        method: "api-key",
      };
    }
  }

  // ── 3. Local fallback ─────────────────────────────────────────────
  return getLocalContext();
}

/**
 * Get local auth context (first user, first org).
 * Used as fallback when no authentication is provided.
 */
async function getLocalContext(): Promise<AuthContext> {
  const member = await db.orgMember.findFirst({
    orderBy: { createdAt: "asc" },
  });

  if (!member) {
    throw new Error(
      "No organization member found. Please run the seed script first."
    );
  }

  return {
    userId: member.userId,
    orgId: member.orgId,
    role: member.role,
    method: "local",
  };
}