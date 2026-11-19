/** Build-time check (used by vite.config.ts): a prod build without a server URL would ship a dead Online button. */
export function assertProdServerUrl(env: Record<string, string | undefined>): void {
  if (env.VITE_APP_ENV === "prod" && !env.VITE_SERVER_URL?.trim()) {
    throw new Error(
      'Prod build requires VITE_SERVER_URL (VITE_APP_ENV=prod but it is empty/unset). Set the repository variable SERVER_URL to the deployed Worker URL, or use "self".',
    );
  }
}
