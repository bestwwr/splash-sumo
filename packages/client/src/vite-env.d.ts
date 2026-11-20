/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "self" = same origin as the page; a URL = that server; unset = <page host>:8787. */
  readonly VITE_SERVER_URL?: string;
  /** "staging" shows a TEST badge on every screen. */
  readonly VITE_APP_ENV?: string;
}
