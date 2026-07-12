import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrgId } from "@/lib/demo-helpers";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);

    const org = await db.organization.findUnique({
      where: { id: orgId },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const memberCount = await db.orgMember.count({
      where: { orgId },
    });

    const modelCount = await db.model.count({
      where: { orgId, deletedAt: null },
    });

    return NextResponse.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
      stats: {
        memberCount,
        modelCount,
      },
    });
  } catch (error) {
    console.error("Get org error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}