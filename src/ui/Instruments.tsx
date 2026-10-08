import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BRIDGE_HTTP_URL } from '../config'
import { useStore } from '../store'

/**
 * The instrument panels down either side of the reactor.
 *
 * Everything here is real or it is a dash. The bridge serves /sys (cpu,
 * memory, network, GPU temperature, battery) and /weather (wttr.in, no key),
 * and anything the machine genuinely cannot answer — a thermal zone it does
 * not implement, a calendar nobody has connected — renders as an em dash
 * rather than a plausible-looking number. A dashboard that invents its own
 * telemetry is worse than none, because you cannot tell which half is lying.
 */

export type Sys = {
  cpu: number
  memUsed: number
  memTotal: number
  net: number | null
  temp: number | null
  battery: number | null
  uptime: number
  hostUptime: number
}

export type Weather = {
  temp: number
  desc: string
  humidity: number
  wind: number
  windDir: string
  place: string
  country: string
}

const DASH = '—'

/**
 * Polls a bridge endpoint and reports the round trip.
 *
 * The latency is measured, not modelled: it is how long this very request took
 * to come back, which is the only number the page can honestly put under the
 * word LATENCY.
 */
function useJson<T>(path: string, everyMs: number): { value: T | null; latency: number | null } {
  const [value, setValue] = useState<T | null>(null)
  const [latency, setLatency] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const t0 = performance.now()
      try {
        const r = await fetch(`${BRIDGE_HTTP_URL}${path}`)
        if (!r.ok) return
        const j = (await r.json()) as T
        if (!alive) return
        setValue(j)
        setLatency(Math.round(performance.now() - t0))
      } catch {
        // The bridge being down is a normal state — the face runs without it.
        // Keep the last good reading, but stop claiming a latency.
        if (alive) setLatency(null)
      }
    }
    void tick()
    const id = setInterval(tick, everyMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [path, everyMs])
  return { value, latency }
}

function Panel({ n, title, tag, children }: { n: string; title: string; tag: string; children: ReactNode }) {
  return (
    <section className="inst">
      <header className="inst-head">
        <span className="inst-n">{n}</span>
        <h2 className="inst-title">{title}</h2>
        <span className="inst-tag">{tag}</span>
      </header>
      <div className="inst-body">{children}</div>
    </section>
  )
}

/** A segmented bar, so it reads as an instrument rather than a progress bar. */
function Segments({ fraction }: { fraction: number }) {
  const total = 28
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * total)
  return (
    <div className="seg" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < lit ? 'seg-on' : 'seg-off'} />
      ))}
    </div>
  )
}

function Row({ label, value, fraction }: { label: string; value: string; fraction: number | null }) {
  return (
    <div className="inst-row">
      <div className="inst-line">
        <span className="inst-label">{label}</span>
        <span className="inst-value">{value}</span>
      </div>
      {fraction !== null && <Segments fraction={fraction} />}
    </div>
  )
}

const gb = (n: number) => (n / 1024 ** 3).toFixed(1)

function rate(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null) return DASH
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MB/S`
  return `${Math.round(bytesPerSecond / 1024)} KB/S`
}

export function Diagnostics({ sys }: { sys: Sys | null }) {
  return (
    <Panel n="01" title="Diagnostics" tag="SYS.DGN">
      <Row label="CPU LOAD" value={sys ? `${sys.cpu}%` : DASH} fraction={sys ? sys.cpu / 100 : null} />
      <Row
        label="MEMORY"
        value={sys ? `${gb(sys.memUsed)} / ${gb(sys.memTotal)} GB` : DASH}
        fraction={sys ? sys.memUsed / sys.memTotal : null}
      />
      <Row
        label="NETWORK"
        value={rate(sys?.net ?? null)}
        // A rate has no meaningful ceiling, so the bar is log-scaled against
        // roughly 10 MB/s rather than pretending to be a percentage.
        fraction={sys?.net != null ? Math.min(1, Math.log10(1 + sys.net / 1024) / 4) : null}
      />
      <Row
        label="GPU TEMP"
        value={sys?.temp != null ? `${sys.temp}°C` : DASH}
        fraction={sys?.temp != null ? sys.temp / 100 : null}
      />
    </Panel>
  )
}

/**
 * A real trace, not a random walk: every point is a CPU sample as it arrived,
 * so the line moves when the machine does and flatlines when it is idle.
 */
export function NeuralActivity({ sys }: { sys: Sys | null }) {
  const history = useRef<number[]>([])
  const phase = useStore((s) => s.phase)
  const last = useRef<Sys | null>(null)
  if (sys && sys !== last.current) {
    last.current = sys
    history.current = [...history.current, sys.cpu].slice(-48)
  }
  const points = history.current
  const d = points
    .map((v, i) => {
      const x = (i / Math.max(1, points.length - 1)) * 100
      const y = 100 - Math.max(0, Math.min(100, v))
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  return (
    <Panel n="02" title="Neural Activity" tag="NN.ACT">
      <div className="inst-line">
        <span className="inst-label">STATE</span>
        <span className="inst-value">{phase.toUpperCase()}</span>
      </div>
      <div className="trace">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {[25, 50, 75].map((y) => (
            <line key={y} x1="0" y1={y} x2="100" y2={y} className="trace-grid" />
          ))}
          {points.length > 1 && <path d={d} className="trace-line" />}
        </svg>
      </div>
    </Panel>
  )
}

/** A ring gauge. The dash offset is the reading. */
function Ring({ value, label }: { value: number | null; label: string }) {
  const r = 42
  const c = 2 * Math.PI * r
  return (
    <div className="ring">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} className="ring-track" />
        {value !== null && (
          <circle
            cx="50"
            cy="50"
            r={r}
            className="ring-fill"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - value / 100)}
            transform="rotate(-90 50 50)"
          />
        )}
        <text x="50" y="50" className="ring-text" dominantBaseline="central" textAnchor="middle">
          {value === null ? DASH : `${Math.round(value)}%`}
        </text>
      </svg>
      <span className="ring-label">{label}</span>
    </div>
  )
}

/**
 * "Arc output" is the battery and "reserve" is free memory: the mock-up's
 * labels, driven by the two reserves this machine actually has. A desktop
 * with no battery shows a dash rather than a fiction.
 */
export function Power({ sys }: { sys: Sys | null }) {
  const reserve = sys ? ((sys.memTotal - sys.memUsed) / sys.memTotal) * 100 : null
  return (
    <Panel n="03" title="Power" tag="PWR.CORE">
      <div className="rings">
        <Ring value={sys?.battery ?? null} label="ARC OUTPUT" />
        <Ring value={reserve} label="RESERVE" />
      </div>
    </Panel>
  )
}

export function Environment({ weather }: { weather: Weather | null }) {
  const tag = weather?.place ? `ENV.${weather.place.slice(0, 3).toUpperCase()}` : 'ENV'
  return (
    <Panel n="04" title="Environment" tag={tag}>
      <div className="env-top">
        <span className="env-temp">{weather ? `${weather.temp}°` : DASH}</span>
        <span className="env-where">
          <span>{weather ? `${weather.place}, ${weather.country}` : 'awaiting link'}</span>
          <span className="dim">{weather?.desc ?? ''}</span>
        </span>
      </div>
      <div className="inst-line">
        <span className="inst-label">HUMIDITY</span>
        <span className="inst-value">{weather ? `${weather.humidity}%` : DASH}</span>
      </div>
      <div className="inst-line">
        <span className="inst-label">WIND</span>
        <span className="inst-value">{weather ? `${weather.wind} KM/H ${weather.windDir}` : DASH}</span>
      </div>
    </Panel>
  )
}

/**
 * Empty until a calendar is connected. The mock-up showed three meetings;
 * those were illustrative, and inventing stand-ins would make a disconnected
 * panel indistinguishable from a working one.
 */
export function Schedule() {
  return (
    <Panel n="05" title="Schedule" tag="CAL">
      <p className="inst-empty">No calendar linked. Connect one and the day&apos;s agenda appears here.</p>
    </Panel>
  )
}

export function Modules() {
  const connected = useStore((s) => s.connected)
  const rows: { name: string; state: 'ONLINE' | 'STANDBY' }[] = [
    ...connected.map((c) => ({ name: c, state: 'ONLINE' as const })),
    { name: 'Web', state: 'ONLINE' as const },
  ]
  const online = rows.filter((r) => r.state === 'ONLINE').length
  return (
    <Panel n="06" title="Modules" tag={`${online} / ${rows.length} ONLINE`}>
      {rows.map((r) => (
        <div key={r.name} className="mod-row">
          <span className={`mod-dot mod-${r.state.toLowerCase()}`} />
          <span className="mod-name">{r.name}</span>
          <span className="mod-state">{r.state}</span>
        </div>
      ))}
    </Panel>
  )
}

/** Wall clock, date, and how long the bridge has been up. */
export function Clock({ sys }: { sys: Sys | null }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const pad = (n: number) => String(n).padStart(2, '0')
  const up = sys?.uptime ?? null
  const date = now
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase()
  return (
    <div className="clock">
      <div className="clock-time">
        {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
      </div>
      <div className="clock-date">
        {date}
        {up !== null &&
          ` · UP ${pad(Math.floor(up / 3600))}:${pad(Math.floor((up % 3600) / 60))}:${pad(up % 60)}`}
      </div>
    </div>
  )
}

/** One hook so Hud.tsx polls once and hands the readings to both columns. */
export function useInstruments() {
  const sys = useJson<Sys>('/sys', 2000)
  const weather = useJson<Weather>('/weather', 15 * 60_000)
  return { sys: sys.value, weather: weather.value, latency: sys.latency }
}
