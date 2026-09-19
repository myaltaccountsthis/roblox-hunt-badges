import { applySelections, getSnapshot, validateSelections } from '@/lib/tracker';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try { return Response.json(await getSnapshot(new URL(request.url).searchParams.get('force') === '1'), { headers }); }
  catch { return Response.json({ error: 'Refresh failed. Try again shortly.' }, { status: 502, headers }); }
}

export async function POST(request: Request) {
  let selections;
  try {
    const body = await request.text();
    if (body.length > 4096) throw new Error('Too many badge choices');
    selections = validateSelections(JSON.parse(body).selections);
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Invalid badge choices' }, { status: 400, headers }); }
  try {
    const snapshot = await getSnapshot(new URL(request.url).searchParams.get('force') === '1');
    return Response.json(await applySelections(snapshot, selections), { headers });
  } catch { return Response.json({ error: 'Refresh failed. Try again shortly.' }, { status: 502, headers }); }
}
