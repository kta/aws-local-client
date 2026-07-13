/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to "1" for E2E builds (see `npm run e2e:build`); loads the WDIO frontend plugin. */
  readonly VITE_E2E?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
