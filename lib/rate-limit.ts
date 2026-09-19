let nextAllowedAt = 0;

export function enforceGlobalRateLimit(windowMs = 5000) {
  const now = Date.now();
  if (now < nextAllowedAt) {
    const retryAfterMs = nextAllowedAt - now;
    return { ok: false as const, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  nextAllowedAt = now + windowMs;
  return { ok: true as const };
}
