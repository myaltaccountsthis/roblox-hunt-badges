export type AwardActivity = { id: string; badgeId: string; game: string; badgeName: string; previous: number; current: number; timestamp: number };

export function shouldReportAward(previous: number | undefined, current: number, threshold: number) {
  return previous !== undefined && ((previous < threshold && current > threshold) || (current > previous && current <= threshold));
}

export function readActivity(value: unknown): AwardActivity[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is AwardActivity => !!entry && typeof entry === 'object'
    && typeof entry.id === 'string' && typeof entry.badgeId === 'string' && /^[1-9]\d{0,19}$/.test(entry.badgeId)
    && typeof entry.game === 'string' && typeof entry.badgeName === 'string'
    && Number.isFinite(entry.previous) && entry.previous >= 0 && Number.isFinite(entry.current) && entry.current > entry.previous
    && Number.isFinite(entry.timestamp) && entry.timestamp > 0);
}

export function pruneActivity(entries: AwardActivity[], now = Date.now()) {
  return entries.filter(entry => entry.timestamp >= now - 60 * 60 * 1000);
}
