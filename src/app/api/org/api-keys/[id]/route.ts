import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUserId, getOrgId } from "@/lib/demo-helpers";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getDemoUserId();
    const orgId = await getOrgId(req);

    const key = await db.apiKey.findUnique({
      where: { id, orgId, revokedAt: null },
    });

    if (!key) {
      return NextResponse.json(
        { error: "API key not found" },
        { status: 404 }
      );
    }

    await db.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    const user = await db.user.findUnique({ where: { id: userId } });
    await db.auditLog.create({
      data: {
        orgId,
        userId,
        actor: user?.email ?? "unknown",
        action: "api_key.revoke",
        resourceType: "api_key",
        resourceId: id,
        outcome: "success",
        metadata: JSON.stringify({ keyId: id, keyName: key.name }),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Revoke API key error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}