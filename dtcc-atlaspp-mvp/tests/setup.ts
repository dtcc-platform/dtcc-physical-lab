// Defensive test setup: some vitest + happy-dom + Node combinations (seen
// on Node 25.x) attach a *partial* `localStorage` to globalThis — the
// object exists but methods like `.clear`, `.setItem`, `.getItem`, and
// `.removeItem` are undefined or not functions. That shape breaks the
// storage.test.ts `beforeEach(() => localStorage.clear())` hook.
//
// A simple `typeof globalThis.localStorage === 'undefined'` check is not
// enough: the global is present, just broken. Instead we validate that
// every method the tests (and src/lib/storage.ts) actually call is a real
// function, and replace the whole thing with an in-memory shim when it's
// not. On well-behaved runtimes (Node 20-24 + happy-dom 20) no replacement
// happens.

function hasUsableStorage(candidate: unknown): candidate is Storage {
  if (!candidate || typeof candidate !== 'object') return false;
  const required = ['clear', 'getItem', 'setItem', 'removeItem'] as const;
  for (const name of required) {
    if (typeof (candidate as Record<string, unknown>)[name] !== 'function') return false;
  }
  return true;
}

if (!hasUsableStorage(globalThis.localStorage)) {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
    writable: true,
  });
}
