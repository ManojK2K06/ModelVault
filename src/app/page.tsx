'use client';

import { AppShell } from '@/components/app-shell';
import Overview from '@/components/overview';
import ModelsList from '@/components/models-list';
import ModelDetail from '@/components/model-detail';
import Registries from '@/components/registries';
import AuditLog from '@/components/audit-log';
import Settings from '@/components/org-settings';
import { useAppStore } from '@/lib/store';

export default function HomePage() {
  const { currentPage } = useAppStore();

  const renderPage = () => {
    switch (currentPage) {
      case 'overview':
        return <Overview />;
      case 'models':
        return <ModelsList />;
      case 'model-detail':
        return <ModelDetail />;
      case 'registries':
      case 'registry-detail':
        return <Registries />;
      case 'audit':
        return <AuditLog />;
      case 'settings':
        return <Settings />;
      default:
        return <Overview />;
    }
  };

  return <AppShell>{renderPage()}</AppShell>;
}