/**
 * Tiny `localStorage`-backed list store for `useSyncExternalStore`.
 * Storage access is wrapped: private windows / blocked storage fall back to memory.
 * Changes made in other tabs are picked up via the `storage` event.
 */
export interface ListStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly T[];
  getServerSnapshot(): readonly T[];
  set(next: readonly T[]): void;
}

const EMPTY: readonly never[] = [];

export function createListStore<T>(storageKey: string, isValid: (v: unknown) => v is T): ListStore<T> {
  let items: readonly T[] | null = null;
  const listeners = new Set<() => void>();

  const read = (): readonly T[] => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isValid) : [];
    } catch {
      return [];
    }
  };

  const onStorage = (e: StorageEvent) => {
    if (e.key !== storageKey) return;
    items = read();
    listeners.forEach((l) => l());
  };

  return {
    subscribe(listener) {
      if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot() {
      if (items === null) items = typeof window === 'undefined' ? EMPTY : read();
      return items;
    },
    getServerSnapshot: () => EMPTY,
    set(next) {
      items = next;
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* memory only */ }
      listeners.forEach((l) => l());
    },
  };
}

export interface ValueStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
  getServerSnapshot(): T;
  set(next: T): void;
  update(patch: Partial<T>): void;
}

/** Single persisted value; `sanitize` repairs stored data (e.g. merges defaults after a schema change). */
export function createValueStore<T>(storageKey: string, fallback: T, sanitize: (raw: unknown) => T): ValueStore<T> {
  let value: T | null = null;
  const listeners = new Set<() => void>();
  const read = (): T => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? sanitize(JSON.parse(raw)) : fallback;
    } catch {
      return fallback;
    }
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== storageKey) return;
    value = read();
    listeners.forEach((l) => l());
  };
  const store: ValueStore<T> = {
    subscribe(listener) {
      if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    getSnapshot() {
      if (value === null) value = typeof window === 'undefined' ? fallback : read();
      return value;
    },
    getServerSnapshot: () => fallback,
    set(next) {
      value = next;
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* memory only */ }
      listeners.forEach((l) => l());
    },
    update(patch) {
      store.set({ ...store.getSnapshot(), ...patch });
    },
  };
  return store;
}
