'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Plus,
  Shield,
  ExternalLink,
  Edit,
  Check,
  XCircle,
  Building2,
  FileCode,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface RegistryArtifact {
  id: string;
  modelId: string;
  versionId: string;
  publishedAt: string;
  gateResult: string;
  gateReasons: string | null;
  model: {
    id: string;
    name: string;
    format: string;
    status?: string;
  };
}

interface Registry {
  id: string;
  name: string;
  description: string | null;
  policyRego: string;
  lastPublishAt: string | null;
  artifactCount: number;
  createdAt: string;
  artifacts: RegistryArtifact[];
}

interface ModelOption {
  id: string;
  name: string;
  format: string;
  status: string;
  latestVersion: { id: string; version: string } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(str: string, len: number) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

// ── Registries List ──────────────────────────────────────────────────────────

function RegistriesList() {
  const { navigate } = useAppStore();
  const { toast } = useToast();
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    policyRego: `package modelvault.authz

default allow := false

allow {
    input.model.status == "signed"
    not has_critical_vulnerabilities
}

has_critical_vulnerabilities {
    count(input.sbom.vulnerabilities) > 0
    some v
    v := input.sbom.vulnerabilities[_]
    v.severity == "CRITICAL"
}`,
  });
  const [creating, setCreating] = useState(false);

  const fetchRegistries = useCallback(async () => {
    try {
      const res = await fetch('/api/registries');
      const data = await res.json();
      if (data.items) setRegistries(data.items);
    } catch {
      toast({ title: 'Failed to load registries', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchRegistries();
  }, [fetchRegistries]);

  const handleCreate = async () => {
    if (!createForm.name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/registries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        toast({ title: 'Registry created' });
        setCreateOpen(false);
        setCreateForm({ name: '', description: '', policyRego: createForm.policyRego });
        fetchRegistries();
      } else {
        const err = await res.json();
        toast({ title: err.error || 'Failed to create registry', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to create registry', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Registries</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage model registries with OPA policy gates</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Create
        </Button>
      </div>

      <Separator />

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border p-4 space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && registries.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Building2 className="h-8 w-8 mb-3 opacity-40" />
          <p className="text-sm">No registries yet</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Registry
          </Button>
        </div>
      )}

      {/* Registry Cards */}
      {!loading && registries.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {registries.map((reg) => (
            <div
              key={reg.id}
              className="rounded-lg border border-border bg-card p-4 cursor-pointer hover:bg-[#F0EBE5] transition-colors"
              onClick={() => navigate('registry-detail', reg.id)}
            >
              <div className="flex items-start justify-between mb-1">
                <span className="text-sm font-medium">{reg.name}</span>
                <Badge variant="outline" className="text-xs">
                  {reg.artifactCount} artifact{reg.artifactCount !== 1 ? 's' : ''}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                {truncate(reg.description || 'No description', 80)}
              </p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <FileCode className="h-3 w-3" />
                <span>OPA Policy</span>
                {reg.lastPublishAt && (
                  <>
                    <span className="mx-1">·</span>
                    <span>Published {formatDistanceToNow(new Date(reg.lastPublishAt), { addSuffix: true })}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Registry Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Registry</DialogTitle>
            <DialogDescription>Set up a new model registry with a publication policy.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="reg-name">Name</Label>
              <Input
                id="reg-name"
                placeholder="e.g., Production Registry"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-desc">Description</Label>
              <Textarea
                id="reg-desc"
                placeholder="Describe the purpose of this registry..."
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-policy">Publication Policy (Rego)</Label>
              <Textarea
                id="reg-policy"
                value={createForm.policyRego}
                onChange={(e) => setCreateForm((f) => ({ ...f, policyRego: e.target.value }))}
                rows={10}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!createForm.name.trim() || creating}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Registry Detail ───────────────────────────────────────────────────────────

function RegistryDetail() {
  const { selectedRegistryId, navigate, user } = useAppStore();
  const { toast } = useToast();
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [loading, setLoading] = useState(true);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  // Edit policy dialog
  const [editPolicyOpen, setEditPolicyOpen] = useState(false);
  const [editPolicy, setEditPolicy] = useState('');
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Publish dialog
  const [publishOpen, setPublishOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{
    gateResult: string;
    gateReasons: string;
  } | null>(null);

  const fetchRegistry = useCallback(async () => {
    if (!selectedRegistryId) return;
    try {
      const res = await fetch(`/api/registries/${selectedRegistryId}`);
      if (res.ok) {
        const data = await res.json();
        setRegistry(data);
        setEditPolicy(data.policyRego);
      } else {
        toast({ title: 'Registry not found', variant: 'destructive' });
        navigate('registries');
      }
    } catch {
      toast({ title: 'Failed to load registry', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [selectedRegistryId, navigate, toast]);

  useEffect(() => {
    fetchRegistry();
  }, [fetchRegistry]);

  const openPublishDialog = async () => {
    setPublishOpen(true);
    setPublishResult(null);
    setSelectedModelId('');
    setModelsLoading(true);
    try {
      const res = await fetch('/api/models?limit=100');
      const data = await res.json();
      if (data.items) {
        setModels(
          data.items.filter(
            (m: ModelOption) => m.latestVersion !== null
          )
        );
      }
    } catch {
      toast({ title: 'Failed to load models', variant: 'destructive' });
    } finally {
      setModelsLoading(false);
    }
  };

  const handleSavePolicy = async () => {
    if (!selectedRegistryId) return;
    setSavingPolicy(true);
    try {
      const res = await fetch(`/api/registries/${selectedRegistryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyRego: editPolicy }),
      });
      if (res.ok) {
        toast({ title: 'Policy updated' });
        setEditPolicyOpen(false);
        fetchRegistry();
      } else {
        const err = await res.json();
        toast({ title: err.error || 'Failed to update policy', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to update policy', variant: 'destructive' });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedRegistryId || !selectedModelId) return;
    const model = models.find((m) => m.id === selectedModelId);
    if (!model || !model.latestVersion) return;

    setPublishing(true);
    setPublishResult(null);
    try {
      const res = await fetch(`/api/registries/${selectedRegistryId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: model.id,
          versionId: model.latestVersion.id,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setPublishResult({
          gateResult: data.gateResult,
          gateReasons: data.gateReasons,
        });
        fetchRegistry();
      } else {
        const err = await res.json();
        toast({ title: err.error || 'Failed to publish model', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to publish model', variant: 'destructive' });
    } finally {
      setPublishing(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  if (!registry) return null;

  const isAdmin = user?.role === 'owner' || user?.role === 'admin';

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div className="space-y-3">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
          onClick={() => navigate('registries')}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Registries
        </Button>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-lg font-semibold tracking-tight">{registry.name}</h1>
            {registry.description && (
              <p className="text-sm text-muted-foreground">{registry.description}</p>
            )}
          </div>
          <Button size="sm" onClick={openPublishDialog}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Publish Model
          </Button>
        </div>
      </div>

      <Separator />

      {/* Policy Section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Publication Policy</span>
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditPolicy(registry.policyRego);
                setEditPolicyOpen(true);
              }}
              className="gap-1.5"
            >
              <Edit className="h-3 w-3" />
              Edit
            </Button>
          )}
        </div>
        <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground font-mono">
          <code>{registry.policyRego}</code>
        </pre>
      </div>

      <Separator />

      {/* Artifacts */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Artifacts</span>
          <Badge variant="outline" className="text-xs">{registry.artifacts.length}</Badge>
        </div>

        {registry.artifacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileCode className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm">No artifacts published yet</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={openPublishDialog}>
              <Plus className="h-3 w-3 mr-1.5" />
              Publish your first model
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Model</TableHead>
                  <TableHead>Published</TableHead>
                  <TableHead>Gate Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {registry.artifacts.map((art) => (
                  <TableRow key={art.id} className="hover:bg-transparent">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{art.model.name}</span>
                        <Badge variant="outline" className="text-xs">{art.model.format}</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(art.publishedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell>
                      {art.gateResult === 'ALLOWED' ? (
                        <Badge variant="outline" className="border-[#4A7C59]/30 text-[#4A7C59] text-xs">
                          <Check className="h-3 w-3 mr-1" />
                          ALLOWED
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-[#B84233]/30 text-[#B84233] text-xs">
                          <XCircle className="h-3 w-3 mr-1" />
                          BLOCKED
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Edit Policy Dialog */}
      <Dialog open={editPolicyOpen} onOpenChange={setEditPolicyOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Publication Policy</DialogTitle>
            <DialogDescription>Modify the OPA Rego policy that controls which models can be published.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Policy (Rego)</Label>
            <Textarea
              value={editPolicy}
              onChange={(e) => setEditPolicy(e.target.value)}
              rows={16}
              className="font-mono text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPolicyOpen(false)}>Cancel</Button>
            <Button onClick={handleSavePolicy} disabled={savingPolicy}>
              {savingPolicy ? 'Saving...' : 'Save Policy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Publish Model Dialog */}
      <Dialog open={publishOpen} onOpenChange={(open) => {
        setPublishOpen(open);
        if (!open) { setPublishResult(null); setSelectedModelId(''); }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Publish Model</DialogTitle>
            <DialogDescription>Select a model version to publish to {registry?.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!publishResult && (
              <div className="space-y-2">
                <Label>Select Model</Label>
                {modelsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : models.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No models with versions available.</p>
                ) : (
                  <Select value={selectedModelId} onValueChange={setSelectedModelId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Search and select a model..." />
                    </SelectTrigger>
                    <SelectContent>
                      {models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <div className="flex items-center gap-2">
                            <span>{m.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {m.latestVersion?.version} · {m.format}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {publishResult && (
              <div className="space-y-3">
                <Separator />
                <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                  {publishResult.gateResult === 'ALLOWED' ? (
                    <>
                      <Check className="h-5 w-5 mt-0.5 text-[#4A7C59] shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-[#4A7C59]">Published</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{publishResult.gateReasons}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-5 w-5 mt-0.5 text-[#B84233] shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-[#B84233]">Blocked</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{publishResult.gateReasons}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>
              {publishResult ? 'Close' : 'Cancel'}
            </Button>
            {!publishResult && (
              <Button onClick={handlePublish} disabled={!selectedModelId || publishing}>
                {publishing ? 'Evaluating Policy...' : 'Publish'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RegistriesPage() {
  const { currentPage } = useAppStore();

  if (currentPage === 'registry-detail') {
    return <RegistryDetail />;
  }

  return <RegistriesList />;
}