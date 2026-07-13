import { beforeEach } from "vitest";

// jsdom in this environment does not expose a working localStorage, so provide a
// minimal in-memory polyfill on both globalThis and window for tests.
function createLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  };
}

const g = globalThis as typeof globalThis & { window?: Window };

function installLocalStorage() {
  const ls = createLocalStorage();
  Object.defineProperty(g, "localStorage", { value: ls, configurable: true, writable: true });
  if (g.window) {
    Object.defineProperty(g.window, "localStorage", { value: ls, configurable: true, writable: true });
  }
}

installLocalStorage();

beforeEach(() => {
  installLocalStorage();
});
