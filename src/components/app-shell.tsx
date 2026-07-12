'use client';

import { useAppStore, type Page } from '@/lib/store';
import { Settings, Shield, Package, Building2, FileText, LayoutGrid } from 'lucide-react';

const navItems: { page: Page; label: string; icon: React.ReactNode }[] = [
  { page: 'overview', label: 'Overview', icon: <LayoutGrid className="h-4 w-4" /> },
  { page: 'models', label: 'Models', icon: <Package className="h-4 w-4" /> },
  { page: 'registries', label: 'Registries', icon: <Building2 className="h-4 w-4" /> },
  { page: 'audit', label: 'Audit', icon: <FileText className="h-4 w-4" /> },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { currentPage, navigate } = useAppStore();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-[#FAF8F5]/95 backdrop-blur-sm">
        <div className="flex items-center justify-between h-12 px-6 max-w-7xl mx-auto w-full">
          <button
            onClick={() => navigate('overview')}
            className="flex items-center gap-2"
          >
            <Shield className="h-5 w-5 text-primary" />
            <span className="font-semibold text-foreground text-sm tracking-tight">ModelVault</span>
          </button>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.page}
                onClick={() => navigate(item.page)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${
                  currentPage === item.page
                    ? 'bg-secondary text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
                }`}
              >
                {item.icon}
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}
          </nav>

          <button
            onClick={() => navigate('settings')}
            className={`p-2 rounded-md transition-colors ${
              currentPage === 'settings'
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-7xl mx-auto w-full px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}