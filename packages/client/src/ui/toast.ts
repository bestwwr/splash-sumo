/** Brief message at the top of the screen. */
export function toast(root: HTMLElement, text: string, ms = 2600): void {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  root.appendChild(el);
  window.setTimeout(() => el.remove(), ms);
}

/** Fixed TEST badge on staging builds. */
export function mountEnvBadge(root: HTMLElement, env: string | undefined = import.meta.env.VITE_APP_ENV): void {
  if (env !== "staging") return;
  const el = document.createElement("div");
  el.className = "env-badge";
  el.textContent = "TEST";
  root.appendChild(el);
}
