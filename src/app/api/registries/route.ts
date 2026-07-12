import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getOrgId } from "@/lib/demo-helpers";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);

    const registries = await db.registry.findMany({
      where: { orgId },
      include: {
        artifacts: {
          include: {
            model: {
              select: { id: true, name: true, format: true },
            },
          },
          orderBy: { publishedAt: "desc" },
          take: 10,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      items: registries.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        policyRego: r.policyRego,
        artifactCount: r.artifactCount,
        lastPublishAt: r.lastPublishAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        artifacts: r.artifacts.map((a) => ({
          id: a.id,
          modelId: a.modelId,
          versionId: a.versionId,
          publishedAt: a.publishedAt.toISOString(),
          gateResult: a.gateResult,
          gateReasons: a.gateReasons,
          model: a.model,
        })),
      })),
    });
  } catch (error) {
    console.error("List registries error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgId(req);
    const body = await req.json();
    const { name, description, policyRego } = body;

    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const registry = await db.registry.create({
      data: {
        orgId,
        name,
        description: description ?? null,
        policyRego: policyRego ?? `package modelvault.policy\n\ndefault allow = false\n\nallow {\n  input.model.status == "signed"\n}`,
      },
    });

    return NextResponse.json(
      {
        id: registry.id,
        name: registry.name,
        description: registry.description,
        policyRego: registry.policyRego,
        artifactCount: registry.artifactCount,
        createdAt: registry.createdAt.toISOString(),
        updatedAt: registry.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create registry error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}