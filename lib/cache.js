import { K } from "./keys";
import { bracketFor, parseBlob, poolsFrom, financeOf, rankPlayers, phaseOf, currentMatchId } from "./bracket";

// One bundle is built per server instance and shared by every request that
// instance handles. A bundle is served without touching Redis for HOLD_MS, then
// a single version check decides whether anything needs re-reading. With the
// CDN caching /api/feed on top of this, 140 phones cost a handful of commands
// per second no matter how fast they poll.
const HOLD_MS = 800;
const BOARD_SIZE = 25;

function emptyBundle(ver) {
  return { ver, state: null, blobs: {}, nicks: {}, tokens: {}, at: Date.now() };
}

function decorate(bundle) {
  const state = bundle.state;
  const bracket = bracketFor(state || {});
  const blobs = bundle.blobs;
  const pools = poolsFrom(Object.values(blobs));
  const people = [];
  let staked = 0;
  Object.entries(bundle.nicks).forEach(([uid, name]) => {
    const finance = financeOf(state || {}, blobs[uid] || parseBlob(null));
    staked += finance.reserved;
    people.push({ uid, name, score: finance.score, balance: finance.balance, reserved: finance.reserved });
  });
  const ranked = rankPlayers(people);
  bundle.bracket = bracket;
  bundle.pools = pools;
  bundle.ranked = ranked;
  bundle.stats = { players: ranked.length, staked, pot: Object.values(pools).reduce((sum, p) => sum + p.total, 0) };
  bundle.phase = phaseOf(bracket, state);
  bundle.current = state && state.slots ? currentMatchId(bracket, state) : null;
  return bundle;
}

async function readAll(store, ver) {
  const [stateRaw, betsRaw, usersRaw, tokensRaw, masterPin] = await store.batch([
    ["get", K.state],
    ["hgetall", K.bets],
    ["hgetall", K.users],
    ["hgetall", K.tokens],
    ["get", K.masterPin],
  ]);
  const bundle = emptyBundle(ver);
  try {
    bundle.state = stateRaw ? JSON.parse(stateRaw) : null;
  } catch (error) {
    bundle.state = null;
  }
  Object.entries(betsRaw || {}).forEach(([uid, raw]) => {
    bundle.blobs[uid] = parseBlob(raw);
  });
  Object.entries(usersRaw || {}).forEach(([uid, raw]) => {
    try {
      const rec = JSON.parse(raw);
      if (rec && rec.name) bundle.nicks[uid] = rec.name;
    } catch (error) {
      // Skip an unreadable record rather than dropping the whole board.
    }
  });
  bundle.tokens = tokensRaw || {};
  bundle.masterSet = !!masterPin;
  return decorate(bundle);
}

export async function getBundle(store) {
  const cached = globalThis.__mxBundle;
  if (cached && Date.now() - cached.at < HOLD_MS) return cached;
  if (globalThis.__mxRefresh) return globalThis.__mxRefresh;

  const refresh = (async () => {
    const ver = Number((await store.get(K.ver)) || 0);
    const current = globalThis.__mxBundle;
    if (current && current.ver === ver) {
      current.at = Date.now();
      return current;
    }
    const bundle = await readAll(store, ver);
    globalThis.__mxBundle = bundle;
    return bundle;
  })().finally(() => {
    globalThis.__mxRefresh = null;
  });

  globalThis.__mxRefresh = refresh;
  return refresh;
}

// Called after a write that changes the tournament itself, which is rare.
// The next read on this instance rebuilds from scratch.
export function dropBundle() {
  globalThis.__mxBundle = null;
}

// Bets are frequent, and the instance that took the bet already knows exactly
// what changed. Folding the change into the cached bundle keeps the snapshot
// correct without re-reading everyone's bets from the database.
export function patchBundle(mutate) {
  const bundle = globalThis.__mxBundle;
  if (!bundle) return;
  try {
    mutate(bundle);
    bundle.ver += 1;
    bundle.at = Date.now();
    decorate(bundle);
  } catch (error) {
    globalThis.__mxBundle = null;
  }
}

export function publicFeed(bundle) {
  const state = bundle.state;
  const pools = {};
  Object.entries(bundle.pools).forEach(([key, pool]) => {
    pools[key] = { sides: pool.sides, total: pool.total, bets: pool.bets };
  });
  return {
    ver: bundle.ver,
    phase: bundle.phase,
    current: bundle.current,
    masterSet: !!bundle.masterSet,
    state: state
      ? {
          t: state.t,
          title: state.title || "Sumo pool",
          players: state.players,
          slots: state.slots,
          bouts: state.bouts || {},
          locks: state.locks || {},
          settled: state.settled || {},
          log: (state.log || []).slice(-1),
        }
      : null,
    pools,
    board: bundle.ranked.slice(0, BOARD_SIZE).map((p) => [p.name, p.score, p.reserved]),
    done: bundle.phase === "done",
    stats: bundle.stats,
  };
}

export function fullBoard(bundle) {
  return {
    ver: bundle.ver,
    board: bundle.ranked.map((p) => [p.name, p.score, p.reserved]),
    stats: bundle.stats,
  };
}

export function personalFor(bundle, uid) {
  const blob = bundle.blobs[uid] || parseBlob(null);
  const finance = financeOf(bundle.state || {}, blob);
  const rankIndex = bundle.ranked.findIndex((p) => p.uid === uid);
  return {
    uid,
    name: bundle.nicks[uid] || null,
    blob,
    bets: finance.bets,
    results: finance.results,
    balance: finance.balance,
    reserved: finance.reserved,
    score: finance.score,
    rank: rankIndex >= 0 ? rankIndex + 1 : null,
    players: bundle.ranked.length,
    ver: bundle.ver,
  };
}
