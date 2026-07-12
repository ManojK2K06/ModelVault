import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrgId, getDemoUserId } from "@/lib/demo-helpers";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);

    const members = await db.orgMember.findMany({
      where: { orgId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            mfaEnabled: true,
            lastLoginAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      items: members.map((m) => ({
        id: m.id,
        orgId: m.orgId,
        userId: m.userId,
        role: m.role,
        acceptedAt: m.acceptedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        user: m.user,
      })),
    });
  } catch (error) {
    console.error("List members error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);
    const inviterId = await getDemoUserId();
    const body = await req.json();
    const { email, role } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    const existing = await db.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "User is already a member" },
        { status: 409 }
      );
    }

    const member = await db.orgMember.create({
      data: {
        orgId,
        userId: user.id,
        role: role ?? "viewer",
        invitedBy: inviterId,
        acceptedAt: new Date(),
      },
    });

    return NextResponse.json(
      {
        id: member.id,
        orgId: member.orgId,
        userId: member.userId,
        role: member.role,
        acceptedAt: member.acceptedAt?.toISOString() ?? null,
        createdAt: member.createdAt.toISOString(),
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Add member error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}