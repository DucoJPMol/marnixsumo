import { getStore } from "../../../lib/store";
import { getBundle, fullBoard } from "../../../lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The whole ranking, fetched only while someone has the ranking open.
const CACHED = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=0, s-maxage=3, stale-while-revalidate=10",
  "CDN-Cache-Control": "public, s-maxage=3, stale-while-revalidate=10",
};

export async function GET() {
  const store = getStore();
  if (!store) {
    return new Response(JSON.stringify({ board: [], stats: { players: 0 } }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const bundle = await getBundle(store);
  return new Response(JSON.stringify(fullBoard(bundle)), { status: 200, headers: CACHED });
}
