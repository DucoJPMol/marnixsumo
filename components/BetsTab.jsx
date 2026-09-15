"use client";

import { useState } from "react";
import {
  CHAMP,
  MIN_BET,
  mx,
  matchById,
  resolveSource,
  matchStatus,
  boutScore,
  poolOf,
  oddsFor,
  projectedReturn,
  winnerOf,
  champOpen,
} from "../lib/bracket";
import { Panel, Section, Dots, StakePicker } from "./ui";

function Odds({ pool, pick }) {
  const odds = oddsFor(pool, pick);
  return (
    <span className="odds">
      {odds ? `×${odds.toFixed(1)}` : "–"}
      <small>{odds ? "uitbetaling" : "geen inzet"}</small>
    </span>
  );
}

function PickRow({ name, pool, pick, mine, selected, onSelect, won }) {
  const backing = pool.sides[pick] || 0;
  return (
    <button
      type="button"
      className={`pick${won ? " won" : ""}`}
      aria-pressed={!!selected}
      onClick={onSelect}
      disabled={!onSelect}
    >
      <span style={{ minWidth: 0 }}>
        <span className="name">{name}</span>
        <span className={`under${mine ? " mine" : ""}`}>
          {mine ? `Jouw inzet: ${mx(mine.amt)}` : backing > 0 ? `${mx(backing)} ingezet` : "Nog geen inzetten"}
        </span>
      </span>
      <Odds pool={pool} pick={pick} />
    </button>
  );
}

function StakeBox({ market, pickName, pool, pick, mine, balance, busy, onPlace, onClose }) {
  const max = Math.max(MIN_BET, balance + (mine ? mine.amt : 0));
  const [amt, setAmt] = useState(() => Math.min(mine ? mine.amt : 5, max));
  const [err, setErr] = useState("");
  const payout = projectedReturn(pool, pick, amt, mine);
  const submit = async () => {
    setErr("");
    const problem = await onPlace(market, pick, amt);
    if (problem) setErr(problem);
    else onClose(); // bet placed: fold the panel away again
  };
  return (
    <div className="stake">
      <p style={{ margin: 0, color: "var(--dim)", fontSize: "0.85rem" }}>
        Op {pickName}. Je hebt {mx(balance + (mine ? mine.amt : 0))} te besteden.
      </p>
      <StakePicker value={amt} max={max} onChange={setAmt} />
      <p style={{ marginTop: "0.5rem", color: "var(--dim)", fontSize: "0.85rem" }}>
        Levert ongeveer {mx(payout)} op als {pickName} wint. Latere inzetten verschuiven de quotering.
      </p>
      {err ? <p className="error">{err}</p> : null}
      <div className="row" style={{ marginTop: "0.6rem" }}>
        <button type="button" className="btn solid" disabled={busy} onClick={submit}>
          {busy ? "Bezig…" : mine ? "Inzet wijzigen" : "Inzetten"}
        </button>
        <button type="button" className="btn ghost" style={{ flex: "0 0 5.5rem" }} onClick={onClose}>
          Sluiten
        </button>
      </div>
    </div>
  );
}

function MatchCard({ feed, bracket, id, money, balance, busy, onPlace, selected, setSelected }) {
  const state = feed.state;
  const match = matchById(bracket, id);
  const pa = resolveSource(bracket, state, match.a);
  const pb = resolveSource(bracket, state, match.b);
  const status = matchStatus(bracket, state, id);
  const pool = poolOf(feed.pools, id);
  const bouts = boutScore(state, id);
  const mine = money.bets[String(id)];
  const nameOf = (pid) => (state.players && state.players[pid]) || "?";
  const settled = state.settled[id];
  const result = money.results[String(id)];
  const open = status === "open";
  const isSelected = selected && selected.market === String(id);

  return (
    <Panel tone={status === "closed" ? "live" : ""}>
      <div className="meta">
        <span>{match.round} · best of 3</span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          {status === "closed" ? <span className="badge live">In de ring</span> : null}
          {feed.current === id && open ? <span className="badge next">Zo aan de beurt</span> : null}
          <span>Match {id}</span>
        </span>
      </div>
      <div style={{ marginTop: "0.6rem" }}>
        <PickRow
          name={nameOf(pa)}
          pool={pool}
          pick={pa}
          mine={mine && mine.pick === pa ? mine : null}
          selected={isSelected && selected.pick === pa}
          won={settled && settled.w === pa}
          onSelect={open ? () => setSelected({ market: String(id), pick: pa }) : null}
        />
        <div className="versus">tegen</div>
        <PickRow
          name={nameOf(pb)}
          pool={pool}
          pick={pb}
          mine={mine && mine.pick === pb ? mine : null}
          selected={isSelected && selected.pick === pb}
          won={settled && settled.w === pb}
          onSelect={open ? () => setSelected({ market: String(id), pick: pb }) : null}
        />
      </div>
      {bouts.list.length ? (
        <div className="meta" style={{ marginTop: "0.6rem" }}>
          <span>
            Rondes: {nameOf(pa)} <Dots list={bouts.list} side="a" /> {bouts.a}–{bouts.b}{" "}
            <Dots list={bouts.list} side="b" /> {nameOf(pb)}
          </span>
        </div>
      ) : null}
      <div className="meta" style={{ marginTop: "0.6rem" }}>
        <span>
          {pool.total > 0
            ? `${mx(pool.total)} in de pot · ${pool.bets} ${pool.bets === 1 ? "inzet" : "inzetten"}`
            : "Nog geen inzetten"}
        </span>
        {mine && open && !isSelected ? (
          <button type="button" className="link" disabled={busy} onClick={() => onPlace(String(id), "none", 0)}>
            Inzet annuleren
          </button>
        ) : null}
      </div>
      {status === "closed" ? (
        <p>Inzetten gesloten{mine ? ` — jij hebt ${mx(mine.amt)} op ${nameOf(mine.pick)}` : ""}.</p>
      ) : null}
      {result ? (
        <p style={{ color: result.net > 0 ? "var(--vert)" : result.net < 0 ? "var(--gules)" : "var(--dim)", fontWeight: 600 }}>
          {result.refund
            ? `Niemand had ${nameOf(settled.w)}, dus je ${mx(result.amt)} is terug.`
            : result.net > 0
              ? `Je wint ${mx(result.net)}.`
              : result.net === 0
                ? "Je was de enige met een inzet, dus je krijgt hem terug."
                : `Je verliest ${mx(result.amt)}.`}
        </p>
      ) : null}
      {isSelected && open ? (
        <StakeBox
          market={String(id)}
          pick={selected.pick}
          pickName={nameOf(selected.pick)}
          pool={pool}
          mine={mine}
          balance={balance}
          busy={busy}
          onPlace={onPlace}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </Panel>
  );
}

function ChampionCard({ feed, money, balance, busy, onPlace, selected, setSelected }) {
  const state = feed.state;
  const pool = poolOf(feed.pools, CHAMP);
  const mine = money.bets[CHAMP];
  const open = champOpen(state);
  const settled = state.settled[CHAMP];
  const result = money.results[CHAMP];
  const isSelected = selected && selected.market === CHAMP;
  const nameOf = (pid) => (state.players && state.players[pid]) || "?";
  const order = [...state.slots].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  return (
    <Panel tone="crown">
      <div className="meta">
        <span>Nu inzetten, na de finale uitbetaald</span>
        {open ? <span className="badge next">Open</span> : <span className="badge quiet">Gesloten</span>}
      </div>
      <h3 style={{ marginTop: "0.5rem" }}>Wie wint het hele toernooi?</h3>
      <p>
        Eén naam, één inzet. Hij gaat op slot zodra de eerste match begint, dus zet nu in en je hoeft er niet meer naar om te
        kijken.
        {pool.total > 0 ? ` Er staat al ${mx(pool.total)} op.` : ""}
      </p>
      {settled ? <p style={{ color: "var(--gold)", fontWeight: 600 }}>Kampioen: {nameOf(settled.w)}</p> : null}
      {result ? (
        <p style={{ color: result.net > 0 ? "var(--vert)" : "var(--gules)", fontWeight: 600 }}>
          {result.refund
            ? `Niemand had het goed, dus je ${mx(result.amt)} is terug.`
            : result.net > 0
              ? `Goed voorspeld: ${mx(result.net)} erbij.`
              : result.net === 0
                ? "Je was de enige met een inzet, dus je krijgt hem terug."
                : `Jij had ${nameOf(result.pick)}. ${mx(result.amt)} kwijt.`}
        </p>
      ) : null}
      {mine && !isSelected ? (
        <div className="meta" style={{ marginTop: "0.7rem" }}>
          <span style={{ color: "var(--gold)", fontWeight: 600, letterSpacing: 0 }}>
            Jouw keuze: {nameOf(mine.pick)} voor {mx(mine.amt)}
          </span>
          {open ? (
            <button type="button" className="link" disabled={busy} onClick={() => onPlace(CHAMP, "none", 0)}>
              Annuleren
            </button>
          ) : null}
        </div>
      ) : null}
      {open ? (
        <div style={{ marginTop: "0.7rem" }}>
          {order.map((pid) => (
            <PickRow
              key={pid}
              name={nameOf(pid)}
              pool={pool}
              pick={pid}
              mine={mine && mine.pick === pid ? mine : null}
              selected={isSelected && selected.pick === pid}
              onSelect={() => setSelected({ market: CHAMP, pick: pid })}
            />
          ))}
        </div>
      ) : null}
      {isSelected && open ? (
        <StakeBox
          market={CHAMP}
          pick={selected.pick}
          pickName={nameOf(selected.pick)}
          pool={pool}
          mine={mine}
          balance={balance}
          busy={busy}
          onPlace={onPlace}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </Panel>
  );
}

export default function BetsTab({ feed, bracket, money, busy, onPlace }) {
  const [selected, setSelected] = useState(null);
  const state = feed.state;
  const balance = money.balance;
  const predictions = feed.phase === "predictions";
  const ids = bracket.matches.map((m) => m.id);
  const byStatus = (want) => ids.filter((id) => matchStatus(bracket, state, id) === want);
  const closed = byStatus("closed");
  const open = byStatus("open");
  const tbd = byStatus("tbd");
  const done = ids.filter((id) => winnerOf(state, id)).reverse();
  const nameOf = (pid) => (state.players && state.players[pid]) || "?";
  const broke = balance < MIN_BET && money.reserved === 0 && Object.keys(money.results).length > 0;
  const champion = state.settled[CHAMP] ? state.settled[CHAMP].w : null;
  const card = (id) => (
    <MatchCard
      key={id}
      id={id}
      feed={feed}
      bracket={bracket}
      money={money}
      balance={balance}
      busy={busy}
      onPlace={onPlace}
      selected={selected}
      setSelected={setSelected}
    />
  );
  const sourceLabel = (src) => (src.slot !== undefined ? nameOf(state.slots[src.slot]) : `Winnaar van match ${src.match}`);

  return (
    <>
      {champion ? (
        <Panel tone="crown" className="centred" style={{ marginTop: "0.8rem" }}>
          <div className="meta centred" style={{ justifyContent: "center" }}>
            <span>Kampioen</span>
          </div>
          <h3 style={{ fontSize: "2.2rem", margin: "0.2rem 0 0" }}>{nameOf(champion)}</h3>
        </Panel>
      ) : null}

      {broke ? (
        <Panel style={{ marginTop: "0.8rem" }}>
          <h3>Je MX is op</h3>
          <p>Alles vergokt. Er komt niets bij, dus vanaf hier kijk je mee.</p>
        </Panel>
      ) : null}

      {predictions ? (
        <Section title="Voorspelronde" hint="Er is nog niets begonnen. Zet nu alles in en je kunt je telefoon wegleggen.">
          <ChampionCard
            feed={feed}
            money={money}
            balance={balance}
            busy={busy}
            onPlace={onPlace}
            selected={selected}
            setSelected={setSelected}
          />
        </Section>
      ) : null}

      {closed.length ? <Section title="In de ring">{closed.map(card)}</Section> : null}

      {open.length ? (
        <Section
          title={predictions ? "Eerste ronde" : "Open om in te zetten"}
          hint="Tik op een worstelaar om op hem in te zetten. Inzetten sluit zodra ze de mat op stappen."
        >
          {open.map(card)}
        </Section>
      ) : null}

      {!predictions && champOpen(state) ? (
        <Section title="Kampioensvoorspelling">
          <ChampionCard
            feed={feed}
            money={money}
            balance={balance}
            busy={busy}
            onPlace={onPlace}
            selected={selected}
            setSelected={setSelected}
          />
        </Section>
      ) : null}

      {tbd.length ? (
        <Section title="Komt eraan" hint="Inzetten opent zodra beide worstelaars bekend zijn.">
          <div className="list">
            {tbd.map((id) => {
              const match = matchById(bracket, id);
              return (
                <div className="tie" key={id}>
                  <div className="meta">
                    <span>{match.round}</span>
                    <span>Match {id}</span>
                  </div>
                  <div className="line">
                    <span className="pending">
                      {sourceLabel(match.a)} tegen {sourceLabel(match.b)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      {done.length ? <Section title="Uitslagen">{done.map(card)}</Section> : null}
    </>
  );
}
