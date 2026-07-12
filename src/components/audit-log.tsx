'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Search,
  Download,
  FileText,
  Clock,
  User,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  sourceIp: string | null;
  metadata: string | null;
  user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  } | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTION_OPTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'model.upload', label: 'model.upload' },
  { value: 'model.sign', label: 'model.sign' },
  { value: 'model.scan', label: 'model.scan' },
  { value: 'sandbox.start', label: 'sandbox.start' },
  { value: 'policy.evaluate', label: 'policy.evaluate' },
  { value: 'user.invite', label: 'user.invite' },
  { value: 'registry.publish', label: 'registry.publish' },
  { value: 'api_key.create', label: 'api_key.create' },
];

const OUTCOME_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'success', label: 'success' },
  { value: 'failure', label: 'failure' },
  { value: 'denied', label: 'denied' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOutcomeBadge(outcome: string) {
  switch (outcome) {
    case 'success':
      return (
        <Badge variant="outline" className="border-[#4A7C59]/30 text-[#4A7C59] text-xs">
          success
        </Badge>
      );
    case 'failure':
      return (
        <Badge variant="outline" className="border-[#B84233]/30 text-[#B84233] text-xs">
          failure
        </Badge>
      );
    case 'denied':
      return (
        <Badge variant="outline" className="border-[#A67B3D]/30 text-[#A67B3D] text-xs">
          denied
        </Badge>
      );
    default:
      return <Badge variant="outline" className="text-xs">{outcome}</Badge>;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const { toast } = useToast();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [exporting, setExporting] = useState(false);

  const buildQuery = useCallback(
    (cursor?: string | null) => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (actionFilter) params.set('action', actionFilter);
      if (outcomeFilter) params.set('outcome', outcomeFilter);
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '20');
      return params.toString();
    },
    [search, actionFilter, outcomeFilter]
  );

  const fetchLogs = useCallback(
    async (cursor?: string | null) => {
      const isFirstLoad = !cursor;
      if (isFirstLoad) setLoading(true);
      else setLoadingMore(true);

      try {
        const query = buildQuery(cursor);
        const res = await fetch(`/api/audit?${query}`);
        const data = await res.json();
        if (data.items) {
          if (isFirstLoad) {
            setLogs(data.items);
          } else {
            setLogs((prev) => [...prev, ...data.items]);
          }
          setNextCursor(data.nextCursor);
          setHasMore(data.hasMore);
        }
      } catch {
        toast({ title: 'Failed to load audit logs', variant: 'destructive' });
      } finally {
        if (isFirstLoad) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [buildQuery, toast]
  );

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = () => {
    setNextCursor(null);
    setHasMore(false);
    fetchLogs();
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      handleFilterChange();
    }, 300);
    return () => clearTimeout(timer);
  }, [actionFilter, outcomeFilter]);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFilterChange();
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (actionFilter) params.set('action', actionFilter);
      if (outcomeFilter) params.set('outcome', outcomeFilter);
      params.set('export', 'true');

      const res = await fetch(`/api/audit?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.items && data.items.length > 0) {
          const headers = [
            'Timestamp',
            'Actor',
            'Action',
            'Resource Type',
            'Resource ID',
            'Outcome',
            'Source IP',
          ];
          const rows = data.items.map((log: AuditLogEntry) => [
            log.timestamp,
            log.actor,
            log.action,
            log.resourceType,
            log.resourceId,
            log.outcome,
            log.sourceIp || '',
          ]);
          const csv = [headers.join(','), ...rows.map((r: string[]) => r.map((v) => `"${v}"`).join(','))].join('\n');

          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
          a.click();
          URL.revokeObjectURL(url);
          toast({ title: 'Audit log exported' });
        } else {
          toast({ title: 'No data to export', variant: 'destructive' });
        }
      } else {
        toast({ title: 'Failed to export audit log', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Failed to export audit log', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Track all actions in your organization</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          {exporting ? 'Exporting...' : 'Export CSV'}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[180px] h-8 text-sm">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            {ACTION_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || 'all'} value={opt.value || '_all'}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
          <SelectTrigger className="w-[130px] h-8 text-sm">
            <SelectValue placeholder="Outcome" />
          </SelectTrigger>
          <SelectContent>
            {OUTCOME_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || 'all'} value={opt.value || '_all'}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Audit Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        {loading ? (
          <div className="space-y-3 p-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-3.5 w-[150px]" />
                <Skeleton className="h-3.5 w-[100px]" />
                <Skeleton className="h-3.5 w-[90px]" />
                <Skeleton className="h-3.5 w-[70px]" />
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs w-[160px]">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Timestamp
                      </div>
                    </TableHead>
                    <TableHead className="text-xs">
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        Actor
                      </div>
                    </TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">Resource</TableHead>
                    <TableHead className="text-xs w-[90px]">Outcome</TableHead>
                    <TableHead className="text-xs">Source IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={6} className="h-24 text-center">
                        <div className="flex flex-col items-center gap-2">
                          <FileText className="h-6 w-6 text-muted-foreground/40" />
                          <p className="text-sm text-muted-foreground">No entries found</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow key={log.id} className="hover:bg-transparent">
                        <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(log.timestamp).toISOString().replace('T', ' ').slice(0, 19)}
                        </TableCell>
                        <TableCell className="text-sm">
                          {log.user?.name || log.actor}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            <span className="text-muted-foreground">{log.resourceType}:</span>{' '}
                            <span className="font-mono text-xs">{log.resourceId ? log.resourceId.slice(0, 8) + '...' : '—'}</span>
                          </span>
                        </TableCell>
                        <TableCell>{getOutcomeBadge(log.outcome)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {log.sourceIp || '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {hasMore && (
              <div className="flex justify-center border-t border-border p-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchLogs(nextCursor)}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}