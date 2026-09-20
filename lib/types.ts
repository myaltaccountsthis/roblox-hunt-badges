export type BadgeData = {
  id: number; name: string; description: string | null; enabled: boolean; created: string; updated: string;
  statistics: { awardedCount: number; pastDayAwardedCount: number; winRatePercentage: number };
  awardingUniverse: { id: number; name: string; rootPlaceId: number };
};
export type BadgeRow = {
  badgeId: string | null; badgeName: string; game: string; universeId: string; rootPlaceId: string; year: number | null;
  group: string; status: string; note: string; checkedAt: string; badgeUrl: string | null; gameUrl: string;
  pinned?: boolean; isNewest?: boolean; catalogCount?: number; created?: string | null; discoveryError?: string | null;
  data?: BadgeData | null; fetchedAt?: string | null; stale?: boolean; error?: string | null;
};
export type Snapshot = { checkedAt: string; catalogCheckedAt: string; badges: BadgeRow[]; icons?: Record<string, string> };
export type Preference = { badgeId: string; confirmed: boolean };
