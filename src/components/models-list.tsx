'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Search,
  Plus,
  Eye,
  Shield,
  ScanLine,
  Box,
  Trash2,
  Upload,
  FileUp,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModelVersion {
  id: string;
  version: string;
  fileSizeBytes: number;
  scanStatus: string;
  uploadedAt: string;
}

interface ModelItem {
  id: string;
  name: string;
  description: string | null;
  format: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  latestVersion: ModelVersion | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  signed: 'border-[#4A7C59] text-[#4A7C59]',
  scanning: 'text-muted-foreground',
  failed: 'border-[#B84233] text-[#B84233]',
  uploading: 'text-muted-foreground',
  published: 'border-[#4A7C59] text-[#4A7C59]',
  quarantined: 'border-[#A67B3D] text-[#A67B3D]',
  scanned: 'text-muted-foreground',
};

const SCAN_STATUS_STYLES: Record<string, string> = {
  passed: 'border-[#4A7C59] text-[#4A7C59]',
  failed: 'border-[#B84233] text-[#B84233]',
  warning: 'border-[#A67B3D] text-[#A67B3D]',
  pending: 'text-muted-foreground',
  completed: 'text-muted-foreground',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ModelsList() {
  const navigate = useAppStore((s) => s.navigate);
  const { toast } = useToast();

  // Filters
  const [search, setSearch] = useState('');

  // Data
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadFormat, setUploadFormat] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ModelItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Fetch models ──────────────────────────────────────────────────────────

  const fetchModels = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '20');

    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    try {
      const res = await fetch(`/api/models?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();

      if (cursor) {
        setModels((prev) => [...prev, ...data.items]);
      } else {
        setModels(data.items);
      }
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch {
      toast({ title: 'Failed to load models', variant: 'destructive' });
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, toast]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchModels();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleSign = async (model: ModelItem) => {
    try {
      const res = await fetch(`/api/models/${model.id}/sign`, { method: 'POST' });
      if (!res.ok) throw new Error();
      toast({ title: `Signed "${model.name}" successfully` });
      fetchModels();
    } catch {
      toast({ title: 'Failed to sign model', variant: 'destructive' });
    }
  };

  const handleScan = async (model: ModelItem) => {
    try {
      const res = await fetch(`/api/models/${model.id}/scan`, { method: 'POST' });
      if (!res.ok) throw new Error();
      toast({ title: `Scan started for "${model.name}"` });
      fetchModels();
    } catch {
      toast({ title: 'Failed to start scan', variant: 'destructive' });
    }
  };

  const handleSandbox = async (model: ModelItem) => {
    try {
      const res = await fetch(`/api/models/${model.id}/sandbox`, { method: 'POST' });
      if (!res.ok) throw new Error();
      toast({ title: `Sandbox job started for "${model.name}"` });
    } catch {
      toast({ title: 'Failed to start sandbox', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/models/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast({ title: `"${deleteTarget.name}" deleted` });
      setDeleteTarget(null);
      fetchModels();
    } catch {
      toast({ title: 'Failed to delete model', variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadName || !uploadFormat) {
      toast({ title: 'Model name and format are required', variant: 'destructive' });
      return;
    }
    setUploading(true);

    try {
      let res: Response;

      if (uploadFile) {
        const formData = new FormData();
        formData.append('file', uploadFile);
        formData.append('name', uploadName);
        if (uploadDesc) formData.append('description', uploadDesc);
        if (uploadFormat) formData.append('format', uploadFormat);

        res = await fetch('/api/models', {
          method: 'POST',
          body: formData,
        });
      } else {
        res = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: uploadName,
            description: uploadDesc || null,
            format: uploadFormat,
          }),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
      }

      toast({ title: `"${uploadName}" uploaded successfully` });
      setUploadOpen(false);
      resetUploadForm();
      fetchModels();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to upload model', variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const resetUploadForm = () => {
    setUploadName('');
    setUploadDesc('');
    setUploadFormat('');
    setUploadFile(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      setUploadFile(files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setUploadFile(e.target.files[0]);
    }
  };

  const getScanBadge = (scanStatus: string | undefined) => {
    if (!scanStatus || scanStatus === 'pending') {
      return <Badge variant="outline" className={`text-xs ${SCAN_STATUS_STYLES.pending}`}>Pending</Badge>;
    }
    if (scanStatus === 'completed') {
      return <Badge variant="outline" className={`text-xs ${SCAN_STATUS_STYLES.completed}`}>Scanned</Badge>;
    }
    if (scanStatus === 'failed') {
      return <Badge variant="outline" className={`text-xs ${SCAN_STATUS_STYLES.failed}`}>Failed</Badge>;
    }
    return <Badge variant="outline" className="text-xs text-muted-foreground">{scanStatus}</Badge>;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-sm font-medium text-foreground">Models</h1>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Upload
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 max-w-sm"
        />
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="min-w-[200px]">Name</TableHead>
                <TableHead className="min-w-[90px]">Format</TableHead>
                <TableHead className="min-w-[80px]">Size</TableHead>
                <TableHead className="min-w-[100px]">Status</TableHead>
                <TableHead className="min-w-[100px]">Scan</TableHead>
                <TableHead className="w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell><Skeleton className="h-4 w-[160px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[50px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[60px]" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-[100px]" /></TableCell>
                  </TableRow>
                ))
              ) : models.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <p className="text-sm text-muted-foreground">No models found</p>
                  </TableCell>
                </TableRow>
              ) : (
                models.map((model) => (
                  <TableRow
                    key={model.id}
                    className="border-border hover:bg-secondary/30 transition-colors"
                  >
                    <TableCell>
                      <button
                        onClick={() => navigate('model-detail', model.id)}
                        className="font-medium text-sm text-foreground hover:underline text-left truncate max-w-[250px] block"
                      >
                        {model.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {model.format}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {model.latestVersion?.fileSizeBytes
                        ? formatBytes(model.latestVersion.fileSizeBytes)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs ${STATUS_STYLES[model.status] ?? 'text-muted-foreground'}`}
                      >
                        {model.status.charAt(0).toUpperCase() + model.status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getScanBadge(model.latestVersion?.scanStatus)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleScan(model)}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="Scan"
                        >
                          <ScanLine className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleSign(model)}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="Sign"
                        >
                          <Shield className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleSandbox(model)}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="Sandbox"
                        >
                          <Box className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => navigate('model-detail', model.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                          title="View"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(model)}
                          className="p-1.5 rounded text-muted-foreground hover:text-[#B84233] hover:bg-secondary transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Load More */}
        {hasMore && !loading && (
          <div className="p-3 border-t border-border flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchModels(nextCursor!)}
              disabled={loadingMore}
              className="text-xs text-muted-foreground hover:text-foreground gap-1.5"
            >
              {loadingMore ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Loading...
                </>
              ) : (
                'Load more'
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      <Dialog open={uploadOpen} onOpenChange={(open) => { setUploadOpen(open); if (!open) resetUploadForm(); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">Upload Model</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Add a new model to your organization registry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="model-name" className="text-xs">Name *</Label>
              <Input
                id="model-name"
                placeholder="e.g., llama-3.1-8b-instruct"
                value={uploadName}
                onChange={(e) => setUploadName(e.target.value)}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="model-desc" className="text-xs">Description</Label>
              <Textarea
                id="model-desc"
                placeholder="Brief description (optional)"
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                rows={2}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Format *</Label>
              <Select value={uploadFormat} onValueChange={setUploadFormat}>
                <SelectTrigger className="text-sm">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SafeTensors">SafeTensors</SelectItem>
                  <SelectItem value="GGUF">GGUF</SelectItem>
                  <SelectItem value="ONNX">ONNX</SelectItem>
                  <SelectItem value="PyTorch">PyTorch</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">File</Label>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="border border-dashed border-border rounded-lg p-5 text-center hover:border-muted-foreground/50 transition-colors cursor-pointer"
                onClick={() => document.getElementById('model-file-input')?.click()}
              >
                <input
                  id="model-file-input"
                  type="file"
                  className="hidden"
                  onChange={handleFileInput}
                />
                {uploadFile ? (
                  <div className="space-y-1">
                    <FileUp className="h-5 w-5 mx-auto text-muted-foreground" />
                    <p className="text-xs text-foreground font-medium">{uploadFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Upload className="h-5 w-5 mx-auto text-muted-foreground/50" />
                    <p className="text-xs text-muted-foreground">
                      Drag & drop or click to browse
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setUploadOpen(false); resetUploadForm(); }}
              disabled={uploading}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpload}
              disabled={uploading || !uploadName || !uploadFormat}
              className="text-xs gap-1.5"
            >
              {uploading ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Uploading...
                </>
              ) : (
                'Upload'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">Delete Model</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="font-medium text-foreground">{deleteTarget?.name}</span>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
              className="text-xs gap-1.5"
            >
              {deleting ? (
                <>
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}