import { validateBadge, validateSelections } from '@/lib/tracker';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
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
