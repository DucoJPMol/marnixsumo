// Shared between the server and the phones. Both sides compute balances with
// the same functions, so what a phone shows always matches what the server allows.

export const COIN = "MX";
export const START = 50;
export const MIN_BET = 1;
export const MIN_ROSTER = 4;
export const MAX_ROSTER = 32;
export const MAX_NAME = 18;
export const CHAMP = "champ";
export const PLAYER_PIN = /^\d{4}$/;
export const MASTER_PIN = /^\d{4,8}$/;

// Geldbedragen worden niet afgerond; alleen de weergave wordt op twee
// decimalen gezet, met een Nederlandse komma.
export const EPS = 1e-9;

export function amount(n) {
  const v = Number(n) || 0;
  const rounded = Math.round(v * 100) / 100;
  return rounded.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
}

export function mx(n) {
  return `${amount(n)} ${COIN}`;
}

export function floor2(n) {
  return Math.floor((Number(n) || 0) * 100) / 100;
}

export function cleanName(name) {
  return String(name || "").trim().replace(/\s+/g, " ");
}

export function nameKey(name) {
  return cleanName(name).toLowerCase();
}

// Standard tournament seeding: 1 meets the lowest seed, and the top two seeds
// can only meet in the final. [1,2] -> [1,4,2,3] -> [1,8,4,5,2,7,3,6] -> ...
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const round = order.length * 2;
    const next = [];
    for (const seed of order) {
      next.push(seed);
      next.push(round + 1 - seed);
    }
    order = next;
  }
  return order;
}

function roundName(playersLeft, index) {
  if (playersLeft <= 2) return "Finale";
  if (playersLeft <= 4) return "Halve finale";
  if (playersLeft <= 8) return "Kwartfinale";
  return `Ronde ${index + 1}`;
}

// Single elimination for any roster size. Byes go to the top seeds and land on
// opposite sides of the draw. Returns matches in playing order, numbered from 1.
export function buildBracket(n) {
  const count = Math.max(2, Math.floor(n) || 0);
  let size = 2;
  while (size < count) size *= 2;
  const byes = [];
  let slots = seedOrder(size).map((seed) => {
    if (seed <= count) return { slot: seed - 1 };
    return null;
  });
  slots.forEach((entry, i) => {
    const partner = slots[i % 2 === 0 ? i + 1 : i - 1];
    if (entry && !partner) byes.push(entry.slot);
  });

  const matches = [];
  let id = 1;
  let index = 0;
  while (slots.length > 1) {
    const label = roundName(slots.length, index);
    const next = [];
    for (let i = 0; i < slots.length; i += 2) {
      const a = slots[i];
      const b = slots[i + 1];
      if (a && b) {
        matches.push({ id, round: label, a, b });
        next.push({ match: id });
        id += 1;
      } else {
        next.push(a || b);
      }
    }
    slots = next;
    index += 1;
  }
  return { n: count, size, matches, byes, finalId: matches.length };
}

export function bracketFor(state) {
  return buildBracket(state && state.slots ? state.slots.length : 0);
}

export function matchById(bracket, id) {
  return bracket.matches[id - 1] || null;
}

export function winnerOf(state, id) {
  const settled = state && state.settled ? state.settled[id] : null;
  return settled ? settled.w : null;
}

export function resolveSource(bracket, state, src) {
  if (!src || !state || !state.slots) return null;
  if (src.slot !== undefined) return state.slots[src.slot] || null;
  return winnerOf(state, src.match);
}

export function boutScore(state, id) {
  const list = (state && state.bouts && state.bouts[id]) || [];
  let a = 0;
  let b = 0;
  list.forEach((x) => {
    if (x === "a") a += 1;
    else if (x === "b") b += 1;
  });
  return { a, b, list };
}

export function matchStatus(bracket, state, id) {
  if (winnerOf(state, id)) return "done";
  const match = matchById(bracket, id);
  if (!match) return "tbd";
  const pa = resolveSource(bracket, state, match.a);
  const pb = resolveSource(bracket, state, match.b);
  if (!pa || !pb) return "tbd";
  return state.locks && state.locks[id] ? "closed" : "open";
}

// The next match that still needs a result. Matches are played in this order.
export function currentMatchId(bracket, state) {
  for (const match of bracket.matches) {
    if (!winnerOf(state, match.id)) return match.id;
  }
  return null;
}

export function eventStarted(state) {
  return !!(state && state.locks && Object.keys(state.locks).length > 0);
}

export function champOpen(state) {
  return !!(state && state.slots) && !eventStarted(state) && !(state.settled && state.settled[CHAMP]);
}

export function phaseOf(bracket, state) {
  if (!state || !state.slots) return "setup";
  if (state.settled && state.settled[CHAMP]) return "done";
  if (!eventStarted(state)) return "predictions";
  return "live";
}

// A bet blob is kept small on purpose: { b: { "3": ["pid", 5] }, c: ["pid", 8], x: 1 }
export function parseBlob(raw) {
  if (!raw) return { b: {}, c: null };
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return { b: value.b || {}, c: value.c || null };
  } catch (error) {
    return { b: {}, c: null };
  }
}

export function betsOf(blob) {
  const out = {};
  Object.entries(blob.b || {}).forEach(([key, bet]) => {
    if (Array.isArray(bet) && bet[1] > 0) out[key] = { pick: bet[0], amt: Number(bet[1]) || 0 };
  });
  if (Array.isArray(blob.c) && blob.c[1] > 0) out[CHAMP] = { pick: blob.c[0], amt: Number(blob.c[1]) || 0 };
  return out;
}

export function payoutFor(settled, bet) {
  if (!settled || !bet) return 0;
  if (!settled.win) return bet.amt; // niemand had de winnaar: iedereen krijgt zijn inzet terug
  // Exact aandeel in de pot, zonder afronding. De uitbetalingen samen zijn
  // precies de pot, dus er blijft nooit MX achter.
  return bet.pick === settled.w ? (bet.amt * settled.pool) / settled.win : 0;
}

// Everything about a player's money is derived from their own bets plus the
// settled results, so an undo on the master screen rewinds balances correctly.
export function financeOf(state, blob) {
  const bets = betsOf(blob);
  const settledAll = (state && state.settled) || {};
  const results = {};
  let staked = 0;
  let returned = 0;
  let reserved = 0;
  Object.entries(bets).forEach(([key, bet]) => {
    staked += bet.amt;
    const settled = settledAll[key];
    if (settled) {
      const payout = payoutFor(settled, bet);
      returned += payout;
      results[key] = { ...bet, payout, net: payout - bet.amt, refund: !settled.win, winner: settled.w };
    } else {
      reserved += bet.amt;
    }
  });
  const balance = START - staked + returned;
  return {
    bets,
    results,
    reserved,
    balance,
    total: balance + reserved,
    score: balance + reserved,
  };
}

export function marketKeys(bracket) {
  return [CHAMP, ...bracket.matches.map((m) => String(m.id))];
}

// Live totals per market, built from every player's bets.
export function poolsFrom(blobs) {
  const pools = {};
  const add = (key, pick, amt) => {
    if (!pick || !amt) return;
    const market = pools[key] || (pools[key] = { sides: {}, total: 0, bets: 0 });
    market.sides[pick] = (market.sides[pick] || 0) + amt;
    market.total += amt;
    market.bets += 1;
  };
  blobs.forEach((blob) => {
    Object.entries(blob.b || {}).forEach(([key, bet]) => {
      if (Array.isArray(bet)) add(key, bet[0], Number(bet[1]) || 0);
    });
    if (Array.isArray(blob.c)) add(CHAMP, blob.c[0], Number(blob.c[1]) || 0);
  });
  return pools;
}

export function poolOf(pools, key) {
  return (pools && pools[String(key)]) || { sides: {}, total: 0, bets: 0 };
}

// Parimutuel: the whole pool is split across the winning side.
export function oddsFor(pool, pick) {
  const backing = pool.sides[pick] || 0;
  if (!backing || !pool.total) return null;
  return pool.total / backing;
}

export function projectedReturn(pool, pick, amt, previous) {
  const stake = Math.max(0, Number(amt) || 0);
  if (!stake) return 0;
  const drop = previous && previous.pick ? previous.amt : 0;
  const total = pool.total - drop + stake;
  const side = (pool.sides[pick] || 0) - (previous && previous.pick === pick ? previous.amt : 0) + stake;
  if (!side) return 0;
  return (stake * total) / side;
}

// Aan het eind van de avond: alles boven de 50 MX is winst in biertjes, alles
// eronder een schuld. Eén MX is één biertje, en er wordt niet afgerond: wie op
// 50,4 eindigt staat op 0,4 biertje. Hoe je dat aan de bar oplost is aan jullie.
const DUST = 0.005; // kleiner dan wat op twee decimalen te zien is

export function beerLabel(n) {
  const size = Math.abs(Number(n) || 0);
  return `${amount(size)} ${Math.abs(size - 1) < 1e-9 ? "biertje" : "biertjes"}`;
}

// De MX in het spel zijn samen altijd 50 per persoon, dus wat de winnaars
// krijgen is precies wat de verliezers betalen.
export function beerSettlement(rows) {
  const people = rows
    .map((row) => ({ name: row.name, score: row.score, beers: row.score - START }))
    .sort((a, b) => b.beers - a.beers || a.name.localeCompare(b.name));

  const winners = people
    .filter((p) => p.beers > DUST)
    .map((p) => ({ name: p.name, left: p.beers }));
  const losers = people
    .filter((p) => p.beers < -DUST)
    .map((p) => ({ name: p.name, left: -p.beers }))
    .sort((a, b) => b.left - a.left || a.name.localeCompare(b.name));

  // Grootste schuld tegen grootste tegoed: zo min mogelijk rondjes lopen.
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < losers.length && j < winners.length) {
    const beers = Math.min(losers[i].left, winners[j].left);
    if (beers > DUST) transfers.push({ from: losers[i].name, to: winners[j].name, beers });
    losers[i].left -= beers;
    winners[j].left -= beers;
    if (losers[i].left <= DUST) i += 1;
    if (winners[j].left <= DUST) j += 1;
  }

  return {
    people,
    transfers,
    total: transfers.reduce((sum, t) => sum + t.beers, 0),
    winners: winners.length,
    losers: losers.length,
  };
}

export function rankPlayers(people) {
  return [...people].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
