"use client";

import { useEffect, useState } from "react";
import { CHAMP, mx, resolveSource, matchStatus, boutScore, winnerOf, START } from "../lib/bracket";
import { Panel, Section, Dots } from "./ui";

export function BracketTab({ feed, bracket }) {
  const state = feed.state;
  const nameOf = (pid) => (state.players && state.players[pid]) || "?";
  const label = (src) => (src.slot !== undefined ? nameOf(state.slots[src.slot]) : `Winnaar van match ${src.match}`);
  const rounds = [];
  bracket.matches.forEach((match) => {
    const last = rounds[rounds.length - 1];
    if (last && last.name === match.round) last.matches.push(match);
    else rounds.push({ name: match.round, matches: [match] });
  });
  const byes = bracket.byes.map((slot) => nameOf(state.slots[slot]));

  return (
    <>
      {byes.length ? (
        <p className="note" style={{ marginTop: "1rem" }}>
          {byes.join(" en ")} {byes.length === 1 ? "is vrijgeloot" : "zijn vrijgeloot"} naar de volgende ronde, aan
          tegenovergestelde kanten van het schema.
        </p>
      ) : null}
      {rounds.map((round) => (
        <Section key={round.name} title={round.name}>
          <div className="list">
            {round.matches.map((match) => {
              const id = match.id;
              const pa = resolveSource(bracket, state, match.a);
              const pb = resolveSource(bracket, state, match.b);
              const status = matchStatus(bracket, state, id);
              const bouts = boutScore(state, id);
              const winner = winnerOf(state, id);
              return (
                <div className="tie" key={id}>
                  <div className="meta">
                    <span>Match {id}</span>
                    {status === "closed" ? (
                      <span className="badge live">In de ring</span>
                    ) : (
                      <span>
                        {status === "done" ? "Gespeeld" : status === "open" ? "Inzetten open" : "Wachten"}
                      </span>
                    )}
                  </div>
                  {[
                    ["a", pa, match.a],
                    ["b", pb, match.b],
                  ].map(([side, pid, src]) => (
                    <div className={`line${winner && winner !== pid ? " out" : ""}`} key={side}>
                      {pid ? <b>{nameOf(pid)}</b> : <span className="pending">{label(src)}</span>}
                      <span style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
                        <Dots list={bouts.list} side={side} />
                        {bouts.list.length ? <b style={{ fontFamily: "var(--body)" }}>{bouts[side]}</b> : null}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </>
  );
}

export function RankTab({ feed, me }) {
  const [full, setFull] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setFull(data);
      } catch (error) {
        // De korte stand uit de feed staat al op het scherm.
      }
    };
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 6000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const rows = (full ? full.board : feed.board) || [];
  const stats = (full ? full.stats : feed.stats) || { players: 0, staked: 0, pot: 0 };

  return (
    <>
      <div className="stats">
        <div>
          <b>{stats.players}</b>
          <span>spelers</span>
        </div>
        <div>
          <b>{stats.pot}</b>
          <span>MX in het spel</span>
        </div>
        <div>
          <b>{START}</b>
          <span>MX startgeld</span>
        </div>
      </div>
      <Section title="Stand" hint="Openstaande inzetten tellen mee.">
        {rows.length === 0 ? (
          <Panel>
            <h3>Nog niemand meegedaan</h3>
            <p>Deel de link en de stand loopt vanzelf vol.</p>
          </Panel>
        ) : (
          <div className="list">
            {rows.map(([name, score, reserved], i) => {
              const mine = me && name === me.name;
              return (
                <div className={`item${mine ? " me" : ""}`} key={`${name}-${i}`}>
                  <span className="rank">{i + 1}</span>
                  <span className="who">
                    <b>
                      {name}
                      {mine ? " (jij)" : ""}
                    </b>
                    {reserved > 0 ? <span>{mx(reserved)} in het spel</span> : null}
                  </span>
                  <span className={`score${score > START ? " up" : score < START ? " down" : ""}`}>{score}</span>
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </>
  );
}

export function AccountTab({ feed, me, money, onLogout, onUnlockMaster, isMaster }) {
  const [showPin, setShowPin] = useState(false);
  const state = feed.state;
  const nameOf = (pid) => (state && state.players && state.players[pid]) || "?";
  const openBets = Object.entries(money.bets).filter(([key]) => !money.results[key]);
  const settled = Object.entries(money.results);
  const marketName = (key) => (key === CHAMP ? "Kampioen" : `Match ${key}`);

  return (
    <>
      <Section title="Jouw account">
        <Panel>
          <h3>{me.name}</h3>
          <p>
            {money.rank ? `Plek ${money.rank} van ${money.players}. ` : ""}
            {mx(money.balance)} vrij{money.reserved > 0 ? `, ${mx(money.reserved)} in openstaande inzetten` : ""}.
          </p>
          <div className="pinbox">
            <span>
              Jouw pincode
              <br />
              <span style={{ fontSize: "0.72rem" }}>Hiermee log je in op elke telefoon</span>
            </span>
            {showPin ? (
              <b>{me.pin || "····"}</b>
            ) : (
              <button type="button" className="btn quiet" style={{ width: "auto" }} onClick={() => setShowPin(true)}>
                Laat zien
              </button>
            )}
          </div>
          <div className="stats">
            <div>
              <b>{money.balance}</b>
              <span>MX vrij</span>
            </div>
            <div>
              <b>{money.reserved}</b>
              <span>MX in het spel</span>
            </div>
            <div>
              <b>{money.score}</b>
              <span>totaal</span>
            </div>
          </div>
        </Panel>
      </Section>

      {openBets.length ? (
        <Section title="Openstaande inzetten">
          <Panel>
            {openBets.map(([key, bet]) => (
              <div className="slip" key={key}>
                <span>
                  {marketName(key)} · <span className="pickname">{nameOf(bet.pick)}</span>
                </span>
                <span className="amt">{mx(bet.amt)}</span>
              </div>
            ))}
          </Panel>
        </Section>
      ) : null}

      {settled.length ? (
        <Section title="Afgerekend">
          <Panel>
            {settled
              .slice()
              .reverse()
              .map(([key, result]) => (
                <div className="slip" key={key}>
                  <span>
                    {marketName(key)} · <span className="pickname">{nameOf(result.pick)}</span>
                  </span>
                  <span
                    className="amt"
                    style={{ color: result.net > 0 ? "var(--vert)" : result.net < 0 ? "var(--gules)" : "var(--dim)" }}
                  >
                    {result.net > 0 ? `+${result.net}` : result.net}
                  </span>
                </div>
              ))}
          </Panel>
        </Section>
      ) : null}

      <div style={{ marginTop: "1.5rem" }} className="row">
        <button type="button" className="btn quiet" onClick={onLogout}>
          Uitloggen
        </button>
        {!isMaster ? (
          <button type="button" className="btn quiet" onClick={onUnlockMaster}>
            Mastertoegang
          </button>
        ) : null}
      </div>
    </>
  );
}
