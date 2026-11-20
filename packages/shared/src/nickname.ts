/** Nickname sanitizing, shared by client and server. Pure: the fallback is injected. */
export function sanitizeNickname(raw: string, randomNick: () => string): string {
  const clean = raw.replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 12);
  return clean || randomNick();
}
