import { NextResponse } from "next/server";
import { getStore } from "../../../lib/store";
import { performAction } from "../../../lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request) {
  const store = getStore();
  if (!store) {
    return NextResponse.json({ error: "De database is nog niet gekoppeld.", code: "no_database" }, { status: 503, headers: NO_STORE });
  }
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Ongeldig verzoek.", code: "invalid" }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await performAction(store, body);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error && error.isGameError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
    }
    console.error("action failed", error);
    return NextResponse.json({ error: "Er ging iets mis op de server. Probeer het opnieuw.", code: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
