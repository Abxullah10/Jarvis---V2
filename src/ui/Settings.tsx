import { useCallback, useEffect, useRef, useState } from 'react'
import { BACKEND, BRIDGE_HTTP_URL } from '../config'
import { useStore } from '../store'
import { THEMES, THEME_ORDER } from '../theme'

/**
 * Settings: connected accounts, appearance, and where everything is kept.
 *
 * The page never holds a token. It shows what the bridge reports — status,
 * account name, when Google will sign it out — and the only secret it ever
 * touches is a Slack token typed into the field, which goes straight to the
 * bridge and is written to this machine.
 */

type Item = {
  id: 'gmail' | 'google-calendar' | 'slack'
  name: string
  kind: 'google' | 'token'
  status: 'connected' | 'disconnected' | 'expired' | 'error' | 'needs-setup'
  account?: string
  detail?: string
  expires?: string | null
}

type Storage = Record<string, string>

const BLURB: Record<Item['id'], string> = {
  gmail: 'Read, search and summarise your mail.',
  'google-calendar': 'See your schedule and upcoming events.',
  slack: 'Read channels and DMs you can see, and search them.',
}

async function call(path: string, body?: object) {
  const r = await fetch(`${BRIDGE_HTTP_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j.ok === false) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

function untilLabel(iso?: string | null) {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Google sign-in has expired'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  return `Google signs this out in ${days > 0 ? `${days}d ${hours}h` : `${hours}h`}`
}

function Row({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [askToken, setAskToken] = useState(false)
  const poll = useRef(0)

  useEffect(() => () => window.clearInterval(poll.current), [])

  const connectGoogle = async () => {
    setError(null)
    setBusy('Waiting for Google sign-in…')
    try {
      const r = await call('/integrations/connect', { id: item.id })
      if (r.url && !r.opened) window.open(r.url, '_blank', 'noopener')
      if (r.already) {
        setBusy(null)
        onChanged()
        return
      }
      // The sign-in finishes in another tab; watch for it to land.
      const started = Date.now()
      window.clearInterval(poll.current)
      poll.current = window.setInterval(async () => {
        try {
          const list = (await call('/integrations')).items as Item[]
          const now = list.find((x) => x.id === item.id)
          if (now?.status === 'connected' || Date.now() - started > 5 * 60_000) {
            window.clearInterval(poll.current)
            setBusy(null)
            onChanged()
          }
        } catch {
          /* bridge restarting; keep watching */
        }
      }, 3000)
    } catch (e) {
      setBusy(null)
      setError((e as Error).message)
    }
  }

  const connectSlack = async () => {
    setError(null)
    setBusy('Checking token with Slack…')
    try {
      await call('/integrations/connect', { id: 'slack', token })
      setToken('')
      setAskToken(false)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async () => {
    if (!window.confirm(`Disconnect ${item.name}? JARVIS will lose access until you connect it again.`)) return
    setError(null)
    setBusy('Disconnecting…')
    try {
      await call('/integrations/disconnect', { id: item.id })
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const connected = item.status === 'connected'
  const statusText = {
    connected: 'CONNECTED',
    disconnected: 'NOT CONNECTED',
    expired: 'SIGNED OUT',
    error: 'ERROR',
    'needs-setup': 'NEEDS SETUP',
  }[item.status]

  return (
    <div className={`set-row set-${item.status}`}>
      <div className="set-row-main">
        <span className="set-dot" />
        <div className="set-row-text">
          <div className="set-row-title">
            <span className="set-name">{item.name}</span>
            <span className="set-status">{statusText}</span>
          </div>
          <div className="set-sub">
            {connected ? item.account : BLURB[item.id]}
            {connected && item.expires && <span className="set-expiry"> · {untilLabel(item.expires)}</span>}
          </div>
          {item.status === 'needs-setup' && (
            <div className="set-note">
              Needs a Google Cloud sign-in key on this laptop first (~/.gmail-mcp/gcp-oauth.keys.json).
            </div>
          )}
          {(item.status === 'error' || item.status === 'expired') && item.detail && (
            <div className="set-note">{item.detail}</div>
          )}
        </div>
        <div className="set-actions">
          {busy ? (
            <span className="set-busy">{busy}</span>
          ) : item.kind === 'google' ? (
            item.status !== 'needs-setup' && (
              <>
                <button type="button" className="set-btn" onClick={connectGoogle}>
                  {connected ? 'Reconnect' : 'Connect'}
                </button>
                {item.status !== 'disconnected' && (
                  <button type="button" className="set-btn set-btn-quiet" onClick={disconnect}>
                    Disconnect
                  </button>
                )}
              </>
            )
          ) : (
            <>
              <button type="button" className="set-btn" onClick={() => setAskToken((v) => !v)}>
                {connected ? 'Replace token' : 'Connect'}
              </button>
              {item.status !== 'disconnected' && (
                <button type="button" className="set-btn set-btn-quiet" onClick={disconnect}>
                  Disconnect
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {askToken && !busy && (
        <form
          className="set-token"
          onSubmit={(e) => {
            e.preventDefault()
            void connectSlack()
          }}
        >
          <input
            type="password"
            className="set-input"
            placeholder="xoxp-… (Slack app → OAuth & Permissions → User OAuth Token)"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="set-btn" disabled={!token.trim()}>
            Save
          </button>
        </form>
      )}

      {error && <div className="set-error">{error}</div>}
    </div>
  )
}

export function Settings({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null)
  const [storage, setStorage] = useState<Storage>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const panel = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const j = await call('/integrations')
      setItems(j.items)
      setStorage(j.storage ?? {})
      setLoadError(null)
    } catch (e) {
      setLoadError(`Can't reach the bridge (${(e as Error).message}). Is npm start running?`)
    }
  }, [])

  useEffect(() => {
    void load()
    panel.current?.focus()
  }, [load])

  return (
    <div className="set-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="inst set-panel"
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-label="Settings"
        onKeyDown={(e) => {
          // Escape closes this, and must not also stand JARVIS down.
          if (e.key === 'Escape') onClose()
          e.stopPropagation()
        }}
      >
        <header className="inst-head">
          <span className="inst-n">00</span>
          <h2 className="inst-title">Settings</h2>
          <button type="button" className="set-close" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </header>

        <div className="set-scroll">
          <section className="set-section">
            <h3 className="set-h">Connections</h3>
            {loadError && <div className="set-error">{loadError}</div>}
            {!items && !loadError && <div className="set-sub">Checking connections…</div>}
            {items?.map((it) => <Row key={it.id} item={it} onChanged={load} />)}
            <p className="set-fine">
              Connecting or disconnecting restarts JARVIS's session so the change takes effect. He forgets the
              conversation so far; the chat log stays.
            </p>
          </section>

          <section className="set-section">
            <h3 className="set-h">Appearance</h3>
            <div className="set-themes">
              {THEME_ORDER.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`set-btn${t === theme ? ' set-btn-on' : ''}`}
                  onClick={() => setTheme(t)}
                >
                  {THEMES[t].label}
                </button>
              ))}
            </div>
          </section>

          <section className="set-section">
            <h3 className="set-h">Privacy</h3>
            <ul className="set-list">
              <li>
                <b>Your sign-ins stay on this laptop.</b> They live in your own Windows user folder, so another
                Windows account here can't see them and gets its own separate connections. None of it is in the
                Jarvis code or on GitHub.
              </li>
              <li>
                <b>Only this laptop can talk to JARVIS.</b> The bridge listens on 127.0.0.1, so nothing else on your
                Wi-Fi can reach him or your accounts through him.
              </li>
              <li>
                <b>What does leave the laptop:</b> when you ask about your mail, calendar or Slack, the parts needed
                to answer are sent to {BACKEND === 'gemini' ? 'Gemini (Google)' : 'Claude (Anthropic)'}, and his
                spoken replies are sent to ElevenLabs to be voiced.
                Nothing is sent until you ask.
              </li>
              <li>
                <b>Google signs JARVIS out every 7 days</b> while the Google app is in testing mode. Press Reconnect
                when it does.
              </li>
            </ul>
            {Object.keys(storage).length > 0 && (
              <div className="set-paths">
                {Object.entries(storage).map(([k, v]) => (
                  <div key={k}>
                    <span className="set-path-k">{k}</span> {v}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
