import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrgId } from "@/lib/demo-helpers";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);
    const url = new URL(req.url);
    const search = url.searchParams.get("search") ?? "";
    const action = url.searchParams.get("action");
    const resourceType = url.searchParams.get("resourceType");
    const outcome = url.searchParams.get("outcome");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const cursor = url.searchParams.get("cursor");
    const limit = parseInt(url.searchParams.get("limit") ?? "20", 10);

    const where: Prisma.AuditLogWhereInput = { orgId };

    if (search) {
      where.OR = [
        { actor: { contains: search } },
        { action: { contains: search } },
        { metadata: { contains: search } },
      ];
    }
    if (action) {
      where.action = action;
    }
    if (resourceType) {
      where.resourceType = resourceType;
    }
    if (outcome) {
      where.outcome = outcome;
    }
    if (startDate) {
      where.timestamp = { ...(where.timestamp as Prisma.DateTimeNullableFilter), gte: new Date(startDate) };
    }
    if (endDate) {
      where.timestamp = { ...(where.timestamp as Prisma.DateTimeNullableFilter), lte: new Date(endDate) };
    }

    const logs = await db.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { timestamp: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: Number(cursor) }, skip: 1 } : {}),
    });

    const hasMore = logs.length > limit;
    const items = hasMore ? logs.slice(0, limit) : logs;
    const nextCursor = hasMore ? String(items[items.length - 1].id) : null;

    return NextResponse.json({
      items: items.map((log) => ({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        actor: log.actor,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        outcome: log.outcome,
        sourceIp: log.sourceIp,
        metadata: log.metadata,
        user: log.user ?? null,
      })),
      nextCursor,
      hasMore,
    });
  } catch (error) {
    console.error("List audit logs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}