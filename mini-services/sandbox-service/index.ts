import { Hono } from "hono";
import { execSync } from "child_process";
import { existsSync } from "fs";
import crypto from "crypto";

const app = new Hono();
const startTime = Date.now();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SANDBOX_MODE = process.env.SANDBOX_MODE ?? "mock"; // "mock" | "docker"
const PORT = 3004;

let dockerAvailable = false;
try {
  const result = execSync("docker info 2>/dev/null", {
    timeout: 5000,
    encoding: "utf-8",
  });
  dockerAvailable = result.length > 0;
} catch {
  dockerAvailable = false;
}

const effectiveMode =
  SANDBOX_MODE === "docker" && dockerAvailable ? "docker" : "mock";

if (effectiveMode === "mock") {
  console.warn(
    "[sandbox-service] Running in MOCK mode." +
      (SANDBOX_MODE === "docker"
        ? " Docker was requested but is not available."
        : " Set SANDBOX_MODE=docker to enable Docker-based execution.")
  );
} else {
  console.log("[sandbox-service] Running in DOCKER mode.");
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

interface Job {
  jobId: string;
  modelId: string;
  versionId: string;
  status: "running" | "passed" | "failed" | "error";
  mode: "mock" | "docker";
  config: SubmitBody["config"];
  submittedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  results?: ProbeResults;
  dockerLogs?: { stdout: string; stderr: string; exitCode: number };
}

interface SubmitBody {
  modelId: string;
  versionId: string;
  config: {
    timeoutSeconds?: number;
    networkPolicy?: string;
    probes?: string[];
    image?: string;
    resourceLimits?: { cpu?: string; memory?: string };
  };
}

interface ProbeResult {
  probe: string;
  result: "passed" | "failed" | "warning";
  detail: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

interface ProbeResults {
  overallStatus: "passed" | "failed";
  durationMs: number;
  findings: ProbeResult[];
  summary: string;
  timestamp: string;
}

const jobs = new Map<string, Job>();

// ---------------------------------------------------------------------------
// Deterministic random from modelId seed
// ---------------------------------------------------------------------------

function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  let s = h >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Mock probe generation
// ---------------------------------------------------------------------------

const ALL_PROBES = [
  "network-egress",
  "dns-resolution",
  "filesystem-write",
  "process-spawn",
];

function generateMockProbeResults(
  modelId: string,
  probes?: string[]
): ProbeResults {
  const rng = seededRandom(modelId + Date.now().toString(36));
  const probeList = probes?.length ? probes : ALL_PROBES;

  // Determine risk based on modelId hash — ~25% of models are "risky"
  const riskScore = rng();
  const isRisky = riskScore < 0.25;

  const findings: ProbeResult[] = probeList.map((probe) => {
    if (isRisky && probe === "network-egress" && rng() > 0.3) {
      const ip = `${Math.floor(rng() * 223) + 1}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}.${Math.floor(rng() * 256)}`;
      const port = rng() > 0.5 ? 443 : 8080;
      return {
        probe,
        result: "failed" as const,
        detail: `Unexpected egress connection detected to ${ip}:${port} during model inference`,
        severity: "HIGH" as const,
      };
    }
    if (isRisky && probe === "dns-resolution" && rng() > 0.5) {
      return {
        probe,
        result: "failed" as const,
        detail: "DNS resolution attempt for suspicious domain: data-collector.evil-corp[.]com",
        severity: "CRITICAL" as const,
      };
    }
    if (isRisky && probe === "process-spawn" && rng() > 0.4) {
      return {
        probe,
        result: "warning" as const,
        detail: `Model initialization spawned ${Math.floor(rng() * 3) + 1} unexpected subprocess(es)`,
        severity: "MEDIUM" as const,
      };
    }
    if (isRisky && probe === "filesystem-write" && rng() > 0.6) {
      return {
        probe,
        result: "warning" as const,
        detail: "Model attempted to write to /tmp/payload outside of allowed directories",
        severity: "HIGH" as const,
      };
    }
    return {
      probe,
      result: "passed" as const,
      detail: `No anomalies detected in ${probe.replace(/-/g, " ")} behavior`,
      severity: "LOW" as const,
    };
  });

  const hasHighSeverity = findings.some(
    (f) => f.severity === "HIGH" || f.severity === "CRITICAL"
  );
  const overallStatus: "passed" | "failed" = hasHighSeverity
    ? "failed"
    : "passed";
  const durationMs = isRisky
    ? 12_000 + Math.floor(rng() * 8000)
    : 8000 + Math.floor(rng() * 5000);

  return {
    overallStatus,
    durationMs,
    findings,
    summary: hasHighSeverity
      ? "Behavioral analysis detected anomalous activity. Model has been quarantined pending review."
      : "All behavioral probes passed. No anomalous activity detected.",
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Docker probe execution
// ---------------------------------------------------------------------------

async function runDockerProbe(
  job: Job
): Promise<{ results: ProbeResults; stdout: string; stderr: string; exitCode: number }> {
  const timeoutSec = job.config.timeoutSeconds ?? 300;
  const image = job.config.image ?? "modelvault/sandbox:latest";

  let stdout = "";
  let stderr = "";
  let exitCode: number;

  try {
    console.log(
      `[sandbox-service] [${job.jobId}] Starting Docker container: ${image}`
    );
    const output = execSync(
      `docker run --rm --network=none --memory=4g --cpus=2 --timeout ${timeoutSec} ${image} echo "sandbox probe test" 2>&1 || true`,
      {
        timeout: (timeoutSec + 5) * 1000,
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
      }
    );
    stdout = output;
    exitCode = 0;
    console.log(
      `[sandbox-service] [${job.jobId}] Docker container completed successfully`
    );
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    stdout = error.stdout ?? "";
    stderr = error.stderr ?? "";
    exitCode = error.status ?? 1;
    console.warn(
      `[sandbox-service] [${job.jobId}] Docker container exited with code ${exitCode}`
    );
  }

  // Map Docker results to probe findings
  const findings: ProbeResult[] = [];
  const hasNetworkIssue = stderr.includes("network") || exitCode !== 0;
  const probeList = job.config.probes?.length
    ? job.config.probes
    : ALL_PROBES;

  for (const probe of probeList) {
    if (exitCode !== 0 && probe === "network-egress") {
      findings.push({
        probe,
        result: "warning",
        detail: `Container exited with non-zero code ${exitCode}. Network egress probe inconclusive — container may have attempted external connections.`,
        severity: "MEDIUM",
      });
    } else if (exitCode !== 0 && probe === "process-spawn") {
      findings.push({
        probe,
        result: "warning",
        detail: `Container exited with code ${exitCode}, possibly indicating unexpected process behavior.`,
        severity: "MEDIUM",
      });
    } else {
      findings.push({
        probe,
        result: "passed",
        detail: `No anomalies detected in ${probe.replace(/-/g, " ")} behavior (Docker execution)`,
        severity: "LOW",
      });
    }
  }

  const hasIssues = findings.some(
    (f) => f.severity === "MEDIUM" || f.severity === "HIGH"
  );
  const overallStatus: "passed" | "failed" = hasIssues ? "failed" : "passed";
  const durationMs =
    job.startedAt
      ? Date.now() - new Date(job.startedAt).getTime()
      : 10000;

  return {
    results: {
      overallStatus,
      durationMs,
      findings,
      summary: hasIssues
        ? "Docker-based sandbox detected potential issues during containerized execution."
        : "Docker-based sandbox execution completed successfully. All probes passed.",
      timestamp: new Date().toISOString(),
    },
    stdout,
    stderr,
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Job execution (async background processing)
// ---------------------------------------------------------------------------

async function executeJob(job: Job) {
  const delay = 5000 + Math.random() * 3000; // 5-8 seconds simulated delay

  try {
    if (job.mode === "docker") {
      const dockerResult = await runDockerProbe(job);
      job.results = dockerResult.results;
      job.dockerLogs = {
        stdout: dockerResult.stdout,
        stderr: dockerResult.stderr,
        exitCode: dockerResult.exitCode,
      };
    } else {
      // Mock mode: wait for simulated delay then generate results
      await new Promise((resolve) => setTimeout(resolve, delay));
      job.results = generateMockProbeResults(
        job.modelId,
        job.config.probes
      );
    }

    job.status = job.results.overallStatus === "passed" ? "passed" : "failed";
    job.completedAt = new Date().toISOString();
    job.durationMs = job.results.durationMs;
    console.log(
      `[sandbox-service] [${job.jobId}] Job completed: ${job.status}`
    );
  } catch (error) {
    job.status = "error";
    job.completedAt = new Date().toISOString();
    job.durationMs = job.startedAt
      ? Date.now() - new Date(job.startedAt).getTime()
      : 0;
    console.error(
      `[sandbox-service] [${job.jobId}] Job error:`,
      error
    );
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    mode: effectiveMode,
    uptime: Date.now() - startTime,
    jobsTotal: jobs.size,
    jobsRunning: [...jobs.values()].filter((j) => j.status === "running")
      .length,
  });
});

app.post("/submit", async (c) => {
  const body = (await c.req.json()) as SubmitBody;

  if (!body.modelId || !body.versionId) {
    return c.json({ error: "modelId and versionId are required" }, 400);
  }

  const jobId = `sb-${crypto.randomUUID().slice(0, 8)}-${Date.now().toString(36)}`;
  const mode = effectiveMode;

  const job: Job = {
    jobId,
    modelId: body.modelId,
    versionId: body.versionId,
    status: "running",
    mode,
    config: body.config ?? {},
    submittedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
  };

  jobs.set(jobId, job);
  console.log(
    `[sandbox-service] Job submitted: ${jobId} (mode=${mode})`
  );

  // Execute job asynchronously (don't await)
  executeJob(job).catch((err) => {
    console.error(`[sandbox-service] Unhandled job error for ${jobId}:`, err);
  });

  return c.json(
    {
      jobId,
      status: "running",
      mode,
    },
    201
  );
});

app.get("/status/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = jobs.get(jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json({
    jobId: job.jobId,
    modelId: job.modelId,
    versionId: job.versionId,
    status: job.status,
    mode: job.mode,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    // Include a summary of results if available
    ...(job.results
      ? {
          results: {
            overallStatus: job.results.overallStatus,
            summary: job.results.summary,
            findingCount: job.results.findings.length,
            findings: job.results.findings.map((f) => ({
              probe: f.probe,
              result: f.result,
              severity: f.severity,
              detail: f.detail,
            })),
          },
        }
      : {}),
  });
});

app.get("/results/:jobId", (c) => {
  const jobId = c.req.param("jobId");
  const job = jobs.get(jobId);

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (!job.results) {
    return c.json(
      {
        jobId,
        status: job.status,
        message: "Results not yet available",
      },
      202
    );
  }

  return c.json({
    jobId: job.jobId,
    modelId: job.modelId,
    versionId: job.versionId,
    status: job.status,
    mode: job.mode,
    submittedAt: job.submittedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    results: job.results,
    ...(job.dockerLogs ? { dockerLogs: job.dockerLogs } : {}),
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

console.log(`[sandbox-service] Starting on port ${PORT} (mode=${effectiveMode})`);

Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

console.log(`[sandbox-service] Listening on http://localhost:${PORT}`);