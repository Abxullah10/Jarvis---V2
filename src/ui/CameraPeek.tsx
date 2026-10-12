import { useEffect, useRef, useState } from 'react'
import { cameraStream } from '../lib/camera'

/**
 * What the camera can see, while it is on.
 *
 * An interface that watches you owes you a view of what it is watching. The
 * camera light says "on"; this says what "on" actually means right now — which
 * way it is pointing, whether you are in frame, whether it is seeing your hand
 * or your ceiling. Without it the only feedback when hand tracking misses you
 * is that nothing happens.
 *
 * Deliberately passive: it never calls holdCamera, only mirrors a stream some
 * other feature already opened. A preview that could keep the camera alive by
 * existing would be the exact opposite of what it is for.
 */
export function CameraPeek() {
  const el = useRef<HTMLVideoElement>(null)
  const [live, setLive] = useState(false)

  useEffect(() => {
    let gone = false
    // Captured once. Reading el.current in the cleanup would read whatever the
    // ref points at when the component unmounts, which is not necessarily the
    // element this effect attached the stream to.
    const node = el.current

    const sync = () => {
      if (gone) return
      const stream = cameraStream()
      const video = node
      setLive(Boolean(stream))
      if (!video) return
      if (stream) {
        // Re-pointing an element at the stream it already has restarts it, so
        // only assign on an actual change.
        if (video.srcObject !== stream) {
          video.srcObject = stream
          void video.play().catch(() => {
            // Autoplay can be refused before the first interaction. The user
            // has clicked INITIALISE by the time a camera is ever open, so
            // this is a last resort rather than a case worth reporting.
          })
        }
      } else if (video.srcObject) {
        video.srcObject = null
      }
    }

    sync()
    // Polled rather than subscribed: the camera is opened from several
    // unrelated places — the G key, a vision tool, a camera blade — and none
    // of them has any reason to know a preview exists. Half a second is well
    // under the time it takes to notice, and costs nothing.
    const timer = setInterval(sync, 500)
    return () => {
      gone = true
      clearInterval(timer)
      // Let go of the stream without touching the camera itself: the hold
      // belongs to whoever opened it.
      if (node) node.srcObject = null
    }
  }, [])

  return (
    <section className={`inst peek${live ? '' : ' peek-off'}`} aria-hidden={!live}>
      <header className="inst-head">
        <span className="inst-n">08</span>
        <h2 className="inst-title">Vision</h2>
        <span className="inst-tag">LIVE</span>
      </header>
      {/* Mirrored, because the hand overlay is mirrored: an unmirrored preview
          beside a mirrored skeleton has you reaching the wrong way. */}
      <video ref={el} className="peek-video" autoPlay playsInline muted />
    </section>
  )
}
