import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { K } from "./keys";
import { getBundle, dropBundle, patchBundle, personalFor } from "./cache";
import {
  CHAMP,
  MIN_BET,
  MIN_ROSTER,
  MAX_ROSTER,
  MAX_NAME,
  PLAYER_PIN,
  MASTER_PIN,
  buildBracket,
  bracketFor,
  matchById,
  resolveSource,
  matchStatus,
  currentMatchId,
  winnerOf,
  eventStarted,
  champOpen,
  cleanName,
  nameKey,
  parseBlob,
  financeOf,
  mx,
} from "./bracket";

const MAX_FAILS = 10;
const FAIL_WINDOW = 600;
const LOCK_MS = 4000;
const LOCK_WAIT_MS = 2500;

export class GameError extends Error {
  constructor(message, status = 400, code = "invalid") {
    super(message);
    this.status = status;
    this.code = code;
    this.isGameError = true;
  }
}

const hex = (bytes) => randomBytes(bytes).toString("hex");
const newPin = () => String(randomInt(1000, 10000));

function samePin(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

async function withLock(store, key, fn) {
  const owner = hex(8);
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (!(await store.lock(key, owner, LOCK_MS))) {
    if (Date.now() > deadline) throw new GameError("Nog bezig met je vorige tik. Probeer het opnieuw.", 429, "busy");
    await new Promise((resolve) => setTimeout(resolve, 40 + randomInt(60)));
  }
  try {
    return await fn();
  } finally {
    try {
      await store.del(key);
    } catch (error) {
      // The lock clears itself after a few seconds anyway.
    }
  }
}

async function guardFails(store, key, message) {
  const fails = Number((await store.get(key)) || 0);
  if (fails >= MAX_FAILS) throw new GameError(message, 429, "locked_out");
}

async function noteFail(store, key) {
  await store.incr(key);
  await store.expire(key, FAIL_WINDOW);
}

async function bump(store) {
  await store.incr(K.ver);
  dropBundle();
}

// One round trip for the bet plus the version bump that tells every phone to refresh.
async function saveBets(store, uid, blob) {
  await store.writeBatch([
    ["hset", K.bets, uid, JSON.stringify(blob)],
    ["incr", K.ver],
  ]);
  patchBundle((bundle) => {
    bundle.blobs[uid] = blob;
  });
}

async function readState(store) {
  return parseJson(await store.get(K.state));
}

async function authenticate(store, token) {
  if (typeof token !== "string" || token.length < 16 || token.length > 120) {
    throw new GameError("Log in om in te zetten.", 401, "auth");
  }
  const bundle = await getBundle(store);
  let uid = bundle.tokens[token];
  if (!uid) uid = await store.hget(K.tokens, token); // just-created token, not in the cache yet
  if (!uid) throw new GameError("Je bent uitgelogd. Log in met je gebruikersnaam en pincode.", 401, "auth");
  return uid;
}

/* ---------------------------------------------------------------- accounts */

async function signUp(store, body) {
  const name = cleanName(body.name);
  if (!name) throw new GameError("Vul een gebruikersnaam in.");
  if (name.length > MAX_NAME) throw new GameError(`Houd het op maximaal ${MAX_NAME} tekens.`);
  const key = nameKey(name);
  const uid = hex(6);
  if (!(await store.hsetnx(K.names, key, uid))) {
    throw new GameError("Die gebruikersnaam is al bezet. Log in met de pincode of kies een andere.", 409, "taken");
  }
  const pin = newPin();
  await store.hset(K.users, uid, JSON.stringify({ name, pin, at: Date.now() }));
  const token = hex(24);
  await store.hset(K.tokens, token, uid);
  await store.incr(K.ver);
  patchBundle((bundle) => {
    bundle.nicks[uid] = name;
    bundle.tokens[token] = uid;
  });
  const state = await readState(store);
  return { token, uid, name, pin, created: true, me: personalPayload(state, parseBlob(null)) };
}

async function logIn(store, body) {
  const name = cleanName(body.name);
  const pin = String(body.pin || "");
  if (!name) throw new GameError("Vul je gebruikersnaam in.");
  if (!PLAYER_PIN.test(pin)) throw new GameError("Je pincode bestaat uit 4 cijfers.");
  const key = nameKey(name);
  const uid = await store.hget(K.names, key);
  if (!uid) throw new GameError("Er is nog geen account met die gebruikersnaam.", 404, "no_account");
  await guardFails(store, K.loginFails(key), "Te vaak een verkeerde pincode. Wacht 10 minuten of vraag de organisator.");
  const record = parseJson(await store.hget(K.users, uid));
  if (!record || !samePin(pin, record.pin)) {
    await noteFail(store, K.loginFails(key));
    throw new GameError("Verkeerde pincode bij die gebruikersnaam.", 403, "pin");
  }
  await store.del(K.loginFails(key));
  const token = hex(24);
  await store.hset(K.tokens, token, uid);
  patchBundle((bundle) => {
    bundle.tokens[token] = uid;
    bundle.ver -= 1; // a new login changes nothing anyone else can see
  });
  const [state, blob] = await Promise.all([readState(store), store.hget(K.bets, uid)]);
  return { token, uid, name: record.name, pin: record.pin, me: personalPayload(state, parseBlob(blob)) };
}

async function session(store, body) {
  const uid = await authenticate(store, body.token);
  const bundle = await getBundle(store);
  const me = personalFor(bundle, uid);
  if (body.pin) {
    const record = parseJson(await store.hget(K.users, uid));
    if (record) me.pin = record.pin;
  }
  return { me };
}

/* ------------------------------------------------------------------- bets */

function marketLabel(key) {
  return key === CHAMP ? "de kampioensvoorspelling" : `match ${key}`;
}

function assertMarketOpen(bracket, state, key) {
  if (key === CHAMP) {
    if (!champOpen(state)) throw new GameError("De kampioensvoorspelling is gesloten toen het toernooi begon.", 409, "closed");
    return;
  }
  const status = matchStatus(bracket, state, Number(key));
  if (status === "tbd") throw new GameError("Inzetten kan zodra beide worstelaars bekend zijn.", 409, "closed");
  if (status !== "open") throw new GameError(`Inzetten op ${marketLabel(key)} is gesloten.`, 409, "closed");
}

function assertPick(bracket, state, key, pick) {
  if (key === CHAMP) {
    if (!state.slots.includes(pick)) throw new GameError("Kies iemand die meedoet.");
    return;
  }
  const match = matchById(bracket, Number(key));
  const pa = resolveSource(bracket, state, match.a);
  const pb = resolveSource(bracket, state, match.b);
  if (pick !== pa && pick !== pb) throw new GameError("Kies een van de twee worstelaars.");
}

// Handed straight back after a write so the phone never shows a stale balance.
function personalPayload(state, blob) {
  const finance = financeOf(state || {}, blob);
  return {
    blob,
    bets: finance.bets,
    results: finance.results,
    balance: finance.balance,
    reserved: finance.reserved,
    score: finance.score,
  };
}

async function placeBet(store, body) {
  const uid = await authenticate(store, body.token);
  const key = body.market === CHAMP ? CHAMP : String(Number(body.market));
  const amt = Math.floor(Number(body.amt));
  const pick = String(body.pick || "");
  if (!Number.isFinite(amt) || amt < 0) throw new GameError("Vul een heel aantal MX in.");

  // A quick look at the shared snapshot first: anything obviously closed or
  // unaffordable is refused here, without a lock or a single extra read.
  const snapshot = await getBundle(store);
  if (snapshot.state && snapshot.state.slots) {
    const known = bracketFor(snapshot.state);
    if (key !== CHAMP && !matchById(known, Number(key))) throw new GameError("Die match bestaat niet.");
    assertMarketOpen(known, snapshot.state, key);
  }

  return withLock(store, K.userLock(uid), async () => {
    const [stateRaw, blobRaw] = await store.batch([
      ["get", K.state],
      ["hget", K.bets, uid],
    ]);
    const state = parseJson(stateRaw);
    if (!state || !state.slots) throw new GameError("Het schema is nog niet geloot.", 409, "closed");
    const bracket = bracketFor(state);
    if (key !== CHAMP && !matchById(bracket, Number(key))) throw new GameError("Die match bestaat niet.");
    assertMarketOpen(bracket, state, key);

    const blob = parseBlob(blobRaw);
    const finance = financeOf(state, blob);
    const existing = finance.bets[key];

    if (amt === 0) {
      if (key === CHAMP) blob.c = null;
      else delete blob.b[key];
      await saveBets(store, uid, blob);
      return { ok: true, removed: true, me: personalPayload(state, blob) };
    }

    assertPick(bracket, state, key, pick);
    if (amt < MIN_BET) throw new GameError(`De minimale inzet is ${mx(MIN_BET)}.`);
    const available = finance.balance + (existing ? existing.amt : 0);
    if (amt > available) throw new GameError(`Je hebt nog ${mx(Math.max(0, available))}.`, 400, "funds");

    if (key === CHAMP) blob.c = [pick, amt];
    else blob.b[key] = [pick, amt];
    await saveBets(store, uid, blob);
    return { ok: true, me: personalPayload(state, blob) };
  });
}

/* ----------------------------------------------------------------- master */

function validateRoster(names) {
  const list = Array.isArray(names) ? names.map(cleanName).filter(Boolean) : [];
  if (list.length < MIN_ROSTER) throw new GameError(`Vul minstens ${MIN_ROSTER} worstelaars in.`);
  if (list.length > MAX_ROSTER) throw new GameError(`Dat zijn er meer dan ${MAX_ROSTER}.`);
  const long = list.find((n) => n.length > MAX_NAME);
  if (long) throw new GameError(`Kort "${long}" in tot maximaal ${MAX_NAME} tekens.`);
  const seen = new Set();
  for (const n of list) {
    const key = n.toLowerCase();
    if (seen.has(key)) throw new GameError(`Twee worstelaars heten ${n}. Zet er een letter achter.`);
    seen.add(key);
  }
  return list;
}

function applySetup(state, body) {
  const names = validateRoster(body.names);
  if (state && eventStarted(state)) {
    throw new GameError("Het toernooi is begonnen. Start een nieuw toernooi om opnieuw te loten.", 409, "started");
  }
  const previous = {};
  if (state && state.players) {
    Object.entries(state.players).forEach(([id, n]) => {
      previous[String(n).toLowerCase()] = id;
    });
  }
  const players = {};
  const ids = names.map((n) => {
    const id = previous[n.toLowerCase()] || `w${hex(3)}`;
    players[id] = n;
    return id;
  });
  const slots = ids.slice();
  if (body.shuffle) {
    for (let i = slots.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  }
  return {
    t: state && state.t ? state.t : hex(4),
    title: cleanName(body.title) || (state && state.title) || "Sumo pool",
    players,
    slots,
    bouts: {},
    locks: {},
    settled: {},
    log: [],
  };
}

function closeBetting(bracket, state, matchId) {
  const status = matchStatus(bracket, state, matchId);
  if (status === "done") throw new GameError("Die match is al beslist.", 409, "stale");
  if (status === "tbd") throw new GameError("Beide worstelaars moeten eerst bekend zijn.", 409);
  if (status === "closed") return false;
  state.locks = { ...(state.locks || {}), [matchId]: Date.now() };
  state.log = [...(state.log || []), { t: "close", m: matchId }];
  return true;
}

function sideWinner(bracket, state, matchId, side) {
  const match = matchById(bracket, matchId);
  if (!match) throw new GameError("Die match bestaat niet.");
  const pid = resolveSource(bracket, state, side === "a" ? match.a : match.b);
  if (!pid) throw new GameError("Beide worstelaars moeten eerst bekend zijn.", 409);
  return pid;
}

function freeze(blobs, key, winner) {
  let pool = 0;
  let win = 0;
  Object.values(blobs).forEach((raw) => {
    const blob = parseBlob(raw);
    const bet = key === CHAMP ? blob.c : blob.b[key];
    if (!Array.isArray(bet) || !bet[1]) return;
    pool += Number(bet[1]) || 0;
    if (bet[0] === winner) win += Number(bet[1]) || 0;
  });
  return { w: winner, pool, win };
}

// Recording a winner settles the pool from the bets as they actually stand, so
// balances update the moment the master taps a name.
async function recordWinner(store, state, bracket, matchId, side, rewindTo) {
  if (winnerOf(state, matchId)) throw new GameError("Die match is al beslist.", 409, "stale");
  const upNext = currentMatchId(bracket, state);
  if (upNext !== matchId) throw new GameError(`Match ${upNext} is eerst aan de beurt.`, 409, "order");
  const winner = sideWinner(bracket, state, matchId, side);
  closeBetting(bracket, state, matchId);

  const blobs = await store.hgetall(K.bets);
  const previousBouts = rewindTo || (state.bouts && state.bouts[matchId]) || [];
  const settled = { ...(state.settled || {}) };
  settled[matchId] = freeze(blobs, String(matchId), winner);
  const isFinal = matchId === bracket.finalId;
  if (isFinal) settled[CHAMP] = freeze(blobs, CHAMP, winner);
  state.settled = settled;

  const shown = [...((state.bouts && state.bouts[matchId]) || [])];
  while (shown.filter((x) => x === side).length < 2) shown.push(side);
  state.bouts = { ...(state.bouts || {}), [matchId]: shown };
  state.log = [...(state.log || []), { t: "win", m: matchId, b: previousBouts, c: isFinal }];
  return true;
}

async function recordBout(store, state, bracket, matchId, side, boutNo) {
  if (winnerOf(state, matchId)) throw new GameError("Die match is al beslist.", 409, "stale");
  const upNext = currentMatchId(bracket, state);
  if (upNext !== matchId) throw new GameError(`Match ${upNext} is eerst aan de beurt.`, 409, "order");
  closeBetting(bracket, state, matchId);
  const before = [...((state.bouts && state.bouts[matchId]) || [])];
  if (Number.isInteger(boutNo) && boutNo !== before.length + 1) {
    throw new GameError(`Ronde ${boutNo} staat er al in. Kijk even op het scherm.`, 409, "stale");
  }
  const list = [...before, side];
  state.bouts = { ...(state.bouts || {}), [matchId]: list };
  if (list.filter((x) => x === side).length >= 2) {
    // The deciding bout and the result are one step, so one undo takes back both.
    await recordWinner(store, state, bracket, matchId, side, before);
  } else {
    state.log = [...(state.log || []), { t: "bout", m: matchId }];
  }
  return true;
}

function undoLast(state, logLength) {
  const log = state.log || [];
  if (log.length === 0) return false;
  if (Number.isInteger(logLength) && logLength !== log.length) {
    throw new GameError("Iemand anders heeft iets gewijzigd. Kijk op het scherm en probeer opnieuw.", 409, "stale");
  }
  const last = log[log.length - 1];
  state.log = log.slice(0, -1);
  if (last.t === "close") {
    const locks = { ...(state.locks || {}) };
    delete locks[last.m];
    state.locks = locks;
  }
  if (last.t === "bout") {
    const bouts = { ...(state.bouts || {}) };
    bouts[last.m] = (bouts[last.m] || []).slice(0, -1);
    state.bouts = bouts;
  }
  if (last.t === "win") {
    const settled = { ...(state.settled || {}) };
    delete settled[last.m];
    if (last.c) delete settled[CHAMP];
    state.settled = settled;
    state.bouts = { ...(state.bouts || {}), [last.m]: last.b || [] };
  }
  return true;
}

async function playerDirectory(store) {
  const users = await store.hgetall(K.users);
  const list = [];
  Object.entries(users).forEach(([uid, raw]) => {
    const rec = parseJson(raw);
    if (rec && rec.name) list.push({ uid, name: rec.name, pin: rec.pin });
  });
  list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

async function setPlayerPin(store, body) {
  const uid = String(body.uid || "");
  const record = parseJson(await store.hget(K.users, uid));
  if (!record) throw new GameError("Die speler bestaat niet.", 404);
  const pin = body.newPin ? String(body.newPin) : newPin();
  if (!PLAYER_PIN.test(pin)) throw new GameError("Een pincode bestaat uit 4 cijfers.");
  await store.hset(K.users, uid, JSON.stringify({ ...record, pin }));
  await store.del(K.loginFails(nameKey(record.name)));
  return { ok: true, uid, name: record.name, pin };
}

async function master(store, body) {
  const type = body.type;
  const pin = String(body.pin || "");
  const stored = await store.get(K.masterPin);
  let claim = async () => {};
  if (stored) {
    await guardFails(store, K.masterFails, "Te vaak een verkeerde pincode. Wacht 10 minuten.");
    if (!samePin(pin, stored)) {
      await noteFail(store, K.masterFails);
      throw new GameError("Die masterpincode klopt niet.", 403, "pin");
    }
  } else {
    if (!MASTER_PIN.test(pin)) throw new GameError("Kies een masterpincode van 4 tot 8 cijfers.", 400, "pin_format");
    if (type !== "master:setup" && !(await store.get(K.state))) {
      throw new GameError("Er is nog geen toernooi aangemaakt.", 409, "no_tournament");
    }
    // The PIN is only claimed once the action itself works, so a typo on a
    // rejected first attempt doesn't lock in the wrong master PIN.
    claim = async () => {
      if (!(await store.setIfAbsent(K.masterPin, pin)) && !samePin(pin, await store.get(K.masterPin))) {
        throw new GameError("Iemand anders heeft de masterpincode al ingesteld.", 403, "pin");
      }
    };
  }

  if (type === "master:verify") {
    await claim();
    return { ok: true };
  }
  if (type === "master:players") {
    const players = await playerDirectory(store);
    await claim();
    return { players };
  }
  if (type === "master:playerPin") {
    await claim();
    return setPlayerPin(store, body);
  }

  return withLock(store, K.masterLock, async () => {
    const state = await readState(store);
    let next = state ? JSON.parse(JSON.stringify(state)) : null;
    let changed = false;

    if (type === "master:setup") {
      next = applySetup(state, body);
      changed = true;
    } else {
      if (!next || !next.slots) throw new GameError("Loot eerst het schema.", 409);
      const bracket = bracketFor(next);
      const matchId = Number(body.match);
      if (type === "master:close") changed = closeBetting(bracket, next, matchId);
      else if (type === "master:bout") {
        if (body.side !== "a" && body.side !== "b") throw new GameError("Kies wie de ronde won.");
        changed = await recordBout(store, next, bracket, matchId, body.side, Number(body.boutNo));
      } else if (type === "master:winner") {
        if (body.side !== "a" && body.side !== "b") throw new GameError("Kies de winnaar.");
        changed = await recordWinner(store, next, bracket, matchId, body.side);
      } else if (type === "master:undo") changed = undoLast(next, Number(body.logLength));
      else if (type === "master:reset") {
        next = { t: hex(4), title: next.title, players: next.players, slots: null, bouts: {}, locks: {}, settled: {}, log: [] };
        changed = true;
      } else throw new GameError("Onbekende masteractie.");
    }

    if (!changed) {
      await claim();
      return { ok: true, changed: false };
    }
    await claim();
    next.rev = ((state && state.rev) || 0) + 1;
    await store.set(K.state, JSON.stringify(next));
    if (type === "master:reset" || type === "master:setup") {
      if (type === "master:reset") await store.del(K.bets);
    }
    await bump(store);
    return { ok: true, changed: true };
  });
}

/* --------------------------------------------------------------- dispatch */

export async function performAction(store, body) {
  if (!body || typeof body !== "object") throw new GameError("Ongeldig verzoek.");
  const type = String(body.type || "");
  if (type === "signup") return signUp(store, body);
  if (type === "login") return logIn(store, body);
  if (type === "session") return session(store, body);
  if (type === "bet") return placeBet(store, body);
  if (type.startsWith("master:")) return master(store, body);
  throw new GameError("Onbekende actie.");
}

export { buildBracket };
