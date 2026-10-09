import { useEffect, useRef } from 'react'
import { BONES, INDEX_TIP, THUMB_TIP, TIPS, WRIST, diag, hands } from '../lib/hands'

/**
 * Your hands, drawn on the glass.
 *
 * A touchless interface without a visible cursor is a guessing game — you
 * cannot see your own hand against the screen, so you are aiming at a button
 * whose position relative to your finger you can only infer. A dot fixes that
 * much. Drawing the whole skeleton fixes the rest: you can watch the pinch
 * closing before it fires, see which finger the cursor is riding, and tell
 * instantly when tracking has lost you rather than wondering why nothing
 * responds.
 *
 * Canvas rather than DOM. Two hands is 42 joints and 42 bones redrawn every
 * frame; as elements that is ~90 nodes with their transforms rewritten sixty
 * times a second, which is exactly the workload a canvas exists for. It also
 * gets us glow for free — shadowBlur on a stroke is what makes this read as
 * projected light rather than as a wireframe.
 */

/** Bones are drawn twice: a wide soft pass for the glow, a tight bright one
 *  on top for the line itself. One pass with a big shadow reads as fog. */
const GLOW_WIDTH = 7
const LINE_WIDTH = 2

/**
 * How quickly the drawn hand catches up to the tracked one, as a time
 * constant in seconds.
 *
 * Tracking updates on camera frames; this canvas redraws on display frames.
 * At 30fps into a 60Hz screen that is one new position for every two redraws,
 * so the skeleton sits still and then jumps — choppy however well the 1€
 * filter is tuned, because the filter has nothing to say between frames.
 *
 * Easing the *drawing* fixes that without touching tracking: pinches, presses
 * and gestures keep using the true filtered position, so nothing becomes less
 * accurate and no input gains latency. Only the picture is interpolated.
 *
 * 12ms is deliberately shorter than a camera frame: the drawn point converges
 * on the real one well before the next sample lands, so this buys smoothness
 * for a fraction of a frame of visual delay rather than adding real lag.
 */
const EASE_TAU = 0.012

/** Past this, assume re-acquisition rather than movement and snap. A hand
 *  that was lost and found again must not slide across the screen. */
const SNAP_DISTANCE = 160

export function Pointer() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const raf = useRef(0)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let dpr = 1

    /**
     * Reconciled every frame rather than only on the resize event.
     *
     * Mounting is not a reliable moment to measure: a tab that is not yet
     * visible reports an inner width of zero, the canvas is sized 0x0, and
     * because no resize event ever follows it stays that way — the overlay is
     * present, the loop runs, and nothing is ever drawn. That failure is
     * completely silent, which is what makes it worth a comparison per frame.
     * It also covers the cases a listener handles badly: a window dragged to a
     * monitor with a different pixel ratio, and a tab restored from the
     * background.
     */
    const fit = () => {
      const nw = window.innerWidth
      const nh = window.innerHeight
      const ndpr = Math.min(window.devicePixelRatio || 1, 2)
      if (!nw || !nh) return false
      if (nw === w && nh === h && ndpr === dpr) return true
      w = nw
      h = nh
      dpr = ndpr
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      el.style.width = `${w}px`
      el.style.height = `${h}px`
      // Resizing the backing store resets the context, so the scale has to be
      // reapplied here rather than once at setup.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return true
    }

    /** The interface's current colour, so hands are lit like everything else. */
    const accentOf = () => {
      const hud = document.querySelector('.hud') as HTMLElement | null
      const c = hud && getComputedStyle(hud).getPropertyValue('--accent').trim()
      return c || '#19c4c4'
    }

    /** The drawn position of each hand, per hand id, easing toward the real
     *  one. Keyed by id so two hands never share a trail. */
    const drawn = new Map<number, { x: number; y: number }[]>()
    let lastFrameAt = 0

    const draw = (now = performance.now()) => {
      raf.current = requestAnimationFrame(draw)
      if (!fit()) return
      ctx.clearRect(0, 0, w, h)

      // Frame-rate independent easing. A dropped frame or a backgrounded tab
      // must not change how far the hand moves, only how many steps it takes.
      const dt = lastFrameAt ? Math.min((now - lastFrameAt) / 1000, 0.1) : 0
      lastFrameAt = now
      const k = dt > 0 ? 1 - Math.exp(-dt / EASE_TAU) : 1

      if (!diag.enabled || !hands.length) {
        drawn.clear()
        return
      }

      // Forget hands that are no longer tracked, or the map grows for the life
      // of the page as ids are handed out.
      const live = new Set(hands.map((hd) => hd.id))
      for (const id of [...drawn.keys()]) if (!live.has(id)) drawn.delete(id)

      const accent = accentOf()

      for (const hand of hands) {
        const target = hand.points
        if (!target || target.length < 21) continue

        let p = drawn.get(hand.id)
        if (!p || p.length !== target.length) {
          // First sight of this hand: start exactly where it is.
          p = target.map((q) => ({ x: q.x, y: q.y }))
          drawn.set(hand.id, p)
        } else {
          for (let i = 0; i < target.length; i++) {
            const dx = target[i].x - p[i].x
            const dy = target[i].y - p[i].y
            if (Math.abs(dx) + Math.abs(dy) > SNAP_DISTANCE) {
              p[i].x = target[i].x
              p[i].y = target[i].y
            } else {
              p[i].x += dx * k
              p[i].y += dy * k
            }
          }
        }

        // Line weight tracks how large the hand is on screen, so a hand held
        // close does not become a bundle of hairlines.
        const scale = Math.max(0.6, Math.min(2.2, hand.span / 90))
        const lit = hand.pinched ? 1 : 0.82 + hand.closeness * 0.18

        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'

        // -- bones: soft pass, then the bright line ------------------------
        ctx.globalAlpha = 0.4 * lit
        ctx.strokeStyle = accent
        ctx.shadowColor = accent
        ctx.shadowBlur = 22 * scale
        ctx.lineWidth = GLOW_WIDTH * scale
        ctx.beginPath()
        for (const [a, b] of BONES) {
          ctx.moveTo(p[a].x, p[a].y)
          ctx.lineTo(p[b].x, p[b].y)
        }
        ctx.stroke()

        ctx.globalAlpha = 1 * lit
        ctx.shadowBlur = 6 * scale
        ctx.lineWidth = LINE_WIDTH * scale
        ctx.beginPath()
        for (const [a, b] of BONES) {
          ctx.moveTo(p[a].x, p[a].y)
          ctx.lineTo(p[b].x, p[b].y)
        }
        ctx.stroke()

        // -- joints ---------------------------------------------------------
        ctx.globalAlpha = 0.95 * lit
        ctx.fillStyle = accent
        ctx.shadowBlur = 4 * scale
        for (let i = 0; i < p.length; i++) {
          if (i === INDEX_TIP) continue // the cursor draws its own
          const r = (TIPS.includes(i) ? 3.6 : i === WRIST ? 4 : 2.2) * scale
          ctx.beginPath()
          ctx.arc(p[i].x, p[i].y, r, 0, Math.PI * 2)
          ctx.fill()
        }

        // -- the pinch, as a closing gap ------------------------------------
        // A line between thumb and finger that brightens and shortens as they
        // meet. This is the single most useful thing on screen: it is the
        // press, visible before it happens.
        const t = p[THUMB_TIP]
        const x = p[INDEX_TIP]
        ctx.globalAlpha = 0.45 + hand.closeness * 0.55
        ctx.strokeStyle = hand.pinched ? '#ffffff' : accent
        ctx.shadowColor = hand.pinched ? '#ffffff' : accent
        ctx.shadowBlur = (6 + hand.closeness * 16) * scale
        ctx.lineWidth = (0.8 + hand.closeness * 1.6) * scale
        ctx.setLineDash(hand.pinched ? [] : [4 * scale, 4 * scale])
        ctx.beginPath()
        ctx.moveTo(t.x, t.y)
        ctx.lineTo(x.x, x.y)
        ctx.stroke()
        ctx.setLineDash([])

        // -- the cursor -----------------------------------------------------
        // Drawn at the hand's aimed point rather than at the raw fingertip:
        // that point drifts to the middle of the pinch as the fingers close,
        // which is where a press actually lands.
        const cx = hand.x
        const cy = hand.y
        const ring = (17 - hand.closeness * 8) * scale

        ctx.globalAlpha = 0.75 + hand.closeness * 0.25
        ctx.strokeStyle = hand.pinched ? '#ffffff' : accent
        ctx.shadowColor = hand.pinched ? '#ffffff' : accent
        ctx.shadowBlur = 14 * scale
        ctx.lineWidth = 1.5 * scale
        ctx.beginPath()
        ctx.arc(cx, cy, ring, 0, Math.PI * 2)
        ctx.stroke()

        if (hand.pinched) {
          // A filled core on contact. This is the only feedback that the press
          // actually fired, so it is deliberately unmistakable.
          ctx.globalAlpha = 0.28
          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(cx, cy, ring, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.globalAlpha = 1
        ctx.fillStyle = hand.pinched ? '#ffffff' : accent
        ctx.shadowBlur = 10 * scale
        ctx.beginPath()
        ctx.arc(cx, cy, (hand.pinched ? 4.2 : 3) * scale, 0, Math.PI * 2)
        ctx.fill()

        // -- what it thinks you are doing -----------------------------------
        // Below the wrist, quiet. Worth showing because when a gesture is
        // misread this is the only way to see that it was read at all.
        if (hand.gesture !== 'none') {
          ctx.globalAlpha = 0.72
          ctx.shadowBlur = 0
          ctx.fillStyle = accent
          ctx.font = `500 ${Math.round(9 * Math.min(scale, 1.4))}px ui-monospace, monospace`
          ctx.textAlign = 'center'
          // Which hand, and what it is doing. Naming the hand matters once
          // there are two of them: it is the only way to tell at a glance
          // which cursor is yours to move.
          const tag = `${hand.handedness === 'right' ? 'RIGHT' : 'LEFT'} · ${hand.gesture.toUpperCase()}`
          ctx.fillText(tag, p[WRIST].x, p[WRIST].y + 22 * scale)
        }
      }

      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
    }

    draw()
    return () => cancelAnimationFrame(raf.current)
  }, [])

  return <canvas ref={canvas} className="hands-canvas" aria-hidden="true" />
}
