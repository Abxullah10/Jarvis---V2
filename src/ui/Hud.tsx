import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore, accentFor, type Phase } from '../store'
import { THEMES, THEME_ORDER } from '../theme'
import { BRIDGE_HTTP_URL } from '../config'
import { Suggestions } from './Suggestions'
import { BladeSweep, Blades } from './Blades'
import { Effects } from './Effects'
import { Pointer } from './Pointer'
import { GestureGuide } from './GestureGuide'
import {
  Clock,
  Diagnostics,
  Environment,
  NeuralActivity,
  Power,
  useInstruments,
} from './Instruments'
import { ReactorCallouts } from './Reactor'
import { Comms } from './Comms'

const statusText: Record<Phase, string> = {
  offline: 'OFFLINE',
  boot: 'INITIALISING',
  dormant: 'STANDBY — SAY “HEY JARVIS”',
  waking: 'ONLINE',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  tooling: 'ACCESSING SYSTEMS',
  speaking: 'RESPONDING',
}

function Corner({ at }: { at: 'tl' | 'tr' | 'bl' | 'br' }) {
  return <div className={`corner corner-${at}`} />
}

/* --------------------------------------------------------------------- hud */

export function Hud() {
  const phase = useStore((s) => s.phase)
  const caption = useStore((s) => s.caption)
  const activeTool = useStore((s) => s.activeTool)
  const error = useStore((s) => s.error)
  const voice = useStore((s) => s.voice)
  const bootNote = useStore((s) => s.bootNote)
  const gestures = useStore((s) => s.gestures)
  const looking = useStore((s) => s.looking)
  const ui = useStore((s) => s.ui)
  const theme = useStore((s) => s.theme)
  const cycleTheme = useStore((s) => s.cycleTheme)

  // Polled once here and handed down, so six panels don't open six pollers.
  const { sys, weather, latency } = useInstruments()

  // accentFor folds JARVIS's overrides in over the phase colour, so one
  // variable on the root carries a theme change into every .hud-* rule without
  // a single component knowing a theme exists.
  const colour = accentFor(phase, ui, theme)

  useEffect(() => {
    // The ground has to be set on the document, not painted here: the HUD sits
    // above the 3D scene, so a background drawn inside it would cover the
    // reactor rather than sit behind it. --bg is what html, body, #root and the
    // boot screen all pin themselves to.
    const root = document.documentElement
    if (ui.background) root.style.setProperty('--bg', ui.background)
    else root.style.removeProperty('--bg')
  }, [ui.background])

  return (
    <div className="hud" style={{ ['--accent' as string]: colour }}>
      {/* First in the tree on purpose. Everything after it is positioned with
          `z-index: auto`, so paint order is document order and the sweep stays
          behind the transcript and the panels without a z-index war. */}
      <BladeSweep />

      <Corner at="tl" />
      <Corner at="tr" />
      <Corner at="bl" />
      <Corner at="br" />

      <header className="hud-top">
        {ui.chrome.brand && (
          <div className="brand">
            <span className="brand-mark">J.A.R.V.I.S.</span>
            <span className="brand-sub">Just A Rather Very Intelligent System</span>
          </div>
        )}

        <button
          type="button"
          className="theme-switch"
          onClick={cycleTheme}
          title="Switch theme (C)"
        >
          <span className="theme-swatch" />
          {THEMES[theme].label}
        </button>

        <Clock sys={sys} />

        <div className="status">
          <span className="dot" />
          <span className="status-text">
            {/* bootNote is the voice-model download readout. It is only ever
                the right thing to show during boot — as a general fallback a
                note that never got cleared (a stuck 'voice 97%') sits over
                LISTENING and PROCESSING for the rest of the session. */}
            {phase === 'boot' && bootNote ? bootNote : statusText[phase]}
          </span>
        </div>
      </header>

      <ReactorCallouts latency={latency} />

      {/* Left column: the machine and the world around it. Every reading
          comes from the bridge's /sys and /weather endpoints. */}
      {ui.chrome.systems && (
        <aside className="column column-left">
          <Diagnostics sys={sys} />
          <NeuralActivity sys={sys} />
          <Power sys={sys} />
          <Environment weather={weather} />
        </aside>
      )}

      {/* The right column is the conversation (panel 07, below). Schedule and
          Modules are off screen until there is room or a calendar worth
          showing; both components are still exported from Instruments. */}

      <AnimatePresence>
        {activeTool && ui.chrome.toolBadge && (
          <motion.div
            className="tool-badge"
            // Anchored to the TOP of the frame, not the middle. The old home was
            // viewport-centre plus a fixed drop, which on a tall or square
            // window landed the headline straight on top of the bottom
            // transcript — two elements pinned to different edges of the screen
            // were always going to meet somewhere. Up here it sits in its own
            // band with the rest of the status chrome and can never collide with
            // the log. Framer owns `transform` on an animated element, so the
            // centring (x: -50%) lives in these props, not the stylesheet.
            initial={{ opacity: 0, x: '-50%', y: -8, filter: 'blur(6px)' }}
            animate={{ opacity: 1, x: '-50%', y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, x: '-50%', y: -8, filter: 'blur(6px)' }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            <span className="tool-kicker">
              <span className="spinner" />
              accessing
            </span>
            <span className="tool-name">{activeTool.replace(/[_-]/g, ' ')}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Panel 07: the full conversation, kept, with typed input. */}
      {ui.chrome.transcript && <Comms />}

      <AnimatePresence>
        {caption && (
          <motion.div
            className="caption"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {caption}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The one surface. Panels used to sit alongside this as a second place
          for things to appear, which meant two places to look and a decision
          the model had to make on grounds it could not know. Everything renders
          here now; Panels.tsx is unmounted rather than deleted so the design
          system it documents stays findable. */}
      <Blades />

      {ui.chrome.suggestions && <Suggestions />}

      {error && <div className="error">{error}</div>}

      <footer className="hud-bottom">
        <span className="hint">
          say <b>“hey jarvis”</b> · <kbd>Space</kbd> to talk · <kbd>G</kbd> hands
          {voice && (
            <>
              {' · '}
              <kbd>V</kbd> voice: {voice.replace(/\(.*?\)/g, '').trim()}
            </>
          )}
        </span>
      </footer>

      {/* Last, so a flash or a tear reads as being on the glass rather than
          underneath the chrome. It is pointer-events: none and unmounts the
          instant it finishes. */}
      <Effects />

      {/* Above even the effects: the reticle shows where a press will land, and
          a press that lands under a flourish is a press you cannot aim. */}
      <Pointer />
      {(gestures || looking) && (
        <div className="hands-live">
          {looking ? `LOOKING — ${looking.toUpperCase()}` : 'CAMERA ON · G TO STOP'}
        </div>
      )}
      <GestureGuide live={gestures} />

      <footer className="hud-foot">
        <span>SECURE CHANNEL · LOCAL · {BRIDGE_HTTP_URL.replace(/^https?:\/\//, '')}</span>
        <span>
          THEME {THEME_ORDER.indexOf(theme) + 1} / {THEMES[theme].label}
        </span>
      </footer>
    </div>
  )
}
