"use client";

import { useEffect, useState } from "react";
import { amount, beerLabel, beerSettlement, START } from "../lib/bracket";
import { Panel, Section } from "./ui";



export default function SettlementTab({ feed, me }) {
  const [board, setBoard] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/board", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setBoard(data.board || []);
      } catch (error) {
        // Bij een hapering blijft de vorige afrekening gewoon staan.
      }
    };
    load();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [feed.ver]);

  if (!board) {
    return <p className="spinner">Afrekening berekenen…</p>;
  }

  const rows = board.map(([name, score]) => ({ name, score }));
  const { people, transfers, total, winners, losers } = beerSettlement(rows);
  const mine = me ? people.find((p) => p.name === me.name) : null;
  const myTransfers = me ? transfers.filter((t) => t.from === me.name || t.to === me.name) : [];

  return (
    <>
      <div className="stats" style={{ marginTop: "1rem" }}>
        <div>
          <b>{amount(total)}</b>
          <span>biertjes</span>
        </div>
        <div>
          <b>{winners}</b>
          <span>winnaars</span>
        </div>
        <div>
          <b>{losers}</b>
          <span>betalen</span>
        </div>
      </div>

      {mine ? (
        <Panel tone="crown" style={{ marginTop: "0.8rem" }}>
          <div className="meta">
            <span>Jouw eindstand</span>
            <span>{amount(mine.score)} MX</span>
          </div>
          <h3 style={{ marginTop: "0.4rem" }}>
            {mine.beers > 0.005
              ? `Je krijgt ${beerLabel(mine.beers)}`
              : mine.beers < -0.005
                ? `Je bent ${beerLabel(mine.beers)} schuldig`
                : "Je komt precies uit"}
          </h3>
          {myTransfers.length ? (
            <div style={{ marginTop: "0.5rem" }}>
              {myTransfers.map((t, i) => (
                <div className="slip" key={i}>
                  <span>
                    {t.from === me.name ? "Geef aan " : "Haal bij "}
                    <span className="pickname">{t.from === me.name ? t.to : t.from}</span>
                  </span>
                  <span className="amt">{beerLabel(t.beers)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p>Je hoeft niemand iets te geven en je krijgt van niemand iets.</p>
          )}
        </Panel>
      ) : null}

      <Section
        title="Wie geeft wie"
        hint="Zo min mogelijk rondjes lopen: elke regel is één keer aangeven en klaar."
      >
        {transfers.length === 0 ? (
          <Panel>
            <h3>Niemand hoeft iets te geven</h3>
            <p>Iedereen eindigt op {START} MX, of het verschil is te klein om op te schrijven.</p>
          </Panel>
        ) : (
          <div className="list">
            {transfers.map((t, i) => (
              <div className={`item${me && (t.from === me.name || t.to === me.name) ? " me" : ""}`} key={i}>
                <span className="who">
                  <b>{t.from}</b>
                  <span>geeft aan {t.to}</span>
                </span>
                <span className="score">{beerLabel(t.beers)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Eindstand" hint="Boven de 50 MX is winst, eronder betaal je.">
        <div className="list">
          {people.map((p) => (
            <div className={`item${me && p.name === me.name ? " me" : ""}`} key={p.name}>
              <span className="who">
                <b>
                  {p.name}
                  {me && p.name === me.name ? " (jij)" : ""}
                </b>
                <span>{amount(p.score)} MX</span>
              </span>
              <span className={`score${p.beers > 0.005 ? " up" : p.beers < -0.005 ? " down" : ""}`}>
                {p.beers > 0 ? `+${amount(p.beers)}` : amount(p.beers)}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <p className="note" style={{ marginTop: "1rem" }}>
        Eén MX is één biertje en er wordt nergens afgerond, ook niet naar boven. Wie op 50,4 eindigt staat dus op 0,4
        biertje. Hoe jullie dat aan de bar oplossen mag je zelf weten; de getallen kloppen in elk geval met elkaar.
      </p>
    </>
  );
}
