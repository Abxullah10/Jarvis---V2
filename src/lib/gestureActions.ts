import { BRIDGE_HTTP_URL } from '../config'
import { hands, type Gesture } from './hands'
import { useStore } from '../store'

/**
 * Gestures that do something, beyond moving the cursor.
 *
 * Pointing, pinching, two fingers and the framing pose are already spoken for
 * — cursor, click and drag, scroll, resize. What was left unused was a closed
 * fist and a flat open palm, which is convenient: they are the two poses
 * hardest to make by accident while reaching for something.
 *
 * Everything here is deliberately *held* rather than tapped. A hand passes
 * through half the vocabulary on its way to anywhere — close it to point and
 * you have made a fist — so a pose that fires on sight fires constantly. A
 * pose that has to be held still for most of a second never fires by mistake,
 * and the progress ring on screen makes the wait legible rather than laggy.
 */

/** How long a pose must hold before it counts. Long enough not to happen in
 *  passing, short enough not to feel like waiting for a lift. */
const HOLD_MS = 700

/** After firing, the same pose cannot fire again until it has been released
 *  and remade. Without this a held fist repeats forever. */
const REARM_MS = 400

export type HandAction = {
  id: string
  label: string
  /** Runs it. Returns what happened, for the readout. */
  run: () => void | Promise<void>
}

async function os(action: string): Promise<void> {
  try {
    await fetch(`${BRIDGE_HTTP_URL}/os`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    })
  } catch {
    // The bridge being down is a normal state; a gesture that silently does
    // nothing is better than one that throws into a requestAnimationFrame.
  }
}

/**
 * What each pose does, as a chain: the same pose means the next thing in the
 * list each time, so two poses reach more than two actions.
 *
 * Kept here rather than in the component so the mapping is one list to read
 * and change, and so nothing about gestures leaks into the HUD.
 */
export const ACTIONS: Record<'fist' | 'open', HandAction[]> = {
  // A closed fist is the "stop" shape in every context that has one.
  fist: [
    {
      id: 'stand-down',
      label: 'Stand down',
      run: () => {
        const s = useStore.getState()
        if (s.phase !== 'offline') s.setPhase('dormant')
      },
    },
  ],
  // A flat palm held up is "attention" — the pose for asking for something.
  open: [
    { id: 'next-window', label: 'Next window', run: () => os('next-window') },
  ],
}

type Watch = {
  gesture: Gesture | null
  since: number
  firedAt: number
}

const watches = new Map<number, Watch>()

/** What fired most recently, for the on-screen readout. */
export const lastFired = { label: '', at: 0 }

/** How far through the hold each hand is, 0..1, for the progress ring. */
export const holdProgress = new Map<number, number>()

/**
 * Call once per animation frame while hand tracking is on.
 *
 * Returns nothing: the effects are the actions themselves plus the two
 * exported readouts, which the overlay draws. Written as a poll rather than an
 * event because hands.ts deliberately knows nothing about what is on screen,
 * and that is worth preserving.
 */
export function pollGestureActions(now = performance.now()): void {
  const live = new Set<number>()

  for (const hand of hands) {
    live.add(hand.id)
    const g = hand.gesture
    const actions = g === 'fist' || g === 'open' ? ACTIONS[g] : null

    let w = watches.get(hand.id)
    if (!w) {
      w = { gesture: null, since: now, firedAt: 0 }
      watches.set(hand.id, w)
    }

    // A different pose restarts the clock, and re-arms whatever fired before.
    if (w.gesture !== g) {
      w.gesture = g ?? null
      w.since = now
      w.firedAt = 0
    }

    if (!actions) {
      holdProgress.set(hand.id, 0)
      continue
    }

    const held = now - w.since
    const armed = w.firedAt === 0 || now - w.firedAt > REARM_MS
    holdProgress.set(hand.id, w.firedAt ? 0 : Math.min(1, held / HOLD_MS))

    if (held >= HOLD_MS && armed && !w.firedAt) {
      w.firedAt = now
      holdProgress.set(hand.id, 0)
      // One action per pose for now; the array shape is here so a pose can
      // cycle through several later without changing any of this.
      const action = actions[0]
      lastFired.label = action.label
      lastFired.at = now
      void action.run()
    }
  }

  for (const id of [...watches.keys()]) {
    if (!live.has(id)) {
      watches.delete(id)
      holdProgress.delete(id)
    }
  }
}
