import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrgId, getDemoUserId } from "@/lib/demo-helpers";
import { createHash, randomBytes } from "crypto";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);

    const keys = await db.apiKey.findMany({
      where: { orgId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      items: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        permissions: k.permissions,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("List API keys error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);
    const userId = await getDemoUserId();
    const body = await req.json();
    const { name, expiresAt, permissions } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // Generate an API key
    const rawKey = `mvlt_${randomBytes(24).toString("hex")}`;
    const keyHash = createHash("sha256").update(rawKey).digest("hex");
    const keyPrefix = rawKey.slice(0, 12);

    const key = await db.apiKey.create({
      data: {
        orgId,
        name,
        keyHash,
        keyPrefix,
        permissions: permissions ? JSON.stringify(permissions) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    const user = await db.user.findUnique({ where: { id: userId } });
    await db.auditLog.create({
      data: {
        orgId,
        userId,
        actor: user?.email ?? "unknown",
        action: "api_key.create",
        resourceType: "api_key",
        resourceId: key.id,
        outcome: "success",
        metadata: JSON.stringify({ keyId: key.id, keyName: name }),
      },
    });

    return NextResponse.json(
      {
        id: key.id,
        name: key.name,
        key: rawKey,
        keyPrefix: key.keyPrefix,
        permissions: key.permissions,
        expiresAt: key.expiresAt?.toISOString() ?? null,
        createdAt: key.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create API key error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}