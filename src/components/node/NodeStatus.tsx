"use client";
import { useEffect, useState, type ReactNode } from "react";
import LineIcon from "@/components/LineIcon";
import { ICON } from "@/components/icons";
import { clockLabel, dayLabel, dayStart, spanLabel } from "@/lib/clock";
import { LIVE_EVERY_S, LIVE_FRESH_S, type NodeStatusOut, type Pt } from "@/lib/node-status";

// The node's state now, at the top of its dashboard: live while it is on WiFi or a cable (it reports every
// LIVE_EVERY_S seconds and this panel asks every ten), its last readings while it is on 4G, asleep between its
// windows. Server-rendered from `nodeStatus`, then kept fresh from /api/v1/places/{slug}/node/status.

const STATE: Record<NodeStatusOut["state"], { label: string; dot: string; pulse?: boolean }> = {
  live: { label: "Live", dot: "bg-[#5ee08a]", pulse: true },
  listening: { label: "Listening", dot: "bg-[#5ee08a]" },
  awake: { label: "Awake", dot: "bg-[#a7e3b6]" },
  on: { label: "On", dot: "bg-[#a7e3b6]" },
  asleep: { label: "Asleep", dot: "border-2 border-[#9fbea6]" },
  saving: { label: "Saving its battery", dot: "bg-[#f0b429]" },
  quiet: { label: "Quiet", dot: "bg-[#f0b429]" },
  silent: { label: "Silent", dot: "bg-[#8a948c]" },
  never: { label: "Not heard yet", dot: "bg-[#8a948c]" },
};
const WAKE: Record<string, string> = {
  alarm: "woken by its schedule", button: "woken by the button", "power-connected": "started when the power came on",
  "voltage-restored": "started when the battery recovered", "low-voltage": "stopped by its battery guard", "over-temp": "acted on heat", "under-temp": "acted on cold",
};
const OFF: Record<string, string> = { visit: "for a visit", kept: "kept awake", alarm: "for its alarm", stop: "about to sleep" };
const CHARGE: Record<string, string> = { off: "not charging", bulk: "charging", absorption: "topping up", float: "full, floating", equalize: "equalising", fault: "charger fault", starting: "starting" };
const VIA: Record<string, string> = { wifi: "WiFi", lan: "a cable", "4g": "4G" };

// the node's window names as a reader says them: "night" is the owner's meadow-bird window, "+" joins windows that meet
const winName = (n: string | null) => `${(n ?? "listening").split("+").map((x) => (x === "night" ? "meadow-bird" : x)).join(" and ")} window`;
const shortOp = (op: string) => op.replace(/ \(.*\)$/, "");
function secsAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : spanLabel(ms);
}

export default function NodeStatus({ initial, src }: { initial: NodeStatusOut; src: string }) {
  const [s, setS] = useState(initial);
  // the clock the panel counts by: the server's at first (so the page hydrates with the text the server wrote), then
  // the browser's moved by the server's lead, so "8 s ago" is right even where the browser's clock is off
  const [now, setNow] = useState(initial.now);

  useEffect(() => {
    let skew = initial.now - Date.now(), state = initial.state, stop = false, timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(src, { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as NodeStatusOut;
            if (!stop) { skew = j.now - Date.now(); state = j.state; setS(j); }
          }
        } catch { /* offline for a moment: keep what we have */ }
      }
      // every ten seconds while it posts live, else every minute; a hidden tab asks nothing until it is shown again
      if (!stop) timer = setTimeout(poll, state === "live" ? 10e3 : 60e3);
    };
    timer = setTimeout(poll, state === "live" ? 10e3 : 60e3);
    const onVis = () => { if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", onVis);
    const clock = setInterval(() => setNow(Date.now() + skew), 1000);
    return () => { stop = true; clearTimeout(timer); clearInterval(clock); document.removeEventListener("visibilitychange", onVis); };
  }, [initial.now, initial.state, src]);

  const z = s.zone;
  const clock = (t: number) => clockLabel(t, z);
  const when = (t: number) => {
    const d = Math.round((dayStart(t, z) - dayStart(now, z)) / 864e5);
    return d === 0 ? `at ${clock(t)}` : d === 1 ? `tomorrow at ${clock(t)}` : d === -1 ? `yesterday at ${clock(t)}` : `${dayLabel(t, z)} at ${clock(t)}`;
  };
  // live, but no fresh post has reached this page for a while (the page or the node lost its connection): say so
  // until the next answer from the oracle tells what it is now
  const lost = s.state === "live" && s.at !== null && now - s.at > LIVE_FRESH_S * 1000;
  const st = lost ? { label: "Last seen live", dot: "bg-[#a7e3b6]" } : STATE[s.state];
  const lastPost = s.postAt ? `last post ${spanLabel(now - s.postAt)} ago${s.source === "post" && s.via ? ` over ${VIA[s.via]}` : ""}` : "";

  let line: ReactNode;
  switch (s.state) {
    case "live": line = <>Updated {secsAgo(now - (s.at ?? now))} ago{s.via ? ` over ${VIA[s.via]}` : ""}{s.window ? `, in its ${winName(s.window.name)}` : s.offWindow ? `, outside its windows ${OFF[s.offWindow] ?? ""}` : ""}</>; break;
    case "listening": line = <>In its {winName(s.window?.name ?? null)}{s.window?.end != null ? ` until ${clock(s.window.end)}` : ""} · {lastPost}</>; break;
    case "awake": line = <>Outside its listening windows{s.offWindow && OFF[s.offWindow] ? `, ${OFF[s.offWindow]}` : ""} · {lastPost}</>; break;
    case "on": line = <>{lastPost.replace(/^l/, "L")}</>; break;
    case "asleep": line = <>Asleep since {s.postAt ? clock(s.postAt) : "its last post"}{s.next?.kind === "wake" ? `, wakes ${when(s.next.at)} for its ${winName(s.next.name)}` : ""}</>; break;
    case "saving": line = <>Switched itself off {s.postAt ? when(s.postAt) : ""} to keep the battery; it starts again once the panel has lifted it above 13.2 V</>; break;
    case "quiet": line = s.window?.end != null && s.window.end < now
      ? <>Its {winName(s.window.name)} ended at {clock(s.window.end)}, and the post it sends before it sleeps has not arrived. It may be asleep with that post still queued.</>
      : <>No post for {s.postAt ? spanLabel(now - s.postAt) : "a while"}, so one is late. It posts every three hours while it is awake.</>; break;
    case "silent": line = <>Nothing heard since {s.postAt ? `${dayLabel(s.postAt, z)} ${clock(s.postAt)}` : "it was installed"}.</>; break;
    default: line = <>This node has not posted yet.</>;
  }

  // how far along to what comes next: the next post, the post at the window's end, or the wake
  let bar: { from: number; to: number; left: string; right: string } | null = null;
  if (s.next) {
    const n = s.next, left = now < n.at ? `in ${spanLabel(n.at - now)}` : "due now";
    if (n.kind === "post" && s.postAt) bar = { from: s.postAt, to: n.at, left: `last post ${clock(s.postAt)}`, right: `next post around ${clock(n.at)}, ${left}` };
    if (n.kind === "sleep") {
      const from = s.window?.start ?? s.postAt ?? n.at - 3600e3;
      bar = { from, to: n.at, left: s.window?.start != null ? `${winName(n.name)} opened ${clock(s.window.start)}` : `last post ${clock(from)}`, right: `${s.state === "live" ? "sleeps" : "posts once more and sleeps"} at ${clock(n.at)}, ${left}` };
    }
    if (n.kind === "wake" && s.postAt) bar = { from: s.postAt, to: n.at, left: `asleep since ${clock(s.postAt)}`, right: `wakes ${when(n.at)}, ${left}` };
  }

  const p = s.power, h = s.heat, l = s.link, snd = s.sound;
  // a reading older than the numbers around it says when it was taken
  const older = (t: number | null) => (t !== null && s.at !== null && s.at - t > 60e3 ? ` · read ${when(t)}` : "");
  const tiles: ReactNode[] = [];
  if (p.v !== null || p.piW !== null) tiles.push(
    <Tile key="power" icon={ICON.battery} label="Power" value={p.v !== null ? p.v.toFixed(2) : `${p.piW!.toFixed(1)}`} unit={p.v !== null ? "V" : "W drawn"}
      // at the battery's own terminals: under 12.8 V its last tenth is left, at 12.6 V the node switches itself off
      tone={p.src === "mppt" && p.v !== null ? (p.v < 12.6 ? "text-[#ff8a7a]" : p.v < 12.8 ? "text-[#f0b429]" : undefined) : undefined}
      sub={[p.src === "usb" ? "USB supply, on the desk" : p.src === "mppt" ? "battery, at the charge controller" : p.src === "wittypi" ? "battery, read at the Witty Pi" : "", p.v !== null && p.piW !== null ? `draws ${p.piW.toFixed(1)} W` : ""].filter(Boolean).join(" · ")}>
      {s.spark.v.length >= 2 ? <Spark pts={s.spark.v} minSpan={0.3} /> : <Spark pts={s.spark.piW} minSpan={0.5} />}
    </Tile>,
  );
  if (p.pvW !== null || p.charge) tiles.push(
    <Tile key="sun" icon={ICON.sun} label="Sun" value={p.pvW !== null ? p.pvW.toFixed(0) : "?"} unit="W from the panel"
      sub={[p.charge ? (CHARGE[p.charge] ?? p.charge) : "", p.yieldWh !== null ? `${p.yieldWh.toFixed(0)} Wh today` : ""].filter(Boolean).join(" · ")}>
      <Spark pts={s.spark.pvW} color="#f2cf63" minSpan={5} />
    </Tile>,
  );
  if (h.cpuC !== null) tiles.push(
    <Tile key="heat" icon={ICON.thermometer} label="Heat" value={h.cpuC.toFixed(0)} unit="°C processor" tone={h.throttle?.slowedNow ? "text-[#f0b429]" : undefined}
      sub={[h.boardC !== null ? `board ${h.boardC.toFixed(0)} °C` : "", !h.throttle ? "" : h.throttle.slowedNow ? "slowing itself down now" : h.throttle.slowedSinceBoot ? "slowed down since it woke" : h.throttle.lowVoltage ? "its supply dipped" : "at full speed"].filter(Boolean).join(" · ")}>
      <Spark pts={s.spark.cpuC} color="#f6a36b" minSpan={3} />
    </Tile>,
  );
  tiles.push(
    s.via === "wifi" || s.via === "lan" ? (
      <Tile key="link" icon={ICON.signal} label="Link" value={s.via === "wifi" ? "WiFi" : "Cable"} unit={s.via === "wifi" && l.wifiDbm !== null ? `${l.wifiDbm} dBm` : ""}
        sub={l.operator ? `4G stick: ${shortOp(l.operator)}${l.bars !== null ? `, ${QUALITY[l.bars]}` : ""}${older(l.at)}` : "no 4G stick answered"} />
    ) : l.operator ? (
      <Tile key="link" icon={ICON.signal} label="4G" value={<><Bars n={l.bars} />{shortOp(l.operator)}</>}
        sub={[l.rsrp !== null || l.rssi !== null ? `${l.rsrp ?? l.rssi} dBm${l.bars !== null ? `, ${QUALITY[l.bars]}` : ""}` : "", s.via === "4g" ? "posting over 4G" : ""].filter(Boolean).join(" · ") + older(l.at)}>
        <Spark pts={s.spark.rsrp} minSpan={6} />
      </Tile>
    ) : (
      <Tile key="link" icon={ICON.signal} label="4G" value="No reading" sub={s.source === "live" ? "no 4G stick answered" : "the 4G stick did not answer at its last posts"} />
    ),
  );
  tiles.push(
    <Tile key="sound" icon={ICON.bird} label="Sound" value={String(snd.today)} unit={`species today · ${snd.week} this week`}
      sub={snd.last ? `last: ${snd.last.species}, ${spanLabel(now - snd.last.t)} ago` : "nothing heard yet"}>
      <HourBars counts={snd.perHour} />
    </Tile>,
  );
  if (s.soil.length) {
    const [a, ...rest] = s.soil;
    tiles.push(
      <Tile key="soil" icon={ICON.drop} label="Soil" value={a.vwc !== null ? a.vwc.toFixed(0) : "?"} unit={`% water at ${a.depthCm ?? "?"} cm`}
        sub={[a.tempC !== null ? `${a.tempC.toFixed(1)} °C` : "", `${spanLabel(now - a.t)} ago`, ...rest.map((r) => `${r.depthCm ?? "?"} cm: ${r.vwc !== null ? `${r.vwc.toFixed(0)}%` : "?"}`)].filter(Boolean).join(" · ")}>
        <Spark pts={s.spark.vwc} color="#7cc4f2" minSpan={2} />
      </Tile>,
    );
  }
  tiles.push(
    s.upSince !== null ? (
      <Tile key="run" icon={ICON.clock} label="Running" value={spanLabel(now - s.upSince)} unit="up" sub={`${s.wake && WAKE[s.wake] ? WAKE[s.wake] : "started"} ${when(s.upSince)}`} />
    ) : s.postAt && (s.state === "asleep" || s.state === "saving") ? (
      <Tile key="run" icon={ICON.clock} label="Asleep" value={spanLabel(now - s.postAt)} sub={`since ${when(s.postAt).replace(/^at /, "")}${s.state === "saving" ? ", stopped by its battery guard" : ""}`} />
    ) : s.postAt ? (
      <Tile key="run" icon={ICON.clock} label="Last post" value={spanLabel(now - s.postAt)} unit="ago" sub={`${dayLabel(s.postAt, z)} ${clock(s.postAt)}`} />
    ) : null,
  );
  if (s.box.diskFreeMb !== null) tiles.push(
    <Tile key="store" icon={ICON.card} label="Storage" value={(s.box.diskFreeMb / 1000).toFixed(0)} unit="GB free"
      sub={[`${s.box.unsent ?? 0} post${s.box.unsent === 1 ? "" : "s"} queued`, s.box.clipsWaiting ? `${s.box.clipsWaiting} clips waiting` : ""].filter(Boolean).join(" · ")} />,
  );

  // an even grid: six tiles in two rows of three, seven or eight in rows of four
  const n = tiles.filter(Boolean).length;
  const cols = n <= 4 ? LG_COLS[Math.max(2, n)] : n <= 6 ? LG_COLS[3] : LG_COLS[4];

  return (
    <section aria-label="How the node is doing now" className="mt-6 rounded-2xl p-4 md:p-6 text-[#eef4ec] shadow-[0_14px_34px_-16px_rgba(20,48,30,0.6)]" style={{ background: "linear-gradient(135deg, #132c1b 0%, #1d3a24 55%, #27492e 100%)" }}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${st.dot} ${st.pulse ? "live-glow" : ""}`} />
            <span className="text-xl font-semibold tracking-tight">{st.label}</span>
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#bcd0c0]">{s.source === "live" ? "live readings" : s.source === "post" ? "last readings" : "no readings"}</span>
          </div>
          <p className="mt-1.5 text-sm text-[#d3e3d6]">{line}</p>
        </div>
        <p className="max-w-xs text-xs leading-snug text-[#a9c4ad] md:text-right">
          {s.liveEver ? `On WiFi or a cable it reports every ${LIVE_EVERY_S} seconds. On 4G it posts every three hours instead, to make its 500 MB SIM last ten years.` : "It posts every three hours while it is awake, so the numbers are from its last post."}
        </p>
      </div>
      {bar && (
        <div className="mt-4">
          <div className="flex flex-wrap justify-between gap-x-4 text-[11px] text-[#a9c4ad]"><span>{bar.left}</span><span>{bar.right}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-[#5ee08a]/75" style={{ width: `${Math.round(Math.min(1, Math.max(0.02, (now - bar.from) / Math.max(1, bar.to - bar.from))) * 100)}%` }} />
          </div>
        </div>
      )}
      <div className={`mt-4 grid grid-cols-2 gap-2.5 ${cols}`}>{tiles}</div>
      <p className="mt-3 text-[11px] leading-snug text-[#9fbea6]">
        Measured in the box and posted by the node; nothing here is modelled. The battery and the sun come from the charge controller when one is connected, otherwise the supply from the Witty Pi, which also reads the board&apos;s temperature; the processor&apos;s temperature comes from the Pi, the signal from the 4G stick. The lines show {s.spark.span === "live" ? "the last fifteen minutes" : "its last posts"} (the soil, two days); the bars, what it heard in each of the last 24 hours.
      </p>
    </section>
  );
}

const QUALITY = ["very weak", "weak", "fair", "good", "excellent"];
const LG_COLS: Record<number, string> = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

function Tile({ icon, label, value, unit, sub, tone, children }: { icon: ReactNode; label: string; value: ReactNode; unit?: string; sub?: string; tone?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-[7.5rem] min-w-0 flex-col rounded-xl border border-white/10 bg-white/[0.06] p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] text-[#9fbea6]"><LineIcon className="h-3.5 w-3.5">{icon}</LineIcon>{label}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className={`text-2xl font-semibold leading-tight tabular-nums ${tone ?? "text-white"}`}>{value}</span>
        {unit && <span className="text-xs text-[#bcd0c0]">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs leading-snug text-[#bcd0c0]">{sub}</div>}
      {children && <div className="mt-auto pt-2">{children}</div>}
    </div>
  );
}

/** A small line through the points, scaled to their own range but never to less than `minSpan`, so the noise in a
 * steady reading stays a flat line instead of filling the tile. */
function Spark({ pts, color = "#8ee0a4", h = 26, minSpan }: { pts: Pt[]; color?: string; h?: number; minSpan: number }) {
  if (pts.length < 2) return null;
  const W = 200;
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  if (y1 - y0 < minSpan) { const mid = (y0 + y1) / 2; y0 = mid - minSpan / 2; y1 = mid + minSpan / 2; }
  const sx = (t: number) => ((t - x0) / Math.max(1, x1 - x0)) * W;
  const sy = (v: number) => h - 2 - ((v - y0) / (y1 - y0)) * (h - 4);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none" className="block w-full" style={{ height: h }} aria-hidden="true">
      <path d={`${d} L${W},${h} L0,${h} Z`} fill={color} opacity="0.13" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Detections in each of the last 24 hours, oldest first: a dawn chorus shows as a rise on the left or right. */
function HourBars({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <div className="flex h-[26px] items-end gap-[2px]" aria-hidden="true">
      {counts.map((n, i) => <span key={i} className="flex-1 rounded-[1px] bg-[#8ee0a4]" style={{ height: `${n ? Math.max(10, (n / max) * 100) : 6}%`, opacity: n ? 0.85 : 0.18 }} />)}
    </div>
  );
}

/** Four signal bars, the strong ones lit. */
function Bars({ n }: { n: number | null }) {
  return (
    <span className="mr-2 inline-flex h-[18px] items-end gap-[2px] align-[-1px]" aria-hidden="true">
      {[1, 2, 3, 4].map((k) => <span key={k} className={`w-[4px] rounded-[1px] ${n !== null && k <= n ? "bg-white" : "bg-white/20"}`} style={{ height: `${k * 25}%` }} />)}
    </span>
  );
}
