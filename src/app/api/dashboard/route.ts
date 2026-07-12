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

    // Total models
    const totalModels = await db.model.count({
      where: { orgId, deletedAt: null },
    });

    // Scan pass rate: models where latest version has scanStatus "completed" and no CRITICAL/HIGH findings
    const allSboms = await db.sbom.findMany({
      where: {
        model: { orgId, deletedAt: null },
      },
    });
    const scannedModels = allSboms.length;
    const passedScans = allSboms.filter(
      (s) => s.criticalCount === 0 && s.highCount === 0
    ).length;
    const scanPassRate =
      scannedModels > 0 ? Math.round((passedScans / scannedModels) * 100) : 0;

    // Active alerts: CRITICAL + HIGH findings across all SBOMs
    const activeAlerts = allSboms.reduce(
      (sum, s) => sum + s.criticalCount + s.highCount,
      0
    );

    // Recent activity (last 20 audit logs)
    const recentActivity = await db.auditLog.findMany({
      where: { orgId },
      include: {
        user: {
          select: { id: true, email: true, name: true, avatarUrl: true },
        },
      },
      orderBy: { timestamp: "desc" },
      take: 20,
    });

    // Scan results over time (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentSboms = await db.sbom.findMany({
      where: {
        model: { orgId, deletedAt: null },
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "asc" },
    });

    // Group by date
    const scanResultsOverTime: Record<string, { date: string; passed: number; failed: number }> = {};
    for (const sbom of recentSboms) {
      const dateKey = sbom.createdAt.toISOString().split("T")[0];
      if (!scanResultsOverTime[dateKey]) {
        scanResultsOverTime[dateKey] = { date: dateKey, passed: 0, failed: 0 };
      }
      if (sbom.criticalCount === 0 && sbom.highCount === 0) {
        scanResultsOverTime[dateKey].passed++;
      } else {
        scanResultsOverTime[dateKey].failed++;
      }
    }

    // Vulnerability distribution
    const vulnerabilityDistribution = allSboms.reduce(
      (acc, s) => {
        acc.CRITICAL += s.criticalCount;
        acc.HIGH += s.highCount;
        acc.MEDIUM += s.mediumCount;
        acc.LOW += s.lowCount;
        return acc;
      },
      { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 }
    );
    // NONE = models with no vulnerabilities
    const modelsWithNoVulns = totalModels - allSboms.length;
    vulnerabilityDistribution.NONE = Math.max(0, modelsWithNoVulns);

    return NextResponse.json({
      totalModels,
      scanPassRate,
      activeAlerts,
      recentActivity: recentActivity.map((log) => ({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        actor: log.actor,
        action: log.action,
        resourceType: log.resourceType,
        resourceId: log.resourceId,
        outcome: log.outcome,
        user: log.user,
      })),
      scanResultsOverTime: Object.values(scanResultsOverTime),
      vulnerabilityDistribution,
    });
  } catch (error) {
    console.error("Dashboard error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}