"use client";

import { useEffect, useRef, useState } from "react";
import { mx, MIN_BET } from "../lib/bracket";

export const STORE_KEYS = {
  token: "mx.token",
  uid: "mx.uid",
  name: "mx.name",
  pin: "mx.pin",
  master: "mx.master",
};

export const local = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Private browsing: the session lasts until the tab closes.
    }
  },
  drop(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      // Nothing to clean up.
    }
  },
};

export async function post(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    const err = new Error("Geen verbinding. Check je bereik en probeer opnieuw.");
    err.code = "offline";
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error((data && data.error) || "Er ging iets mis. Probeer het opnieuw.");
    err.code = data && data.code;
    err.status = res.status;
    throw err;
  }
  return data || {};
}

export const action = (body) => post("/api/action", body);

export function Crest({ className = "crest", style }) {
  return (
    <span
      role="img"
      aria-label="Wapen"
      className={className}
      style={{
        display: "block",
        aspectRatio: "1400 / 1537",
        background: "currentColor",
        WebkitMask: "url(/crest.svg) center / contain no-repeat",
        mask: "url(/crest.svg) center / contain no-repeat",
        ...style,
      }}
    />
  );
}

export function Panel({ children, tone, className = "", ...rest }) {
  return (
    <div className={`panel ${tone || ""} ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

export function Section({ title, hint, children }) {
  return (
    <>
      <div className="section">
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      {children}
    </>
  );
}

export function Dots({ list, side }) {
  if (!list || !list.length) return null;
  return (
    <span className="dots" aria-hidden="true">
      {list.map((x, i) => (
        <span key={i} className={`dot${x === side ? " won" : ""}`} />
      ))}
    </span>
  );
}

export function Money({ value }) {
  return <span>{mx(value)}</span>;
}

// Small stake picker: chips for the common amounts, a stepper for the rest.
export function StakePicker({ value, max, onChange }) {
  const chips = [1, 5, 10, 25].filter((n) => n <= Math.max(max, MIN_BET));
  const set = (n) => onChange(Math.max(MIN_BET, Math.min(max, n)));
  return (
    <>
      <div className="chips">
        {chips.map((n) => (
          <button key={n} type="button" aria-pressed={value === n} onClick={() => set(n)}>
            {n}
          </button>
        ))}
        <button type="button" aria-pressed={value === max && max > 0} onClick={() => set(max)}>
          Alles
        </button>
      </div>
      <div className="stepper">
        <button type="button" aria-label="Minder inzetten" onClick={() => set(value - 1)}>
          −
        </button>
        <div className="value">
          {value}
          <span>MX</span>
        </div>
        <button type="button" aria-label="Meer inzetten" onClick={() => set(value + 1)}>
          +
        </button>
      </div>
    </>
  );
}

export function Confirm({ label, confirmLabel, onConfirm, className = "btn warn", disabled }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={() => {
        if (!armed) setArmed(true);
        else {
          setArmed(false);
          onConfirm();
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

// 60 seconds a bout, with a beep at the end so the ring can hear it.
export function useBoutTimer(seconds = 60) {
  const [left, setLeft] = useState(null);
  const tick = useRef(null);
  const audio = useRef(null);
  const stop = () => {
    clearInterval(tick.current);
    tick.current = null;
    setLeft(null);
  };
  const start = () => {
    clearInterval(tick.current);
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !audio.current) audio.current = new Ctx();
      if (audio.current) audio.current.resume();
    } catch (error) {
      audio.current = null;
    }
    const end = Date.now() + seconds * 1000;
    setLeft(seconds);
    tick.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) {
        clearInterval(tick.current);
        tick.current = null;
        try {
          const ctx = audio.current;
          if (ctx) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.frequency.value = 880;
            gain.gain.value = 0.3;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.9);
          }
        } catch (error) {
          // No sound available; the number on screen is enough.
        }
      }
    }, 250);
  };
  useEffect(() => () => clearInterval(tick.current), []);
  return { left, start, stop };
}
