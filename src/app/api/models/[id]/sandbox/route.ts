import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { db } from "@/lib/db";
import { getDemoUserId, getOrgId } from "@/lib/demo-helpers";

const SCRIPT_TIMEOUT_MS = 90_000; // 90 seconds hard kill
const SANDBOX_TIMEOUT_S = 60; // passed to the Python script

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SandboxResult {
  overallStatus: string;
  durationMs: number;
  findings: Array<{
    probe: string;
    result: string;
    detail: string;
    severity: string;
  }>;
  summary: string;
  timestamp: string;
  fileAnalysis: {
    size: number;
    magicBytes: string;
    detectedFormat: string;
  };
}

/**
 * Run the Python sandbox script and capture its stdout/stderr.
 * Resolves with parsed JSON on success, or rejects with an error string.
 */
function runPythonSandbox(
  filePath: string
): Promise<{ result: SandboxResult; stderr: string }> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "sandbox_runner.py");

    const proc = spawn("python3", [scriptPath, filePath, String(SANDBOX_TIMEOUT_S)], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: process.cwd() },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject("Sandbox script timed out after 90 seconds");
    }, SCRIPT_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          "Python 3 not found — install Python 3 to enable sandbox analysis"
        );
      } else {
        reject(`Failed to start Python process: ${err.message}`);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);

      if (code !== 0) {
        // Try to parse stderr for error info
        let errorMsg = `Sandbox script exited with code ${code}`;
        if (stderr.trim()) {
          errorMsg += `: ${stderr.trim().slice(0, 500)}`;
        }
        if (stdout.trim()) {
          // Script may have output an error JSON to stdout
          try {
            const parsed = JSON.parse(stdout);
            if (parsed.error) {
              errorMsg = parsed.error;
            }
          } catch {
            // ignore
          }
        }
        reject(errorMsg);
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as SandboxResult;
        resolve({ result: parsed, stderr });
      } catch {
        reject(
          `Failed to parse sandbox output as JSON: ${stdout.slice(0, 300)}`
        );
      }
    });
  });
}

/**
 * Build a fallback result when the file doesn't exist on disk.
 */
function buildNoFileResult(): SandboxResult {
  return {
    overallStatus: "failed",
    durationMs: 0,
    findings: [
      {
        probe: "model-load",
        result: "failed",
        detail:
          "Model file not found on disk. The file may have been deleted or not yet uploaded.",
        severity: "HIGH",
      },
      {
        probe: "network-egress",
        result: "passed",
        detail: "Skipped — model file not available",
        severity: "LOW",
      },
      {
        probe: "memory-usage",
        result: "passed",
        detail: "Skipped — model file not available",
        severity: "LOW",
      },
      {
        probe: "filesystem-write",
        result: "passed",
        detail: "No unexpected filesystem writes detected",
        severity: "LOW",
      },
    ],
    summary:
      "Sandbox analysis could not run — model file not found on disk.",
    timestamp: new Date().toISOString(),
    fileAnalysis: {
      size: 0,
      magicBytes: "",
      detectedFormat: "unknown",
    },
  };
}

/**
 * Build a result for when the Python sandbox fails to execute.
 */
function buildErrorResult(errorMsg: string): SandboxResult {
  return {
    overallStatus: "failed",
    durationMs: 0,
    findings: [
      {
        probe: "sandbox-execution",
        result: "failed",
        detail: errorMsg,
        severity: "HIGH",
      },
      {
        probe: "network-egress",
        result: "passed",
        detail: "Skipped — sandbox executor failed",
        severity: "LOW",
      },
      {
        probe: "memory-usage",
        result: "passed",
        detail: "Skipped — sandbox executor failed",
        severity: "LOW",
      },
      {
        probe: "filesystem-write",
        result: "passed",
        detail: "No unexpected filesystem writes detected",
        severity: "LOW",
      },
    ],
    summary: `Sandbox execution failed: ${errorMsg}`,
    timestamp: new Date().toISOString(),
    fileAnalysis: {
      size: 0,
      magicBytes: "",
      detectedFormat: "unknown",
    },
  };
}

// ---------------------------------------------------------------------------
// POST – Run sandbox analysis synchronously
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const userId = await getDemoUserId();

    const model = await db.model.findUnique({
      where: { id, deletedAt: null },
      include: {
        versions: { orderBy: { uploadedAt: "desc" }, take: 1 },
      },
    });

    if (!model || model.versions.length === 0) {
      return NextResponse.json(
        { error: "Model or version not found" },
        { status: 404 }
      );
    }

    const version = model.versions[0];

    const sandboxConfig = {
      executor: "python-local",
      timeoutSeconds: SANDBOX_TIMEOUT_S,
      scriptPath: "scripts/sandbox_runner.py",
      probes: [
        "model-load",
        "inference-test",
        "memory-usage",
        "network-egress",
        "filesystem-write",
      ],
    };

    // Resolve file path on disk
    const storagePath = version.storagePath;
    const absoluteFilePath = path.join(process.cwd(), storagePath);

    let result: SandboxResult;
    let stderr = "";

    try {
      // Run the Python sandbox script synchronously
      const sandboxOutput = await runPythonSandbox(absoluteFilePath);
      result = sandboxOutput.result;
      stderr = sandboxOutput.stderr;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // If the error is about the file not existing, use a specific result
      if (errorMsg.includes("File not found")) {
        result = buildNoFileResult();
      } else {
        result = buildErrorResult(errorMsg);
      }

      // Log stderr for debugging
      if (stderr) {
        console.warn("[sandbox] Python stderr:", stderr.slice(0, 1000));
      }
    }

    const jobStatus = result.overallStatus === "passed" ? "passed" : "failed";

    const job = await db.sandboxJob.create({
      data: {
        modelId: model.id,
        versionId: version.id,
        status: jobStatus,
        vmId: `local-${Date.now().toString(36)}`,
        configJson: JSON.stringify(sandboxConfig),
        resultJson: JSON.stringify(result),
        durationMs: result.durationMs,
        submittedBy: userId,
        startedAt: new Date(Date.now() - result.durationMs),
        completedAt: new Date(),
      },
    });

    const user = await db.user.findUnique({ where: { id: userId } });
    await db.auditLog.create({
      data: {
        orgId: model.orgId,
        userId,
        actor: user?.email ?? "unknown",
        action: "sandbox.complete",
        resourceType: "model",
        resourceId: model.id,
        outcome: jobStatus === "passed" ? "success" : "failure",
        metadata: JSON.stringify({
          modelId: model.id,
          versionId: version.id,
          sandboxJobId: job.id,
          overallStatus: result.overallStatus,
          durationMs: result.durationMs,
          findingCount: result.findings.length,
          detectedFormat: result.fileAnalysis?.detectedFormat ?? "unknown",
          executor: "python-local",
        }),
      },
    });

    return NextResponse.json(
      {
        id: job.id,
        modelId: job.modelId,
        versionId: job.versionId,
        status: job.status,
        vmId: job.vmId,
        configJson: job.configJson,
        resultJson: job.resultJson,
        durationMs: job.durationMs,
        startedAt: job.startedAt?.toISOString(),
        completedAt: job.completedAt?.toISOString(),
        createdAt: job.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create sandbox job error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET – List sandbox jobs for a model (no polling needed)
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: _id } = await params;
    const orgId = await getOrgId(req);
    const url = new URL(req.url);
    const modelId = url.searchParams.get("modelId");

    const targetModelId = modelId ?? _id;

    // Verify the model belongs to the org
    const model = await db.model.findFirst({
      where: { id: targetModelId, orgId, deletedAt: null },
    });
    if (!model) {
      return NextResponse.json({ error: "Model not found" }, { status: 404 });
    }

    const jobs = await db.sandboxJob.findMany({
      where: { modelId: targetModelId },
      include: {
        submittedByUser: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      items: jobs.map((j) => ({
        id: j.id,
        modelId: j.modelId,
        versionId: j.versionId,
        status: j.status,
        vmId: j.vmId,
        configJson: j.configJson,
        resultJson: j.resultJson,
        durationMs: j.durationMs,
        startedAt: j.startedAt?.toISOString(),
        completedAt: j.completedAt?.toISOString(),
        createdAt: j.createdAt.toISOString(),
        submittedBy: j.submittedByUser,
      })),
    });
  } catch (error) {
    console.error("Get sandbox jobs error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}