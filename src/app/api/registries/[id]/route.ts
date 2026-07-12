import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDemoUserId, getOrgId } from "@/lib/demo-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const registry = await db.registry.findUnique({
      where: { id },
      include: {
        artifacts: {
          include: {
            model: {
              select: { id: true, name: true, format: true, status: true },
            },
          },
          orderBy: { publishedAt: "desc" },
        },
      },
    });

    if (!registry) {
      return NextResponse.json(
        { error: "Registry not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: registry.id,
      name: registry.name,
      description: registry.description,
      policyRego: registry.policyRego,
      artifactCount: registry.artifactCount,
      lastPublishAt: registry.lastPublishAt?.toISOString() ?? null,
      createdAt: registry.createdAt.toISOString(),
      updatedAt: registry.updatedAt.toISOString(),
      artifacts: registry.artifacts.map((a) => ({
        id: a.id,
        modelId: a.modelId,
        versionId: a.versionId,
        publishedAt: a.publishedAt.toISOString(),
        gateResult: a.gateResult,
        gateReasons: a.gateReasons,
        model: a.model,
      })),
    });
  } catch (error) {
    console.error("Get registry error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getDemoUserId();
    const orgId = await getOrgId(req);
    const body = await req.json();
    const { policyRego } = body;

    if (!policyRego) {
      return NextResponse.json(
        { error: "policyRego is required" },
        { status: 400 }
      );
    }

    const registry = await db.registry.findUnique({ where: { id, orgId } });
    if (!registry) {
      return NextResponse.json(
        { error: "Registry not found" },
        { status: 404 }
      );
    }

    const updated = await db.registry.update({
      where: { id },
      data: { policyRego },
    });

    const user = await db.user.findUnique({ where: { id: userId } });
    await db.auditLog.create({
      data: {
        orgId,
        userId,
        actor: user?.email ?? "unknown",
        action: "registry.update_policy",
        resourceType: "registry",
        resourceId: id,
        outcome: "success",
        metadata: JSON.stringify({ registryId: id, policyLength: policyRego.length }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      description: updated.description,
      policyRego: updated.policyRego,
      artifactCount: updated.artifactCount,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Update registry error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: registryId } = await params;
    const userId = await getDemoUserId();
    const orgId = await getOrgId(req);
    const body = await req.json();
    const { modelId, versionId } = body;

    if (!modelId || !versionId) {
      return NextResponse.json(
        { error: "modelId and versionId are required" },
        { status: 400 }
      );
    }

    const registry = await db.registry.findUnique({
      where: { id: registryId, orgId },
    });
    if (!registry) {
      return NextResponse.json(
        { error: "Registry not found" },
        { status: 404 }
      );
    }

    const model = await db.model.findUnique({
      where: { id: modelId, orgId, deletedAt: null },
    });
    if (!model) {
      return NextResponse.json(
        { error: "Model not found" },
        { status: 404 }
      );
    }

    // Evaluate policy gate based on model status
    const gateResult = model.status === "signed" ? "ALLOWED" : "DENIED";
    const gateReasons =
      gateResult === "ALLOWED"
        ? "Model passed all policy checks."
        : "Model must be signed before publishing to this registry.";

    const artifact = await db.registryArtifact.create({
      data: {
        registryId,
        modelId,
        versionId,
        publishedBy: userId,
        gateResult,
        gateReasons,
      },
    });

    await db.registry.update({
      where: { id: registryId },
      data: {
        artifactCount: { increment: 1 },
        lastPublishAt: new Date(),
      },
    });

    const user = await db.user.findUnique({ where: { id: userId } });
    await db.auditLog.create({
      data: {
        orgId,
        userId,
        actor: user?.email ?? "unknown",
        action: "registry.publish",
        resourceType: "registry",
        resourceId: registryId,
        outcome: gateResult === "ALLOWED" ? "success" : "failure",
        metadata: JSON.stringify({
          registryId,
          modelId,
          versionId,
          gateResult,
        }),
      },
    });

    return NextResponse.json(
      {
        id: artifact.id,
        registryId: artifact.registryId,
        modelId: artifact.modelId,
        versionId: artifact.versionId,
        publishedAt: artifact.publishedAt.toISOString(),
        gateResult: artifact.gateResult,
        gateReasons: artifact.gateReasons,
      },
      { status: gateResult === "ALLOWED" ? 201 : 200 }
    );
  } catch (error) {
    console.error("Publish to registry error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}