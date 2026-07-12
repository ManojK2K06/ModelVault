import { create } from 'zustand';

export type Page =
  | 'overview'
  | 'models'
  | 'model-detail'
  | 'registries'
  | 'registry-detail'
  | 'audit'
  | 'settings';

export interface AppState {
  currentPage: Page;
  selectedModelId: string | null;
  selectedRegistryId: string | null;
  navigate: (page: Page, id?: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'overview',
  selectedModelId: null,
  selectedRegistryId: null,
  navigate: (page, id) => {
    if (page === 'model-detail' && id) {
      set({ currentPage: 'model-detail', selectedModelId: id });
    } else if (page === 'registry-detail' && id) {
      set({ currentPage: 'registry-detail', selectedRegistryId: id });
    } else {
      set({ currentPage: page, selectedModelId: null, selectedRegistryId: null });
    }
  },
}));