import { getStore } from "../../../lib/store";
import { getBundle, publicFeed } from "../../../lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public and identical for everyone, so Vercel's CDN can hold it for a second.
// That is what keeps a few hundred phones polling from turning into a few
// hundred function calls a second.
const CACHED = {
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=0, s-maxage=1, stale-while-revalidate=4",
  "CDN-Cache-Control": "public, s-maxage=1, stale-while-revalidate=4",
};

const LIVE = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export async function GET() {
  const store = getStore();
  if (!store) {
    return new Response(JSON.stringify({ error: "De database is nog niet gekoppeld.", code: "no_database" }), {
      status: 503,
      headers: LIVE,
    });
  }
  try {
    const bundle = await getBundle(store);
    return new Response(JSON.stringify({ ...publicFeed(bundle), db: store.kind }), { status: 200, headers: CACHED });
  } catch (error) {
    console.error("feed failed", error);
    return new Response(JSON.stringify({ error: "Kan de database niet bereiken.", code: "db_error" }), {
      status: 503,
      headers: LIVE,
    });
  }
}
