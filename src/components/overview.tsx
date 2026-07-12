'use client';

import { useEffect, useState, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ───────────────────────────────────────────────────────────────

interface RecentActivityItem {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
}

interface DashboardData {
  totalModels: number;
  scanPassRate: number;
  activeAlerts: number;
  recentActivity: RecentActivityItem[];
}

// ─── Component ───────────────────────────────────────────────────────────

export default function Overview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData({
        totalModels: json.totalModels ?? 0,
        scanPassRate: json.scanPassRate ?? 0,
        activeAlerts: json.activeAlerts ?? 0,
        recentActivity: json.recentActivity ?? [],
      });
      setError(null);
    } catch (err) {
      console.error('Failed to fetch dashboard:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 30_000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="space-y-8">
        <Skeleton className="h-5 w-20" />
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ──
  if (error || !data) {
    return (
      <div className="space-y-8">
        <h1 className="text-sm font-medium text-foreground">Overview</h1>
        <div className="p-8 rounded-lg border border-border bg-card text-center">
          <p className="text-sm text-muted-foreground">Failed to load data</p>
          <button
            onClick={fetchDashboard}
            className="mt-3 text-xs text-foreground hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Content ──
  return (
    <div className="space-y-8">
      <h1 className="text-sm font-medium text-foreground">Overview</h1>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-border bg-card">
          <p className="text-2xl font-semibold text-foreground">{data.totalModels}</p>
          <p className="text-xs text-muted-foreground mt-1">Models</p>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card">
          <p className="text-2xl font-semibold text-foreground">{data.scanPassRate}%</p>
          <p className="text-xs text-muted-foreground mt-1">Scan Pass Rate</p>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card">
          <p className="text-2xl font-semibold text-foreground">{data.activeAlerts}</p>
          <p className="text-xs text-muted-foreground mt-1">Active Alerts</p>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-foreground mb-4">Recent Activity</h2>
        {data.recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet</p>
        ) : (
          <div className="space-y-2">
            {data.recentActivity.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between py-2 px-3 rounded-md bg-card border border-border"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm text-foreground">{item.actor}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.action.replace(/\./g, ' ')}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(item.timestamp), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}