import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStore } from '../store'

/**
 * The start-up sequence: the arc reactor coming up to power.
 *
 * This was four hand-drawn SVG beats — status bar, reticle rings, suit
 * schematic, a built reactor — totalling nine seconds before the interface
 * appeared. It is now the rendered reactor clip, five seconds, and nothing
 * else: no caption, because the clip already titles itself on screen and a
 * second line of the same words underneath read as a subtitle track. JARVIS
 * still speaks over it; App says `BOOT_LINE` while this plays.
 *
 * So the overlay's only jobs are to fill the frame with the clip, hold its
 * last frame rather than flashing black if it finishes early, and get out of
 * the way on a fade.
 */

/** The spoken intro. Said over the clip, not shown — the video has the text. */
export const BOOT_LINE = 'All systems online. Good evening, sir.'

/** How long the overlay owns the screen, in ms — the clip plus a beat to land
 *  on. App's hand-off waits the same amount, from this same constant. */
export const BOOT_MS = 5600

export function Boot() {
  const phase = useStore((s) => s.phase)
  const video = useRef<HTMLVideoElement | null>(null)

  // Autoplay is safe here and only here: we are downstream of the ignition
  // click, which is what unlocked audio in the first place. A refusal is still
  // possible (a policy we do not control), and it costs the animation and
  // nothing else — the timed hand-off is not waiting on the video.
  useEffect(() => {
    if (phase !== 'boot') return
    const el = video.current
    if (!el) return
    el.currentTime = 0
    void el.play().catch(() => {})
  }, [phase])

  if (phase !== 'boot') return null

  return (
    <AnimatePresence>
      <motion.div
        className="boot"
        initial={{ opacity: 1 }}
        exit={{ opacity: 0, filter: 'blur(10px)' }}
        transition={{ duration: 0.8 }}
      >
        <video
          ref={video}
          className="boot-video"
          src="intro.mp4"
          playsInline
          preload="auto"
          /* No loop: a five-second clip that restarts under a 5.6s overlay
             reads as a stutter. The last frame is the reactor at full power,
             which is exactly what should be on screen at the hand-off. */
        />
      </motion.div>
    </AnimatePresence>
  )
}
