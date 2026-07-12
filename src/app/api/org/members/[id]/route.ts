import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUserId, getOrgId } from "@/lib/demo-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getDemoUserId();
    const orgId = await getOrgId(req);
    const body = await req.json();
    const { role } = body;

    if (!role) {
      return NextResponse.json(
        { error: "Role is required" },
        { status: 400 }
      );
    }

    const member = await db.orgMember.findUnique({
      where: { id, orgId },
      include: { user: true },
    });

    if (!member) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    const updated = await db.orgMember.update({
      where: { id },
      data: { role },
    });

    await db.auditLog.create({
      data: {
        orgId,
        userId,
        actor: "system",
        action: "member.update_role",
        resourceType: "member",
        resourceId: id,
        outcome: "success",
        metadata: JSON.stringify({
          memberId: id,
          targetUserId: member.userId,
          oldRole: member.role,
          newRole: role,
        }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      orgId: updated.orgId,
      userId: updated.userId,
      role: updated.role,
    });
  } catch (error) {
    console.error("Update member role error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getDemoUserId();
    const orgId = await getOrgId(req);

    const member = await db.orgMember.findUnique({
      where: { id, orgId },
      include: { user: true },
    });

    if (!member) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    await db.orgMember.delete({ where: { id } });

    await db.auditLog.create({
      data: {
        orgId,
        userId,
        actor: "system",
        action: "member.remove",
        resourceType: "member",
        resourceId: id,
        outcome: "success",
        metadata: JSON.stringify({
          memberId: id,
          removedUserId: member.userId,
          removedUserEmail: member.user.email,
        }),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}