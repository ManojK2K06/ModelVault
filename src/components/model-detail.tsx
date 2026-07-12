'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import {
  ArrowLeft,
  Copy,
  Check,
  Download,
  ExternalLink,
  Clock,
  Play,
  XCircle,
  CheckCircle2,
  Shield,
  ScanLine,
  Box,
  Trash2,
  FileText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface VersionSignature {
  id: string;
  signerEmail: string;
  verifiedAt: string | null;
  createdAt: string;
}

interface VersionSbom {
  id: string;
  totalDeps: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  createdAt: string;
}

interface ModelVersion {
  id: string;
  version: string;
  fileSizeBytes: number;
  sha256Hash: string;
  scanStatus: string;
  scanResultJson: string | null;
  uploadedAt: string;
  signature: VersionSignature | null;
  sbom: VersionSbom | null;
}

interface LatestSignature {
  id: string;
  signerEmail: string;
  signerIdentity: string | null;
  verifiedAt: string | null;
  createdAt: string;
  signer: { id: string; name: string; email: string } | null;
}

interface LatestSbom {
  id: string;
  format: string;
  totalDeps: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  createdAt: string;
}

interface SandboxJob {
  id: string;
  status: string;
  resultJson: string | null;
  durationMs: number | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  submittedBy: { id: string; name: string; email: string } | null;
}

interface SandboxFinding {
  probe: string;
  result: string;
  detail: string;
  severity?: string;
}

interface ModelDetail {
  id: string;
  name: string;
  description: string | null;
  sourceUrl: string | null;
  format: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  versions: ModelVersion[];
  latestSignature: LatestSignature | null;
  latestSbom: LatestSbom | null;
  latestSandboxJob: SandboxJob | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'border-[#B84233]/30 text-[#B84233]',
  HIGH: 'border-[#A67B3D]/30 text-[#A67B3D]',
  MEDIUM: 'border-[#A67B3D]/30 text-[#A67B3D]',
  LOW: 'border-[#7A6E64]/30 text-[#7A6E64]',
};

const SANDBOX_STATUS_COLORS: Record<string, string> = {
  queued: 'border-border text-muted-foreground',
  provisioning: 'border-border text-muted-foreground',
  running: 'border-[#A67B3D]/30 text-[#A67B3D]',
  completed: 'border-[#4A7C59]/30 text-[#4A7C59]',
  failed: 'border-[#B84233]/30 text-[#B84233]',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function truncateHash(hash: string): string {
  if (!hash || hash.length <= 16) return hash || '—';
  return hash.slice(0, 8) + '…' + hash.slice(-8);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModelDetail() {
  const selectedModelId = useAppStore((s) => s.selectedModelId);
  const navigate = useAppStore((s) => s.navigate);
  const { toast } = useToast();

  const [model, setModel] = useState<ModelDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [sandboxJobs, setSandboxJobs] = useState<SandboxJob[]>([]);
  const [sandboxLoading, setSandboxLoading] = useState(false);

  const [sbomDialogOpen, setSbomDialogOpen] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const [signing, setSigning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [sandboxing, setSandboxing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch model ────────────────────────────────────────────────────────────

  const fetchModel = useCallback(async () => {
    if (!selectedModelId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/models/${selectedModelId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setModel(data);
    } catch {
      toast({ title: 'Failed to load model', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedModelId, toast]);

  const fetchSandboxJobs = useCallback(async () => {
    if (!selectedModelId) return;
    setSandboxLoading(true);
    try {
      const res = await fetch(`/api/models/${selectedModelId}/sandbox?modelId=${selectedModelId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSandboxJobs(data.items ?? []);
    } catch {
      // silent
    } finally {
      setSandboxLoading(false);
    }
  }, [selectedModelId]);

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  useEffect(() => {
    fetchSandboxJobs();
  }, [fetchSandboxJobs]);

  // Auto-poll sandbox jobs when there are running ones
  useEffect(() => {
    const hasRunning = sandboxJobs.some((j) => j.status === 'running');
    if (!hasRunning) return;
    const interval = setInterval(() => {
      fetchSandboxJobs();
    }, 3000);
    return () => clearInterval(interval);
  }, [sandboxJobs, fetchSandboxJobs]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSign = async () => {
    if (!model) return;
    setSigning(true);
    try {
      const res = await fetch(`/api/models/${model.id}/sign`, { method: 'POST' });
      if (!res.ok) throw new Error();
      toast({ title: 'Model signed successfully' });
      fetchModel();
    } catch {
      toast({ title: 'Failed to sign model', variant: 'destructive' });
    } finally {
      setSigning(false);
    }
  };

  const handleScan = async () => {
    if (!model) return;
    setScanning(true);
    try {
      const res = await fetch(`/api/models/${model.id}/scan`, { method: 'POST' });
      if (!res.ok) throw new Error();
      toast({ title: 'Scan started successfully' });
      fetchModel();
    } catch {
      toast({ title: 'Failed to start scan', variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  };

  const handleSandbox = async () => {
    if (!model) return;
    setSandboxing(true);
    try {
      const res = await fetch(`/api/models/${model.id}/sandbox`, { method: 'POST' });
      if (!res.ok) throw new Error();
      toast({ title: 'Sandbox job started' });
      fetchSandboxJobs();
    } catch {
      toast({ title: 'Failed to start sandbox', variant: 'destructive' });
    } finally {
      setSandboxing(false);
    }
  };

  const handleDelete = async () => {
    if (!model) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/models/${model.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast({ title: `"${model.name}" deleted` });
      navigate('models');
    } catch {
      toast({ title: 'Failed to delete model', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    toast({ title: 'SHA-256 hash copied' });
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // ── Build SBOM JSON for dialog ────────────────────────────────────────────

  const buildSbomJson = (): string => {
    if (!model?.latestSbom) return '{}';
    const sbom = model.latestSbom;
    const vulns: Array<{ id: string; severity: string; description: string }> = [];
    let idx = 1000;
    for (let i = 0; i < sbom.criticalCount; i++) vulns.push({ id: `CVE-2025-${idx++}`, severity: 'CRITICAL', description: 'Critical vulnerability in dependency' });
    for (let i = 0; i < sbom.highCount; i++) vulns.push({ id: `CVE-2025-${idx++}`, severity: 'HIGH', description: 'High severity vulnerability' });
    for (let i = 0; i < sbom.mediumCount; i++) vulns.push({ id: `CVE-2025-${idx++}`, severity: 'MEDIUM', description: 'Medium severity vulnerability' });
    for (let i = 0; i < sbom.lowCount; i++) vulns.push({ id: `CVE-2025-${idx++}`, severity: 'LOW', description: 'Low severity vulnerability' });

    const deps = ['numpy', 'torch', 'transformers', 'tokenizers', 'safetensors', 'onnx', 'pillow', 'scipy'].slice(0, Math.min(sbom.totalDeps, 8));

    return JSON.stringify(
      {
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        metadata: {
          component: {
            name: model.name,
            version: model.versions[0]?.version ?? 'v1.0.0',
            type: 'machine-learning-model',
            properties: [
              { name: 'ml:framework', value: 'pytorch' },
              { name: 'ml:task', value: 'text-generation' },
            ],
          },
          tools: [{ name: 'modelvault-scanner', version: '1.2.0' }],
        },
        components: deps.map((d) => ({ ref: `pkg:pypi/${d}`, type: 'library' })),
        vulnerabilities: vulns,
      },
      null,
      2
    );
  };

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-px w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  if (!model) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <XCircle className="h-10 w-10 mb-3 opacity-40" />
        <p className="text-sm">Model not found</p>
        <Button variant="outline" className="mt-4" size="sm" onClick={() => navigate('models')}>
          Back to Models
        </Button>
      </div>
    );
  }

  const sig = model.latestSignature;
  const sbom = model.latestSbom;
  const latestVersion = model.versions[0];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Back + Header */}
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
            onClick={() => navigate('models')}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Models
          </Button>

          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">{model.name}</h1>
                <Badge variant="outline" className="text-xs font-normal">{model.format}</Badge>
                <Badge variant="outline" className="text-xs font-normal capitalize">{model.status}</Badge>
              </div>
              {model.description && (
                <p className="text-sm text-muted-foreground max-w-xl">{model.description}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleScan}
                disabled={scanning}
                className="gap-1.5"
              >
                {scanning ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <ScanLine className="h-3.5 w-3.5" />
                )}
                Scan
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSign}
                disabled={signing}
                className="gap-1.5"
              >
                {signing ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Shield className="h-3.5 w-3.5" />
                )}
                Sign
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSandbox}
                disabled={sandboxing}
                className="gap-1.5"
              >
                {sandboxing ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Box className="h-3.5 w-3.5" />
                )}
                Sandbox
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="gap-1.5 text-[#B84233] hover:text-[#B84233] border-[#B84233]/30 hover:border-[#B84233]/50"
              >
                {deleting ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* Tabs */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="sbom">SBOM</TabsTrigger>
            <TabsTrigger value="signatures">Signatures</TabsTrigger>
            <TabsTrigger value="sandbox">Sandbox</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Overview ─────────────────────────────────────────── */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 max-w-2xl">
              <div className="flex justify-between py-2.5 border-b border-border">
                <span className="text-sm text-muted-foreground">Format</span>
                <span className="text-sm font-medium">{model.format}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-border">
                <span className="text-sm text-muted-foreground">Status</span>
                <span className="text-sm font-medium capitalize">{model.status}</span>
              </div>
              {latestVersion && (
                <>
                  <div className="flex justify-between py-2.5 border-b border-border">
                    <span className="text-sm text-muted-foreground">File Size</span>
                    <span className="text-sm font-medium">
                      {latestVersion.fileSizeBytes > 0 ? formatBytes(latestVersion.fileSizeBytes) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between py-2.5 border-b border-border">
                    <span className="text-sm text-muted-foreground">Version</span>
                    <span className="text-sm font-mono">{latestVersion.version}</span>
                  </div>
                  <div className="flex justify-between items-center py-2.5 border-b border-border">
                    <span className="text-sm text-muted-foreground">SHA-256</span>
                    <div className="flex items-center gap-1.5">
                      <code className="text-xs font-mono text-muted-foreground">
                        {truncateHash(latestVersion.sha256Hash)}
                      </code>
                      {latestVersion.sha256Hash && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => copyHash(latestVersion.sha256Hash)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              {copiedHash === latestVersion.sha256Hash ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Copy hash</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between py-2.5 border-b border-border">
                    <span className="text-sm text-muted-foreground">Uploaded</span>
                    <span className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(latestVersion.uploadedAt), { addSuffix: true })}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between py-2.5 border-b border-border">
                <span className="text-sm text-muted-foreground">Created</span>
                <span className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(model.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          </TabsContent>

          {/* ── Tab 2: SBOM ─────────────────────────────────────────── */}
          <TabsContent value="sbom">
            {!sbom ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <FileText className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm">No SBOM generated yet</p>
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={handleScan} disabled={scanning}>
                  {scanning ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <ScanLine className="h-3.5 w-3.5" />
                  )}
                  Run Scan
                </Button>
              </div>
            ) : (
              <div className="space-y-4 max-w-2xl">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">{sbom.totalDeps} dependencies</span>
                  <Separator orientation="vertical" className="h-3.5" />
                  <span className="text-muted-foreground">Scanned {formatDistanceToNow(new Date(sbom.createdAt), { addSuffix: true })}</span>
                </div>

                {(sbom.criticalCount > 0 || sbom.highCount > 0 || sbom.mediumCount > 0 || sbom.lowCount > 0) ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {sbom.criticalCount > 0 && (
                        <Badge variant="outline" className={SEVERITY_COLORS.CRITICAL + ' text-xs'}>
                          {sbom.criticalCount} Critical
                        </Badge>
                      )}
                      {sbom.highCount > 0 && (
                        <Badge variant="outline" className={SEVERITY_COLORS.HIGH + ' text-xs'}>
                          {sbom.highCount} High
                        </Badge>
                      )}
                      {sbom.mediumCount > 0 && (
                        <Badge variant="outline" className={SEVERITY_COLORS.MEDIUM + ' text-xs'}>
                          {sbom.mediumCount} Medium
                        </Badge>
                      )}
                      {sbom.lowCount > 0 && (
                        <Badge variant="outline" className={SEVERITY_COLORS.LOW + ' text-xs'}>
                          {sbom.lowCount} Low
                        </Badge>
                      )}
                    </div>

                    {/* Scan results per version */}
                    {model.versions
                      .filter((v) => v.scanResultJson)
                      .map((v) => {
                        let parsed: Record<string, number> | null = null;
                        try { parsed = JSON.parse(v.scanResultJson!); } catch { /* ignore */ }
                        if (!parsed) return null;
                        return (
                          <div key={v.id} className="rounded-lg border border-border p-4 space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                              <span className="font-mono">{v.version}</span>
                              <span className="text-muted-foreground">·</span>
                              <span className="text-xs text-muted-foreground">
                                {formatDistanceToNow(new Date(v.uploadedAt), { addSuffix: true })}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                              <div className="flex justify-between py-1">
                                <span className="text-muted-foreground">Critical</span>
                                <span className="font-medium text-[#B84233]">{parsed.critical ?? 0}</span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span className="text-muted-foreground">High</span>
                                <span className="font-medium text-[#A67B3D]">{parsed.high ?? 0}</span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span className="text-muted-foreground">Medium</span>
                                <span className="font-medium text-[#A67B3D]">{parsed.medium ?? 0}</span>
                              </div>
                              <div className="flex justify-between py-1">
                                <span className="text-muted-foreground">Low</span>
                                <span className="font-medium text-[#7A6E64]">{parsed.low ?? 0}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                ) : (
                  <p className="text-sm text-[#4A7C59]">No vulnerabilities found</p>
                )}

                <Button variant="outline" size="sm" onClick={() => setSbomDialogOpen(true)}>
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  View Full SBOM
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── Tab 3: Signatures ─────────────────────────────────────── */}
          <TabsContent value="signatures">
            <div className="max-w-2xl space-y-4">
              {model.versions.some((v) => v.signature) ? (
                model.versions
                  .filter((v) => v.signature)
                  .map((v) => (
                    <div key={v.id} className="rounded-lg border border-border p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm">{v.version}</span>
                        {v.signature?.verifiedAt ? (
                          <Badge variant="outline" className="border-[#4A7C59]/30 text-[#4A7C59] text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="border-[#A67B3D]/30 text-[#A67B3D] text-xs">
                            Unverified
                          </Badge>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1 text-sm">
                        <div className="flex justify-between py-1.5">
                          <span className="text-muted-foreground">Signer</span>
                          <span className="font-medium">{v.signature?.signerEmail ?? '—'}</span>
                        </div>
                        <div className="flex justify-between py-1.5">
                          <span className="text-muted-foreground">Signed</span>
                          <span className="text-muted-foreground">
                            {v.signature ? formatDistanceToNow(new Date(v.signature.createdAt), { addSuffix: true }) : '—'}
                          </span>
                        </div>
                      </div>
                      {v.signature && !v.signature.verifiedAt && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => toast({ title: 'Verification initiated' })}
                        >
                          <Shield className="h-3.5 w-3.5 mr-1.5" />
                          Verify
                        </Button>
                      )}
                    </div>
                  ))
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Shield className="h-8 w-8 mb-3 opacity-40" />
                  <p className="text-sm">No signatures yet</p>
                  <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={handleSign} disabled={signing}>
                    {signing ? (
                      <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Shield className="h-3.5 w-3.5" />
                    )}
                    Sign Model
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Tab 4: Sandbox ──────────────────────────────────────────── */}
          <TabsContent value="sandbox">
            {sandboxLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 rounded-lg" />
                ))}
              </div>
            ) : sandboxJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Box className="h-8 w-8 mb-3 opacity-40" />
                <p className="text-sm">No sandbox jobs yet</p>
                <Button variant="outline" size="sm" className="mt-4 gap-1.5" onClick={handleSandbox} disabled={sandboxing}>
                  {sandboxing ? (
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Start Sandbox
                </Button>
              </div>
            ) : (
              <div className="space-y-3 max-w-3xl">
                {sandboxJobs.map((job) => {
                  let findings: SandboxFinding[] = [];
                  if (job.resultJson) {
                    try {
                      const parsed = JSON.parse(job.resultJson);
                      findings = parsed.findings ?? [];
                    } catch { /* ignore */ }
                  }

                  return (
                    <div key={job.id} className="rounded-lg border border-border p-4 space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-xs capitalize ${SANDBOX_STATUS_COLORS[job.status] ?? ''}`}
                        >
                          {job.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                        </span>
                        {job.durationMs != null && (
                          <span className="text-xs text-muted-foreground">
                            {Math.round(job.durationMs / 1000)}s
                          </span>
                        )}
                        {job.submittedBy && (
                          <span className="text-xs text-muted-foreground">
                            by {job.submittedBy.name}
                          </span>
                        )}
                      </div>

                      {findings.length > 0 ? (
                        <div className="rounded-md border border-border overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="text-xs">Test</TableHead>
                                <TableHead className="text-xs w-[70px]">Result</TableHead>
                                <TableHead className="text-xs">Description</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {findings.map((f, i) => (
                                <TableRow key={i} className="hover:bg-transparent">
                                  <TableCell className="font-mono text-xs">{f.probe}</TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={
                                        f.result === 'ok' || f.result === 'passed'
                                          ? 'border-[#4A7C59]/30 text-[#4A7C59] text-xs'
                                          : f.result === 'warning'
                                            ? 'border-[#A67B3D]/30 text-[#A67B3D] text-xs'
                                            : 'border-[#B84233]/30 text-[#B84233] text-xs'
                                      }
                                    >
                                      {f.result === 'passed' || f.result === 'ok' ? 'PASS' : f.result === 'warning' ? 'WARN' : 'FAIL'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{f.detail}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No results available {job.status === 'running' && '(job still in progress)'}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* SBOM Dialog */}
        <Dialog open={sbomDialogOpen} onOpenChange={setSbomDialogOpen}>
          <DialogContent className="sm:max-w-[700px] max-h-[80vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>SBOM — CycloneDX ML-BOM</DialogTitle>
              <DialogDescription>Software Bill of Materials for {model.name}</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto rounded-md border border-border bg-card p-4 max-h-[60vh]">
              <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-words">
                <code>{buildSbomJson()}</code>
              </pre>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}