import { configure } from "@testing-library/dom";
import { beforeEach } from "vitest";

// With 16 services' test files now running in parallel, Testing Library's
// default 1000ms async utility timeout is occasionally exceeded when a vitest
// fork is CPU-starved (findBy*/waitFor racing a synchronous modal mount),
// producing spurious failures. Raise it generously so async queries tolerate
// contention without weakening assertions (components render synchronously;
// this only absorbs scheduler starvation).
configure({ asyncUtilTimeout: 15000 });

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
