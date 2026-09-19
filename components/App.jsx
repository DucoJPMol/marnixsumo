"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHAMP,
  START,
  mx,
  amount,
  bracketFor,
  financeOf,
  parseBlob,
  cleanName,
  MAX_NAME,
} from "../lib/bracket";
import { Crest, Panel, local, STORE_KEYS, action, post } from "./ui";
import BetsTab from "./BetsTab";
import { BracketTab, RankTab, AccountTab } from "./Screens";
import MasterTab, { SetupForm } from "./MasterTab";
import SettlementTab from "./Settlement";

const FAST_MS = 3500; // something is happening
const SLOW_MS = 9000; // waiting around
const IDLE_MS = 25000; // phone in a pocket, screen still on
const IDLE_AFTER = 150000;

export default function App() {
  const [feed, setFeed] = useState(null);
  const [conn, setConn] = useState("start");
  const [me, setMe] = useState(null);
  const [blob, setBlob] = useState(() => parseBlob(null));
  const [rank, setRank] = useState({ rank: null, players: 0 });
  const [masterPin, setMasterPin] = useState("");
  const [tab, setTab] = useState("bets");
  const [busy, setBusy] = useState(false);
  const [masterError, setMasterError] = useState("");
  const [redraw, setRedraw] = useState(false);
  const verRef = useRef(-1);
  const tourRef = useRef(null);
  const busyRef = useRef(false);
  const feedRef = useRef(null);
  const settleSeen = useRef(false);
  const touched = useRef(Date.now());

  const logOut = useCallback(() => {
    [STORE_KEYS.token, STORE_KEYS.uid, STORE_KEYS.name, STORE_KEYS.pin].forEach(local.drop);
    setMe(null);
    setBlob(parseBlob(null));
    setRank({ rank: null, players: 0 });
  }, []);

  /* ------------------------------------------------------------ restore */

  useEffect(() => {
    const token = local.get(STORE_KEYS.token);
    const uid = local.get(STORE_KEYS.uid);
    const name = local.get(STORE_KEYS.name);
    if (token && uid && name) setMe({ token, uid, name, pin: local.get(STORE_KEYS.pin) || "" });
    const pin = local.get(STORE_KEYS.master);
    if (pin) {
      setMasterPin(pin);
      action({ type: "master:verify", pin }).catch((error) => {
        if (error.code === "pin") {
          local.drop(STORE_KEYS.master);
          setMasterPin("");
        }
      });
    }
    const mark = () => {
      touched.current = Date.now();
    };
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
    };
  }, []);

  /* --------------------------------------------------------- the feed */

  const pullFeed = useCallback(async () => {
    try {
      const res = await fetch("/api/feed", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setConn(data && data.code === "no_database" ? "no_database" : "offline");
        return null;
      }
      setConn("ok");
      if (data.ver !== verRef.current) {
        verRef.current = data.ver;
        setFeed(data);
      }
      return data;
    } catch (error) {
      setConn("offline");
      return null;
    }
  }, []);

  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);

  const pullMe = useCallback(async (token) => {
    const key = token || (me && me.token);
    if (!key) return;
    try {
      const data = await post("/api/me", { token: key });
      if (data && data.me) {
        setBlob(parseBlob(data.me.blob));
        setRank({ rank: data.me.rank, players: data.me.players });
      }
    } catch (error) {
      if (error.status === 401) logOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, logOut]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const beat = async () => {
      if (!alive) return;
      if (document.visibilityState === "visible") await pullFeed();
      if (!alive) return;
      const current = verRef.current >= 0 ? feedRef.current : null;
      const busyEvent = current && (current.phase === "live" || current.phase === "predictions");
      const idle = Date.now() - touched.current > IDLE_AFTER;
      const wait = document.visibilityState !== "visible" ? IDLE_MS : idle ? IDLE_MS : busyEvent ? FAST_MS : SLOW_MS;
      timer = setTimeout(beat, wait);
    };
    beat();
    const wake = () => {
      if (document.visibilityState === "visible") {
        touched.current = Date.now();
        pullFeed();
      }
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [pullFeed]);

  // A new tournament, or a login on another phone, resets what we hold locally.
  useEffect(() => {
    if (!feed || !feed.state || !me) return;
    if (tourRef.current !== feed.state.t) {
      tourRef.current = feed.state.t;
      pullMe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed && feed.state && feed.state.t, me && me.token]);

  useEffect(() => {
    if (!me) return undefined;
    pullMe();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") pullMe();
    }, 45000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me && me.token]);

  // Zodra de finale erop zit is de afrekening het eerste wat mensen willen zien.
  useEffect(() => {
    if (feed && feed.phase === "done" && !settleSeen.current) {
      settleSeen.current = true;
      setTab("afrekening");
    }
  }, [feed && feed.phase]);

  /* ------------------------------------------------------------- money */

  const state = feed ? feed.state : null;
  const bracket = useMemo(() => bracketFor(state || {}), [state]);
  const money = useMemo(() => {
    const finance = financeOf(state || {}, blob);
    return { ...finance, rank: rank.rank, players: rank.players };
  }, [state, blob, rank]);

  /* ------------------------------------------------------------ actions */

  const adopt = (data) => {
    local.set(STORE_KEYS.token, data.token);
    local.set(STORE_KEYS.uid, data.uid);
    local.set(STORE_KEYS.name, data.name);
    local.set(STORE_KEYS.pin, data.pin);
    setMe({ token: data.token, uid: data.uid, name: data.name, pin: data.pin });
    if (data.me) setBlob(parseBlob(data.me.blob));
    pullFeed();
  };

  const placeBet = async (market, pick, amt) => {
    if (!me) return "Log eerst in.";
    if (busyRef.current) return "Eén tik tegelijk.";
    busyRef.current = true;
    setBusy(true);
    try {
      const result = await action({ type: "bet", token: me.token, market, pick, amt });
      if (result.me) setBlob(parseBlob(result.me.blob));
      pullFeed();
      return null;
    } catch (error) {
      if (error.status === 401) logOut();
      pullFeed();
      return error.message;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const runMaster = async (type, payload, pinOverride) => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setMasterError("");
    try {
      const result = await action({ type, pin: pinOverride || masterPin, ...payload });
      await pullFeed();
      return result;
    } catch (error) {
      if (error.code === "pin" && !pinOverride) {
        local.drop(STORE_KEYS.master);
        setMasterPin("");
      }
      setMasterError(error.message);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const draw = async ({ names, pin, shuffle, title }) => {
    const use = state ? masterPin || pin : pin;
    const result = await runMaster("master:setup", { names, shuffle, title }, use);
    if (result) {
      if (use !== masterPin) {
        local.set(STORE_KEYS.master, use);
        setMasterPin(use);
      }
      setRedraw(false);
      setTab("master");
    }
  };

  const unlockMaster = async (pin) => {
    try {
      await action({ type: "master:verify", pin });
      local.set(STORE_KEYS.master, pin);
      setMasterPin(pin);
      setMasterError("");
      setTab("master");
      return null;
    } catch (error) {
      return error.message;
    }
  };

  /* -------------------------------------------------------------- views */

  const isMaster = !!masterPin;
  const hasBracket = !!(state && state.slots);
  const title = (state && state.title) || "Sumo pool";

  if (conn === "no_database") {
    return (
      <Shell title={title}>
        <Panel style={{ marginTop: "1.5rem" }}>
          <h3>De database is nog niet gekoppeld</h3>
          <p>
            Ga in het Vercel-project naar Storage, voeg Upstash for Redis toe, koppel het aan dit project en deploy opnieuw.
            Daarna werkt deze pagina meteen.
          </p>
        </Panel>
      </Shell>
    );
  }

  if (!feed) {
    return (
      <Shell title={title}>
        <p className="spinner">{conn === "offline" ? "Server niet bereikbaar. Nieuwe poging…" : "Laden…"}</p>
      </Shell>
    );
  }

  if (!me) {
    return (
      <Shell title={title} subtitle={hasBracket ? `${feed.stats.players} playing` : null}>
        <Gate onDone={adopt} />
      </Shell>
    );
  }

  const needsSetup = isMaster && (!hasBracket || redraw);
  const finished = feed.phase === "done";
  const tabs = [
    ["bets", feed.phase === "predictions" ? "Voorspellen" : "Live"],
    ["bracket", "Schema"],
    ["rank", "Stand"],
    ["me", "Account"],
  ];
  if (finished) tabs.splice(1, 0, ["afrekening", "Afrekening"]);
  if (isMaster) tabs.push(["master", "Master"]);
  const current = tabs.some(([key]) => key === tab) ? tab : "bets";

  return (
    <Shell title={title}>
      <div className="purse">
        <span className="who">
          <strong>{me.name}</strong>
          <span>
{money.rank ? `Plek ${money.rank} van ${money.players}` : "Welkom"}
          </span>
        </span>
        <span className="amount">
          <b>{amount(money.balance)}</b>
          <i>MX</i>
          <span>{money.reserved > 0 ? `${mx(money.reserved)} in het spel` : "te besteden"}</span>
        </span>
      </div>

      {conn === "offline" ? <div className="banner bad">Verbinding weg. Je ziet de laatste stand.</div> : null}
      {feed.db === "memory" ? <div className="banner">Lokale testmodus: gegevens verdwijnen als de server herstart.</div> : null}

      <div className="tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={current === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {needsSetup ? (
        <SetupForm feed={feed} needPin={false} busy={busy} error={masterError} onDraw={draw} />
      ) : !hasBracket ? (
        <>
          <Panel style={{ marginTop: "1rem" }}>
            <h3>Wachten op de loting</h3>
            <p>
              Je doet mee met {mx(START)}. De voorspelronde opent zodra de organisator het schema loot. Deze pagina ververst
              vanzelf.
            </p>
          </Panel>
          {!isMaster ? (
            <p className="centred" style={{ marginTop: "1.5rem" }}>
              <button type="button" className="link" onClick={() => setTab("unlock")}>
                Ik organiseer dit
              </button>
            </p>
          ) : null}
          {tab === "unlock" ? (
            feed.masterSet ? (
              <UnlockPanel unlock={unlockMaster} onCancel={() => setTab("bets")} />
            ) : (
              <SetupForm feed={feed} needPin busy={busy} error={masterError} onDraw={draw} />
            )
          ) : null}
        </>
      ) : (
        <>
          {current === "bets" ? (
            <BetsTab feed={feed} bracket={bracket} money={money} busy={busy} onPlace={placeBet} />
          ) : null}
          {current === "afrekening" ? <SettlementTab feed={feed} me={me} /> : null}
          {current === "bracket" ? <BracketTab feed={feed} bracket={bracket} /> : null}
          {current === "rank" ? <RankTab feed={feed} me={me} /> : null}
          {current === "me" ? (
            <AccountTab
              feed={feed}
              me={me}
              money={money}
              isMaster={isMaster}
              onLogout={logOut}
              onUnlockMaster={() => setTab("unlock")}
            />
          ) : null}
          {current === "master" ? (
            <MasterTab
              feed={feed}
              bracket={bracket}
              busy={busy}
              error={masterError}
              run={runMaster}
              onRedraw={() => setRedraw(true)}
            />
          ) : null}
          {tab === "unlock" ? (
            feed.masterSet ? (
              <UnlockPanel unlock={unlockMaster} onCancel={() => setTab("me")} />
            ) : (
              <SetupForm feed={feed} needPin busy={busy} error={masterError} onDraw={draw} />
            )
          ) : null}
        </>
      )}

      <p className="foot">
        {feed.stats.players} spelers · {mx(feed.stats.pot)} op tafel
      </p>
    </Shell>
  );
}

function Shell({ title, subtitle, children }) {
  return (
    <main className="shell">
      <Crest className="watermark" />
      <header className="masthead">
        <Crest style={{ width: "2.75rem", margin: "0 auto" }} />
        <h1>{title}</h1>
        <p className="tag">{subtitle || "Nep-MX, echte eer"}</p>
      </header>
      <div className="rule-double" />
      {children}
    </main>
  );
}

function Gate({ onDone }) {
  const [mode, setMode] = useState("new");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);

  const create = async () => {
    const clean = cleanName(name);
    if (!clean) return setErr("Kies een gebruikersnaam.");
    if (clean.length > MAX_NAME) return setErr(`Houd het onder de ${MAX_NAME} tekens.`);
    setBusy(true);
    setErr("");
    try {
      const data = await action({ type: "signup", name: clean });
      setIssued(data);
    } catch (error) {
      setErr(error.message);
      if (error.code === "taken") setMode("back");
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const back = async () => {
    setBusy(true);
    setErr("");
    try {
      const data = await action({ type: "login", name: cleanName(name), pin });
      onDone(data);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <Panel tone="crown" style={{ marginTop: "1rem" }}>
        <h3>Je doet mee, {issued.name}</h3>
        <p>Dit is je pincode. Schrijf hem op of maak nu een screenshot: je hebt hem nodig om op een andere telefoon in te loggen.</p>
        <div className="pinbox">
          <span>
            Jouw pincode
            <br />
            <span style={{ fontSize: "0.72rem" }}>Geen e-mail, geen wachtwoord</span>
          </span>
          <b>{issued.pin}</b>
        </div>
        <button type="button" className="btn solid" style={{ marginTop: "0.9rem" }} onClick={() => onDone(issued)}>
          Beginnen met {mx(START)}
        </button>
      </Panel>
    );
  }

  return (
    <Panel style={{ marginTop: "1rem" }}>
      <h3>{mode === "new" ? "Kies een gebruikersnaam" : "Weer inloggen"}</h3>
      <p>
        {mode === "new"
          ? `Iedereen begint met ${mx(START)}. Je krijgt een pincode van 4 cijfers, zodat je er weer in komt als je telefoon leeg is.`
          : "Je gebruikersnaam en de pincode van 4 cijfers die je kreeg."}
      </p>
      <label className="field">
        <span>Gebruikersnaam</span>
        <input
          value={name}
          maxLength={MAX_NAME}
          autoComplete="nickname"
          placeholder="Duco"
          onChange={(e) => {
            setName(e.target.value);
            setErr("");
          }}
        />
      </label>
      {mode === "back" ? (
        <label className="field">
          <span>Pincode</span>
          <input
            value={pin}
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="4 cijfers"
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
              setErr("");
            }}
          />
        </label>
      ) : null}
      {err ? <p className="error">{err}</p> : null}
      <button
        type="button"
        className="btn solid"
        style={{ marginTop: "0.9rem" }}
        disabled={busy}
        onClick={mode === "new" ? create : back}
      >
        {busy ? "Momentje…" : mode === "new" ? "Account aanmaken" : "Inloggen"}
      </button>
      <p className="centred" style={{ marginTop: "0.8rem" }}>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(mode === "new" ? "back" : "new");
            setErr("");
          }}
        >
          {mode === "new" ? "Ik heb al een account" : "Ik ben nieuw"}
        </button>
      </p>
    </Panel>
  );
}

function UnlockPanel({ unlock, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  return (
    <Panel style={{ marginTop: "1rem" }}>
      <h3>Mastertoegang</h3>
      <p>Voor wie het toernooi draait.</p>
      <label className="field">
        <span>Masterpincode</span>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, "").slice(0, 8));
            setErr("");
          }}
        />
      </label>
      {err ? <p className="error">{err}</p> : null}
      <div className="row" style={{ marginTop: "0.8rem" }}>
        <button
          type="button"
          className="btn solid"
          onClick={async () => {
            const problem = await unlock(pin);
            if (problem) setErr(problem);
          }}
        >
          Openen
        </button>
        <button type="button" className="btn ghost" style={{ flex: "0 0 6rem" }} onClick={onCancel}>
          Annuleren
        </button>
      </div>
    </Panel>
  );
}
