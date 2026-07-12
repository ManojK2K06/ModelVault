'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgData {
  id: string;
  name: string;
  slug: string;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PERMISSION_OPTIONS = [
  { value: 'model:upload', label: 'Upload Models' },
  { value: 'model:read', label: 'Read Models' },
  { value: 'model:sign', label: 'Sign Models' },
  { value: 'registry:publish', label: 'Publish to Registry' },
  { value: 'audit:read', label: 'Read Audit Logs' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function OrgSettingsPage() {
  const { user } = useAppStore();
  const { toast } = useToast();
  const [org, setOrg] = useState<OrgData | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);

  // API Keys state
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [newKeyPermissions, setNewKeyPermissions] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null);
  const [revoking, setRevoking] = useState(false);

  // ── Fetch org ────────────────────────────────────────────────────────────

  const fetchOrg = useCallback(async () => {
    try {
      const res = await fetch('/api/org');
      const data = await res.json();
      if (data.id) setOrg(data);
    } catch {
      toast({ title: 'Failed to load organization', variant: 'destructive' });
    } finally {
      setOrgLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchOrg();
  }, [fetchOrg]);

  // ── API Keys ─────────────────────────────────────────────────────────────

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/org/api-keys');
      const data = await res.json();
      if (data.items) setKeys(data.items);
    } catch {
      toast({ title: 'Failed to load API keys', variant: 'destructive' });
    } finally {
      setKeysLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/org/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName,
          expiresAt: newKeyExpiry || null,
          permissions: newKeyPermissions.length > 0 ? newKeyPermissions : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key);
        setNewKeyName('');
        setNewKeyExpiry('');
        setNewKeyPermissions([]);
        fetchKeys();
      } else {
        const err = await res.json();
        toast({ title: err.error || 'Failed to create API key', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to create API key', variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const handleCopyKey = () => {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/org/api-keys/${revokeTarget.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast({ title: 'API key revoked' });
        setRevokeTarget(null);
        fetchKeys();
      } else {
        const err = await res.json();
        toast({ title: err.error || 'Failed to revoke API key', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to revoke API key', variant: 'destructive' });
    } finally {
      setRevoking(false);
    }
  };

  const togglePermission = (perm: string) => {
    setNewKeyPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
      </div>

      <Separator />

      {/* Organization Name */}
      <div className="space-y-3">
        <span className="text-sm font-medium">Organization</span>
        {orgLoading ? (
          <Skeleton className="h-9 w-64" />
        ) : (
          <div className="flex items-center gap-3">
            <Input
              value={org?.name ?? ''}
              readOnly
              className="max-w-xs bg-[#F0EBE5] border-border"
            />
            <span className="text-xs text-muted-foreground font-mono">{org?.slug}</span>
          </div>
        )}
        {user?.email && (
          <p className="text-xs text-muted-foreground">
            Signed in as {user.email} · {user.role}
          </p>
        )}
      </div>

      <Separator />

      {/* API Keys */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">API Keys</span>
            {!keysLoading && (
              <span className="text-xs text-muted-foreground">{keys.length} key{keys.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create
          </Button>
        </div>

        <div className="rounded-lg border border-border overflow-hidden">
          {keysLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-3.5 w-[140px]" />
                  <Skeleton className="h-3.5 w-[160px]" />
                  <Skeleton className="h-3.5 w-[80px]" />
                </div>
              ))}
            </div>
          ) : keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
              <Key className="h-6 w-6 mb-2 opacity-40" />
              <p className="text-sm">No API keys yet</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs">Name</TableHead>
                  <TableHead className="text-xs">Key</TableHead>
                  <TableHead className="text-xs">Created</TableHead>
                  <TableHead className="text-xs">Last Used</TableHead>
                  <TableHead className="text-xs w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id} className="hover:bg-transparent">
                    <TableCell className="text-sm font-medium">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {key.keyPrefix}****
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(key.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {key.lastUsedAt
                        ? formatDistanceToNow(new Date(key.lastUsedAt), { addSuffix: true })
                        : 'Never'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-[#B84233]"
                        onClick={() => setRevokeTarget(key)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Create API Key Dialog */}
      <Dialog
        open={createOpen && !createdKey}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setNewKeyName('');
            setNewKeyExpiry('');
            setNewKeyPermissions([]);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>Generate a new API key for programmatic access.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                placeholder="e.g., CI/CD Pipeline Key"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="key-expiry">Expiration Date</Label>
              <Input
                id="key-expiry"
                type="date"
                value={newKeyExpiry}
                onChange={(e) => setNewKeyExpiry(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="space-y-1.5">
                {PERMISSION_OPTIONS.map((perm) => (
                  <label
                    key={perm.value}
                    className="flex items-center gap-2 cursor-pointer rounded-md border border-border p-2.5 hover:bg-[#F0EBE5] transition-colors"
                  >
                    <Checkbox
                      checked={newKeyPermissions.includes(perm.value)}
                      onCheckedChange={() => togglePermission(perm.value)}
                    />
                    <span className="text-sm">{perm.label}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {perm.value}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newKeyName.trim() || creating}>
              {creating ? 'Creating...' : 'Create Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Created Key Display Dialog */}
      <Dialog
        open={!!createdKey}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedKey(null);
            setCreateOpen(false);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>Copy it now — it will not be shown again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border border-[#A67B3D]/30 bg-[#A67B3D]/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#A67B3D]" />
                <p className="text-xs text-[#A67B3D]">
                  This key will not be shown again. Store it securely.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={createdKey || ''}
                  readOnly
                  className="font-mono text-xs bg-[#F0EBE5] border-border"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={handleCopyKey}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-[#4A7C59]" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Key Alert */}
      <AlertDialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to revoke <span className="font-medium text-foreground">{revokeTarget?.name}</span>?
              Any applications using this key will lose access immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={revoking}
              className="bg-[#B84233] text-white hover:bg-[#B84233]/90"
            >
              {revoking ? 'Revoking...' : 'Revoke Key'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}