import { useStore } from '../store'
import type { Phase } from '../store'

/**
 * The reactor dial.
 *
 * Drawn as SVG rather than in the 3D scene. The scene's reactor is an additive,
 * bloom-blown orb — its own source calls the clipping to white "the neon look
 * this piece wants" — and the design this is built to is the opposite: a crisp
 * instrument face with countable ticks, readable bearings and hard edges. Those
 * are two different pictures, and no amount of turning the bloom down turns one
 * into the other.
 *
 * Everything scales from the 1000x1000 viewBox, so the whole dial is one
 * `width` away from any size.
 */

const CENTRE = 500

/** Bearings around the rim, as the design has them. */
const BEARINGS = [
  { deg: 330, at: -30 },
  { deg: 30, at: 30 },
  { deg: 60, at: 60 },
  { deg: 120, at: 120 },
  { deg: 150, at: 150 },
  { deg: 210, at: 210 },
  { deg: 240, at: 240 },
  { deg: 300, at: 300 },
]

const statusFor: Record<Phase, string> = {
  offline: 'OFFLINE',
  boot: 'STARTING',
  dormant: 'STANDBY',
  waking: 'WAKING',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  tooling: 'WORKING',
  speaking: 'SPEAKING',
}

/** Polar to cartesian, 0° at twelve o'clock and clockwise, like a bearing. */
function at(angleDeg: number, radius: number) {
  const r = ((angleDeg - 90) * Math.PI) / 180
  return { x: CENTRE + radius * Math.cos(r), y: CENTRE + radius * Math.sin(r) }
}

/** An arc between two bearings, for the heavy segmented rings. */
function arc(from: number, to: number, radius: number) {
  const a = at(from, radius)
  const b = at(to, radius)
  const large = to - from > 180 ? 1 : 0
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${radius},${radius} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`
}

/** A full ring of radial ticks, every `step` degrees. */
function Ticks({
  radius,
  length,
  step,
  className,
}: {
  radius: number
  length: number
  step: number
  className: string
}) {
  const marks = []
  for (let d = 0; d < 360; d += step) {
    const a = at(d, radius)
    const b = at(d, radius + length)
    marks.push(
      <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={className} />,
    )
  }
  return <g>{marks}</g>
}

export function Reactor() {
  const phase = useStore((s) => s.phase)
  const level = useStore((s) => s.level)
  const ui = useStore((s) => s.ui)
  if (!ui.reactor.visible) return null

  const spinning = phase === 'thinking' || phase === 'tooling' || phase === 'waking'
  // The core breathes with the input level while listening, so the dial is a
  // meter and not a loop that plays regardless of what the microphone hears.
  const coreScale = phase === 'listening' ? 1 + Math.min(0.12, level * 0.3) : 1

  return (
    <div className="reactor-wrap" aria-hidden>
      <svg viewBox="0 0 1000 1000" className={`reactor${spinning ? ' reactor-busy' : ''}`}>
        <defs>
          <radialGradient id="core-glow">
            <stop offset="0%" stopColor="var(--core-hot)" stopOpacity="1" />
            <stop offset="45%" stopColor="var(--core-hot)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--core-hot)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Crosshairs: four short spurs at the cardinal points, outside everything */}
        {[0, 90, 180, 270].map((d) => {
          const a = at(d, 470)
          const b = at(d, 430)
          return <line key={d} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="r-cross" />
        })}

        {/* Bearing labels */}
        {BEARINGS.map(({ deg, at: angle }) => {
          const p = at(angle, 415)
          return (
            <text key={deg} x={p.x} y={p.y} className="r-bearing" textAnchor="middle" dominantBaseline="central">
              {String(deg).padStart(3, '0')}
            </text>
          )
        })}

        {/* Outer hairline ring */}
        <circle cx={CENTRE} cy={CENTRE} r={388} className="r-hair" />

        {/* The counter-rotating tick ring */}
        <g className="r-spin-slow">
          <Ticks radius={352} length={14} step={3} className="r-tick" />
          <circle cx={CENTRE} cy={CENTRE} r={344} className="r-hair-faint" />
        </g>

        {/* Heavy segmented ring — four arcs with gaps at the diagonals */}
        <g className="r-spin-fast">
          {[
            [8, 82],
            [98, 172],
            [188, 262],
            [278, 352],
          ].map(([f, t]) => (
            <path key={f} d={arc(f, t, 318)} className="r-arc" />
          ))}
        </g>

        {/* Dense inner tick band */}
        <g className="r-spin-slow-rev">
          <Ticks radius={248} length={34} step={2.5} className="r-tick-fine" />
        </g>

        {/* The segmented core shroud: eight trapezoid blades around the orb */}
        <g className="r-spin-blades">
          {Array.from({ length: 8 }, (_, i) => {
            const span = 38
            const from = i * 45 + (45 - span) / 2
            const to = from + span
            const outer = 196
            const inner = 136
            const a = at(from, outer)
            const b = at(to, outer)
            const c = at(to, inner)
            const d = at(from, inner)
            return (
              <path
                key={i}
                d={`M${a.x},${a.y} A${outer},${outer} 0 0 1 ${b.x},${b.y} L${c.x},${c.y} A${inner},${inner} 0 0 0 ${d.x},${d.y} Z`}
                className="r-blade"
              />
            )
          })}
        </g>

        {/* Core */}
        <g style={{ transform: `scale(${coreScale})`, transformOrigin: '500px 500px' }}>
          <circle cx={CENTRE} cy={CENTRE} r={190} fill="url(#core-glow)" className="r-glow" />
          <circle cx={CENTRE} cy={CENTRE} r={118} className="r-core" />
          <circle cx={CENTRE} cy={CENTRE} r={118} className="r-core-rim" />
        </g>

        <text x={CENTRE} y={486} className="r-name" textAnchor="middle">
          JARVIS
        </text>
        <g>
          <circle cx={CENTRE - 52} cy={528} r={6} className="r-state-dot" />
          <text x={CENTRE + 6} y={532} className="r-state" textAnchor="middle">
            {statusFor[phase]}
          </text>
        </g>
      </svg>
    </div>
  )
}

/**
 * The two callouts flanking the dial, with their leader lines. Separate from
 * the dial so they can sit against the frame rather than rotate with it.
 */
export function ReactorCallouts({ latency }: { latency: number | null }) {
  const phase = useStore((s) => s.phase)
  return (
    <div className="callouts" aria-hidden>
      <div className="callout callout-left">
        <span className="callout-label">LATENCY</span>
        <span className="callout-value">{latency === null ? '—' : `${latency} MS`}</span>
      </div>
      <div className="callout callout-right">
        <span className="callout-label">VOICE LINK</span>
        <span className="callout-value">
          {phase === 'offline' ? 'STANDBY' : 'ACTIVE'}
        </span>
      </div>
    </div>
  )
}
