import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { submit } from '../lib/submit'
import { DecodeText } from './DecodeText'

/**
 * Panel 07: the whole conversation, kept.
 *
 * The old log showed the last four turns and let them fade, which suits a
 * voice interface glanced at in passing but loses anything worth scrolling
 * back to. This keeps every turn of the session, pins to the newest unless
 * you have scrolled up to read, and takes typed input through the same path
 * the microphone uses.
 */
export function Comms() {
  const turns = useStore((s) => s.turns)
  const phase = useStore((s) => s.phase)
  const level = useStore((s) => s.level)
  const [draft, setDraft] = useState('')
  const list = useRef<HTMLDivElement>(null)
  // Only follow new messages if the reader is already at the bottom; yanking
  // them back down mid-scroll is the most irritating thing a chat log can do.
  const pinned = useRef(true)

  useEffect(() => {
    const el = list.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [turns])

  const onScroll = () => {
    const el = list.current
    if (!el) return
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const send = () => {
    if (!draft.trim()) return
    pinned.current = true
    submit(draft)
    setDraft('')
  }

  const prompt =
    phase === 'listening' ? 'LISTENING…' : phase === 'thinking' || phase === 'tooling' ? 'PROCESSING…' : 'TYPE A COMMAND'

  return (
    <section className="inst comms">
      <header className="inst-head">
        <span className="inst-n">07</span>
        <h2 className="inst-title">Comms</h2>
        <span className="inst-tag">VOICE.LINK</span>
      </header>

      <div className="comms-list" ref={list} onScroll={onScroll}>
        {turns.length === 0 && <p className="inst-empty">No messages yet. Say “Hey Jarvis” or type below.</p>}
        {turns.map((t, i) => (
          <div key={t.id} className={`comms-msg comms-${t.role}`}>
            <span className="comms-who">{t.role === 'user' ? 'USER' : 'JARVIS'}</span>
            <span className="comms-text">
              {/* Only the newest line decodes. A remounted older message would start its
                  decode from zero and replay it, so history stays plain text. */}
              {t.role === 'jarvis' && i === turns.length - 1 ? <DecodeText text={t.text} /> : t.text}
            </span>
          </div>
        ))}
      </div>

      <form
        className="comms-bar"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <span className="comms-caret">›</span>
        <input
          className="comms-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Space and the single-letter shortcuts are global hotkeys; typing
          // here must not fire them.
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={prompt}
          spellCheck={false}
          autoComplete="off"
        />
        <span className="comms-wave" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => {
            const weight = 1 - Math.abs(i - 4) / 6
            return <span key={i} style={{ height: `${Math.max(8, level * 100 * weight)}%` }} />
          })}
        </span>
      </form>
    </section>
  )
}
