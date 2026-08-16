import { create } from 'zustand';

/* ----------------------------------------------------------------- toasts */

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

interface ToastStore {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
}

let toastSeq = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = ++toastSeq;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-5) }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, toast.kind === 'error' ? 7000 : 4200);
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'error', title, description }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'info', title, description }),
};

/* ---------------------------------------------------------------- confirm */

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmStore {
  request: (ConfirmRequest & { resolve: (ok: boolean) => void }) | null;
  ask: (request: ConfirmRequest) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  request: null,
  ask: (request) =>
    new Promise<boolean>((resolve) => {
      set({ request: { ...request, resolve } });
    }),
  answer: (ok) => {
    const current = get().request;
    set({ request: null });
    current?.resolve(ok);
  },
}));

export const confirmDialog = (request: ConfirmRequest) => useConfirmStore.getState().ask(request);

/* --------------------------------------------------------------- ui prefs */

const ACCOUNT_KEY = 'tgvault.active-account';
const SIDEBAR_KEY = 'tgvault.sidebar-expanded';

function readActiveAccount(): number | null {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readSidebar(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) !== '0';
  } catch {
    return true;
  }
}

interface UiStore {
  activeAccountId: number | null;
  setActiveAccountId: (id: number | null) => void;
  sidebarExpanded: boolean;
  toggleSidebar: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

export const useUiStore = create<UiStore>((set, get) => ({
  activeAccountId: readActiveAccount(),
  setActiveAccountId: (id) => {
    try {
      if (id === null) window.localStorage.removeItem(ACCOUNT_KEY);
      else window.localStorage.setItem(ACCOUNT_KEY, String(id));
    } catch {
      /* ignore */
    }
    set({ activeAccountId: id });
  },
  sidebarExpanded: readSidebar(),
  toggleSidebar: () => {
    const next = !get().sidebarExpanded;
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
    set({ sidebarExpanded: next });
  },
  searchOpen: false,
  setSearchOpen: (open) => set({ searchOpen: open }),
}));

/* ----------------------------------------------------------- page header */

interface PageStore {
  /** Page title + one-line subtitle, rendered by the top bar. */
  title: string;
  subtitle: string;
  setMeta: (title: string, subtitle: string) => void;
  /** Portal target for the primary page action, owned by the top bar. */
  actionsSlot: HTMLElement | null;
  setActionsSlot: (element: HTMLElement | null) => void;
}

export const usePageStore = create<PageStore>((set, get) => ({
  title: 'TgVault',
  subtitle: '',
  setMeta: (title, subtitle) => {
    const state = get();
    if (state.title === title && state.subtitle === subtitle) return;
    set({ title, subtitle });
  },
  actionsSlot: null,
  setActionsSlot: (element) => {
    if (get().actionsSlot === element) return;
    set({ actionsSlot: element });
  },
}));
