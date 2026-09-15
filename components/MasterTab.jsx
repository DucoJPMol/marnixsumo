"use client";

import { useEffect, useState } from "react";
import {
  MIN_ROSTER,
  MAX_ROSTER,
  MAX_NAME,
  mx,
  matchById,
  resolveSource,
  matchStatus,
  boutScore,
  poolOf,
  cleanName,
} from "../lib/bracket";
import { Panel, Section, Confirm, Dots, useBoutTimer } from "./ui";

export function SetupForm({ feed, needPin, busy, error, onDraw }) {
  const existing = feed.state && feed.state.players ? Object.values(feed.state.players) : [];
  const [text, setText] = useState(existing.join("\n"));
  const [title, setTitle] = useState((feed.state && feed.state.title) || "");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const names = text.split("\n").map(cleanName).filter(Boolean);

  const check = () => {
    if (names.length < MIN_ROSTER) return `Vul minstens ${MIN_ROSTER} worstelaars in.`;
    if (names.length > MAX_ROSTER) return `Dat zijn er meer dan ${MAX_ROSTER}.`;
    const long = names.find((n) => n.length > MAX_NAME);
    if (long) return `Kort "${long}" in tot maximaal ${MAX_NAME} tekens.`;
    const seen = new Set();
    for (const n of names) {
      const key = n.toLowerCase();
      if (seen.has(key)) return `Twee worstelaars heten ${n}. Zet er een letter achter.`;
      seen.add(key);
    }
    if (needPin && !/^\d{4,8}$/.test(pin)) return "Kies een masterpincode van 4 tot 8 cijfers.";
    return "";
  };

  const go = (shuffle) => {
    const problem = check();
    setErr(problem);
    if (!problem) onDraw({ names, pin, shuffle, title: cleanName(title) });
  };

  return (
    <Panel style={{ marginTop: "1rem" }}>
      <h3>Schema loten</h3>
      <p>
        Van {MIN_ROSTER} tot {MAX_ROSTER} worstelaars. Wie bovenaan je lijst staat, wordt vrijgeloot als het aantal niet
        uitkomt.
      </p>
      <label className="field">
        <span>Naam van het toernooi</span>
        <input value={title} maxLength={28} placeholder="Sumo pool" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Worstelaars, één per regel — {names.length} {names.length === 1 ? "naam" : "namen"}
        </span>
        <textarea
          rows={8}
          value={text}
          placeholder={"Anna\nBram\nChris"}
          onChange={(e) => {
            setText(e.target.value);
            setErr("");
          }}
        />
      </label>
      {needPin ? (
        <label className="field">
          <span>Masterpincode, 4 tot 8 cijfers</span>
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
      ) : null}
      {err || error ? <p className="error">{err || error}</p> : null}
      <div className="row" style={{ marginTop: "0.9rem" }}>
        <button type="button" className="btn solid" disabled={busy} onClick={() => go(true)}>
          Willekeurig loten
        </button>
        <button type="button" className="btn ghost" disabled={busy} onClick={() => go(false)}>
          Mijn volgorde
        </button>
      </div>
      <p className="note">
        Jouw volgorde bepaalt de plaatsing: de eerste twee namen komen aan verschillende kanten en kunnen elkaar alleen in de
        finale tegenkomen.
      </p>
    </Panel>
  );
}

function PlayerHelp({ run, busy }) {
  const [list, setList] = useState(null);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState("");
  const load = async () => {
    setMsg("");
    const result = await run("master:players", {});
    if (result && result.players) setList(result.players);
    else setMsg("Kon de spelerslijst niet laden.");
  };
  const filtered = (list || []).filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12);
  return (
    <Section title="Iemand helpen inloggen" hint="Zoek een vergeten pincode op of geef een nieuwe.">
      <Panel>
        {list === null ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={load}>
            Spelers laden
          </button>
        ) : (
          <>
            <label className="field" style={{ marginTop: 0 }}>
              <span>Zoek op gebruikersnaam</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Begin met typen" />
            </label>
            {filtered.map((p) => (
              <div className="slip" key={p.uid}>
                <span className="pickname">{p.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span className="amt" style={{ letterSpacing: "0.2em" }}>
                    {p.pin}
                  </span>
                  <button
                    type="button"
                    className="link"
                    disabled={busy}
                    onClick={async () => {
                      const result = await run("master:playerPin", { uid: p.uid });
                      if (result && result.pin) {
                        setList((old) => old.map((x) => (x.uid === p.uid ? { ...x, pin: result.pin } : x)));
                        setMsg(`${p.name} heeft nu pincode ${result.pin}.`);
                      }
                    }}
                  >
                    nieuwe pin
                  </button>
                </span>
              </div>
            ))}
            {filtered.length === 0 ? <p className="note">Niets gevonden.</p> : null}
            <button type="button" className="btn quiet" style={{ marginTop: "0.8rem" }} onClick={load}>
              Lijst verversen
            </button>
          </>
        )}
        {msg ? <p className="good">{msg}</p> : null}
      </Panel>
    </Section>
  );
}

export default function MasterTab({ feed, bracket, busy, error, run, onRedraw }) {
  const state = feed.state;
  const timer = useBoutTimer(60);
  const [bouts, setBouts] = useState(false);
  const nameOf = (pid) => (state.players && state.players[pid]) || "?";
  const id = feed.current;
  const match = id ? matchById(bracket, id) : null;
  const pa = match ? resolveSource(bracket, state, match.a) : null;
  const pb = match ? resolveSource(bracket, state, match.b) : null;
  const status = id ? matchStatus(bracket, state, id) : "done";
  const pool = poolOf(feed.pools, id);
  const score = boutScore(state, id);
  const log = state.log || [];
  const last = log[log.length - 1];
  const started = Object.keys(state.locks || {}).length > 0;
  const upNext = bracket.matches.find((m) => m.id > (id || 0));
  const played = Object.keys(state.settled || {}).filter((k) => k !== "champ").length;

  useEffect(() => {
    timer.stop();
    // Elke nieuwe ronde begint met een schone klok.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, score.list.length]);

  const settle = (side) => run("master:winner", { match: id, side });

  return (
    <>
      <div className="stats" style={{ marginTop: "1rem" }}>
        <div>
          <b>{feed.stats.players}</b>
          <span>spelers</span>
        </div>
        <div>
          <b>{feed.stats.pot}</b>
          <span>MX ingezet</span>
        </div>
        <div>
          <b>
            {played}/{bracket.matches.length}
          </b>
          <span>matches klaar</span>
        </div>
      </div>

      {error ? <div className="banner bad">{error}</div> : null}

      {match ? (
        <Panel tone={status === "closed" ? "live" : ""} style={{ marginTop: "0.8rem" }}>
          <div className="meta">
            <span>
              {match.round} · match {id}
            </span>
            {status === "closed" ? (
              <span className="badge live">Inzetten gesloten</span>
            ) : (
              <span className="badge next">Inzetten open</span>
            )}
          </div>
          <h3 style={{ marginTop: "0.5rem", fontSize: "1.6rem" }}>
            {nameOf(pa)} tegen {nameOf(pb)}
          </h3>
          <p>
            {pool.bets} {pool.bets === 1 ? "inzet" : "inzetten"} · {mx(pool.total)} in de pot
            {score.list.length ? ` · rondes ${score.a}–${score.b}` : ""}
          </p>

          {status === "open" ? (
            <button
              type="button"
              className="btn danger"
              style={{ marginTop: "0.8rem" }}
              disabled={busy}
              onClick={() => run("master:close", { match: id })}
            >
              Inzetten sluiten
            </button>
          ) : null}

          <p style={{ marginTop: "0.9rem", color: "var(--ink)", fontWeight: 600 }}>Wie heeft de match gewonnen?</p>
          <div className="row" style={{ marginTop: "0.4rem" }}>
            <button type="button" className="btn solid" disabled={busy} onClick={() => settle("a")}>
              {nameOf(pa)}
            </button>
            <button type="button" className="btn solid" disabled={busy} onClick={() => settle("b")}>
              {nameOf(pb)}
            </button>
          </div>
          <p className="note">
            Eén tik sluit het inzetten als dat nog open stond en betaalt iedereen meteen uit.
          </p>

          <button type="button" className="link" style={{ marginTop: "0.8rem" }} onClick={() => setBouts(!bouts)}>
            {bouts ? "Rondes verbergen" : "Ronde voor ronde bijhouden"}
          </button>
          {bouts ? (
            <div style={{ marginTop: "0.6rem", borderTop: "1px solid var(--rule)", paddingTop: "0.8rem" }}>
              <div className="meta">
                <span>
                  {nameOf(pa)} <Dots list={score.list} side="a" /> {score.a}–{score.b}{" "}
                  <Dots list={score.list} side="b" /> {nameOf(pb)}
                </span>
              </div>
              <p className="note" style={{ marginTop: "0.4rem" }}>Wie won ronde {score.list.length + 1}?</p>
              <div className="row" style={{ marginTop: "0.4rem" }}>
                {["a", "b"].map((side) => (
                  <button
                    key={side}
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => run("master:bout", { match: id, side, boutNo: score.list.length + 1 })}
                  >
                    {nameOf(side === "a" ? pa : pb)}
                  </button>
                ))}
              </div>
              <div className="meta" style={{ marginTop: "0.7rem" }}>
                <span style={{ color: timer.left === 0 ? "var(--gules)" : "var(--dim)", letterSpacing: 0 }}>
                  {timer.left === null
                    ? "60 seconden per ronde"
                    : timer.left === 0
                      ? "Tijd. Opnieuw buik aan buik."
                      : `Nog ${timer.left}s`}
                </span>
                <button
                  type="button"
                  className="btn quiet"
                  style={{ width: "auto" }}
                  onClick={timer.left === null ? timer.start : timer.stop}
                >
                  {timer.left === null ? "Klok starten" : "Opnieuw"}
                </button>
              </div>
            </div>
          ) : null}
        </Panel>
      ) : (
        <Panel tone="crown" style={{ marginTop: "0.8rem" }}>
          <h3>Alle matches zijn gespeeld</h3>
          <p>De kampioenspot is uitbetaald. Je kunt wanneer je wilt een nieuw toernooi starten.</p>
        </Panel>
      )}

      {last ? (
        <button
          type="button"
          className="btn quiet"
          style={{ marginTop: "0.7rem" }}
          disabled={busy}
          onClick={() => run("master:undo", { logLength: log.length })}
        >
          {last.t === "win"
            ? `Uitslag van match ${last.m} terugdraaien`
            : last.t === "bout"
              ? `Laatste ronde van match ${last.m} terugdraaien`
              : `Inzetten op match ${last.m} weer openen`}
        </button>
      ) : null}

      {upNext ? (
        <Section title="Hierna">
          <Panel>
            <div className="meta">
              <span>{upNext.round}</span>
              <span>Match {upNext.id}</span>
            </div>
            <p style={{ color: "var(--ink)", marginTop: "0.3rem" }}>
              {nameOf(resolveSource(bracket, state, upNext.a))} tegen {nameOf(resolveSource(bracket, state, upNext.b))}
            </p>
          </Panel>
        </Section>
      ) : null}

      <PlayerHelp run={run} busy={busy} />

      <Section title="Toernooi">
        {!started ? (
          <button type="button" className="btn quiet" onClick={onRedraw}>
            Namen aanpassen en opnieuw loten
          </button>
        ) : null}
        <div style={{ marginTop: "0.5rem" }}>
          <Confirm
            label="Nieuw toernooi starten"
            confirmLabel="Bevestig: alle inzetten en uitslagen wissen"
            disabled={busy}
            onConfirm={() => run("master:reset", {})}
          />
        </div>
        <p className="note">Iedereen houdt zijn account en begint weer met 50 MX.</p>
      </Section>
    </>
  );
}
