import { configure } from "@testing-library/dom";
import { beforeEach } from "vitest";

// With 16 services' test files now running in parallel, Testing Library's
// default 1000ms async utility timeout is occasionally exceeded on a loaded
// CI box (findBy*/waitFor racing a modal mount), producing spurious failures.
// Raise it so async queries tolerate contention without weakening assertions.
configure({ asyncUtilTimeout: 5000 });

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
