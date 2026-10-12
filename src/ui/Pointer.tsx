import { useEffect, useRef } from 'react'
import { INDEX_TIP, THUMB_TIP, TIPS, WRIST, diag, hands } from '../lib/hands'
import { holdProgress, pollGestureActions } from '../lib/gestureActions'

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

/**
 * The fingers, as chains from the hand outward.
 *
 * BONES is a flat list of pairs, which is all you need to draw sticks of equal
 * weight. Tapering needs to know how far along a finger each segment is, so
 * the same skeleton is expressed here as five runs instead.
 */
const CHAINS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4], // thumb
  [0, 5, 6, 7, 8], // index
  [9, 10, 11, 12], // middle
  [13, 14, 15, 16], // ring
  [0, 17, 18, 19, 20], // pinky
]

/** The knuckle line, which is also the far edge of the palm membrane. */
const PALM: readonly number[] = [5, 9, 13, 17]

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

      // Driven from here because this already runs once a frame while hands
      // are up, and stops when they are not. A timer of its own would have to
      // learn when tracking starts and stops, which is state that lives here.
      pollGestureActions(now)

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

        // -- the targeting bracket ------------------------------------------
        // Corner marks around the hand's bounds, matching the brackets on the
        // instrument panels. It says the system has *acquired* the hand rather
        // than merely drawn one, and it is the clearest signal that tracking
        // is holding you: the bracket is steady when tracking is.
        let minX = Infinity
        let minY = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        for (const q of p) {
          if (q.x < minX) minX = q.x
          if (q.y < minY) minY = q.y
          if (q.x > maxX) maxX = q.x
          if (q.y > maxY) maxY = q.y
        }
        const pad = 16 * scale
        const arm = Math.min(18 * scale, (maxX - minX) / 3)
        minX -= pad; minY -= pad; maxX += pad; maxY += pad
        ctx.globalAlpha = 0.3 * lit
        ctx.strokeStyle = accent
        ctx.shadowColor = accent
        ctx.shadowBlur = 0
        ctx.lineWidth = 1.2 * scale
        ctx.beginPath()
        for (const [cxb, cyb, sx, sy] of [
          [minX, minY, 1, 1], [maxX, minY, -1, 1],
          [minX, maxY, 1, -1], [maxX, maxY, -1, -1],
        ] as const) {
          ctx.moveTo(cxb + sx * arm, cyb)
          ctx.lineTo(cxb, cyb)
          ctx.lineTo(cxb, cyb + sy * arm)
        }
        ctx.stroke()

        // -- the palm, as a membrane ----------------------------------------
        // Five sticks from a wrist is a diagram; a filled palm is a hand. Kept
        // very low alpha so it reads as the light passing through a projection
        // rather than as a solid object sitting over the interface.
        ctx.globalAlpha = 0.14 * lit
        ctx.fillStyle = accent
        ctx.shadowBlur = 0
        ctx.beginPath()
        ctx.moveTo(p[WRIST].x, p[WRIST].y)
        for (const i of PALM) ctx.lineTo(p[i].x, p[i].y)
        ctx.closePath()
        ctx.fill()

        // -- bones: soft pass, then the bright line, tapered ----------------
        // Drawn per finger rather than as one path so the line can thin toward
        // the fingertips. A uniform width is what makes a skeleton read as
        // scaffolding; tapering is most of what makes it read as anatomy.
        const strokeChains = (widthAt: (step: number, of: number) => number) => {
          for (const chain of CHAINS) {
            for (let i = 0; i < chain.length - 1; i++) {
              ctx.lineWidth = widthAt(i, chain.length - 1)
              ctx.beginPath()
              ctx.moveTo(p[chain[i]].x, p[chain[i]].y)
              ctx.lineTo(p[chain[i + 1]].x, p[chain[i + 1]].y)
              ctx.stroke()
            }
          }
        }

        ctx.globalAlpha = 0.34 * lit
        ctx.strokeStyle = accent
        ctx.shadowColor = accent
        ctx.shadowBlur = 20 * scale
        strokeChains((i, of) => GLOW_WIDTH * scale * (1 - (i / of) * 0.45))

        ctx.globalAlpha = 1 * lit
        ctx.shadowBlur = 6 * scale
        strokeChains((i, of) => LINE_WIDTH * scale * (1 - (i / of) * 0.5))

        // The knuckle arch last and fainter: it is connective tissue, not a
        // finger, and at full weight it draws the eye to the wrong place.
        ctx.globalAlpha = 0.5 * lit
        ctx.lineWidth = LINE_WIDTH * 0.8 * scale
        ctx.beginPath()
        for (let i = 0; i < PALM.length - 1; i++) {
          ctx.moveTo(p[PALM[i]].x, p[PALM[i]].y)
          ctx.lineTo(p[PALM[i + 1]].x, p[PALM[i + 1]].y)
        }
        ctx.stroke()

        // -- joints ---------------------------------------------------------
        ctx.globalAlpha = 0.95 * lit
        ctx.fillStyle = accent
        ctx.shadowBlur = 4 * scale
        for (let i = 0; i < p.length; i++) {
          if (i === INDEX_TIP) continue // the cursor draws its own
          if (TIPS.includes(i)) continue // tips get their own treatment below
          const r = (i === WRIST ? 4 : 2.2) * scale
          ctx.beginPath()
          ctx.arc(p[i].x, p[i].y, r, 0, Math.PI * 2)
          ctx.fill()
        }

        // -- fingertips ------------------------------------------------------
        // A ring rather than a dot. The fingertips are the business end of a
        // hand and the only joints you aim with, so they are the one part
        // worth drawing as a deliberate mark instead of another blob.
        for (const i of TIPS) {
          if (i === INDEX_TIP) continue
          ctx.globalAlpha = 0.9 * lit
          ctx.shadowBlur = 10 * scale
          ctx.lineWidth = 1.4 * scale
          ctx.strokeStyle = accent
          ctx.beginPath()
          ctx.arc(p[i].x, p[i].y, 4.2 * scale, 0, Math.PI * 2)
          ctx.stroke()
          ctx.globalAlpha = 0.5 * lit
          ctx.beginPath()
          ctx.arc(p[i].x, p[i].y, 1.5 * scale, 0, Math.PI * 2)
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

        // -- a gesture arming -----------------------------------------------
        // An action pose has to be held, and a wait with no feedback is
        // indistinguishable from a thing that does not work. The arc closing
        // says both that the pose was recognised and how much longer to hold.
        const arming = holdProgress.get(hand.id) ?? 0
        if (arming > 0) {
          const r = 17 * scale
          ctx.globalAlpha = 0.25
          ctx.strokeStyle = accent
          ctx.lineWidth = 2.5 * scale
          ctx.shadowBlur = 0
          ctx.beginPath()
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.stroke()

          ctx.globalAlpha = 1
          ctx.shadowColor = accent
          ctx.shadowBlur = 10 * scale
          ctx.beginPath()
          // From twelve o'clock, clockwise, like anything else that fills up.
          ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + arming * Math.PI * 2)
          ctx.stroke()
        }

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
