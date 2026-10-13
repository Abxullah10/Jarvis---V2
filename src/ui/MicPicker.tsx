import { useEffect, useRef, useState } from 'react'
import { chosenMic, listMics, setChosenMic, type MicOption } from '../lib/mic'

/**
 * Pick which microphone JARVIS listens to.
 *
 * Worth a control in the top bar rather than a line in Settings, because the
 * failure it cures is both common and completely silent: this machine has
 * three active inputs, Windows hands out whichever it currently calls the
 * default, and a headset connecting in another room is enough to make him stop
 * hearing anything with no error shown anywhere.
 *
 * Device labels are empty until the page has been granted the microphone once,
 * so the list is read after boot and refreshed when the hardware changes.
 */
export function MicPicker() {
  const [mics, setMics] = useState<MicOption[]>([])
  const [chosen, setChosen] = useState(chosenMic())
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      void listMics().then((m) => {
        if (alive) setMics(m)
      })
    }
    load()
    // Plugging in or removing a microphone changes the list under us.
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', load)
    }
  }, [])

  // Close when the click lands anywhere else.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const pick = (deviceId: string) => {
    setChosenMic(deviceId)
    setChosen(deviceId)
    setOpen(false)
    /**
     * Reloaded rather than swapped in place.
     *
     * The microphone is opened once at boot and held by the detector, the
     * recorder and the reactor's analyser for the life of the session. Giving
     * each of them a new device mid-flight means tearing down and rebuilding
     * the whole voice loop, and getting that subtly wrong is how you end up
     * with the silent-stream bug this picker exists to work around. A reload
     * is a second of the ignition screen and is certain to be correct.
     */
    window.location.reload()
  }

  const current = mics.find((m) => m.deviceId === chosen)
  const label = current ? current.label : 'System default'

  return (
    <div className="mic-picker" ref={box}>
      <button
        type="button"
        className="theme-switch mic-open"
        onClick={() => setOpen((v) => !v)}
        title="Choose which microphone JARVIS listens to"
      >
        <span className="mic-glyph" aria-hidden="true">
          🎙
        </span>
        <span className="mic-label">{shorten(label)}</span>
      </button>

      {open && (
        <div className="mic-menu" role="menu">
          <button
            type="button"
            className={`mic-item${chosen === '' ? ' mic-item-on' : ''}`}
            onClick={() => pick('')}
            role="menuitem"
          >
            System default
          </button>
          {mics
            .filter((m) => m.deviceId !== 'default')
            .map((m) => (
              <button
                key={m.deviceId}
                type="button"
                className={`mic-item${chosen === m.deviceId ? ' mic-item-on' : ''}`}
                onClick={() => pick(m.deviceId)}
                role="menuitem"
              >
                {m.label}
              </button>
            ))}
          {mics.length === 0 && (
            <div className="mic-empty">No microphones found. Power JARVIS up first.</div>
          )}
          <div className="mic-note">Changing this restarts JARVIS.</div>
        </div>
      )}
    </div>
  )
}

/** Windows device names are long; the menu shows them in full. */
function shorten(label: string): string {
  const stripped = label.replace(/^(Default|Communications)\s*-\s*/i, '')
  const named = stripped.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
  return named.length > 22 ? `${named.slice(0, 21)}…` : named
}
