import { validateBadge, validateSelections } from '@/lib/tracker';
import { enforceGlobalRateLimit } from '@/lib/rate-limit';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  const limited = enforceGlobalRateLimit(5000);
  if (!limited.ok) return Response.json({ error: 'Rate limited. Please wait a moment before trying again.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limited.retryAfterSeconds) } });
  try {
    const body = await request.text();
    if (body.length > 512) throw new Error('Badge selection is too long');
    const [selection] = validateSelections([JSON.parse(body)]);
    const data = await validateBadge(selection.universeId, selection.badgeId);
    return Response.json({ data, fetchedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not verify that badge. Try again.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
}
