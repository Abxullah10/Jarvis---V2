/**
 * Connections to the user's own accounts: Gmail, Google Calendar, Slack.
 *
 * Everything here stays on this machine, under the Windows user's own profile,
 * so a second Windows account on the same laptop has its own separate set:
 *
 *   ~/.gmail-mcp/gcp-oauth.keys.json          the Google Cloud OAuth client
 *   ~/.gmail-mcp/credentials.json             Gmail sign-in
 *   ~/.config/google-calendar-mcp/tokens.json Calendar sign-in
 *   ~/.claude.json  (mcpServers)              which servers run, and the Slack token
 *
 * No token is ever returned to the browser. The page sees a status, the account
 * name and an expiry, and that is all; secrets only move inward, from a form
 * field into a local file.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const GOOGLE_KEY = join(HOME, '.gmail-mcp', 'gcp-oauth.keys.json')
const GMAIL_TOKEN = join(HOME, '.gmail-mcp', 'credentials.json')
const CALENDAR_TOKEN = join(HOME, '.config', 'google-calendar-mcp', 'tokens.json')
const CLAUDE_CONFIG = join(HOME, '.claude.json')

const PACKAGES = {
  gmail: '@gongrzhe/server-gmail-autoauth-mcp',
  'google-calendar': '@cocal/google-calendar-mcp',
  slack: 'slack-mcp-server@latest',
}

export const STORAGE = {
  googleClient: GOOGLE_KEY,
  gmail: GMAIL_TOKEN,
  calendar: CALENDAR_TOKEN,
  servers: CLAUDE_CONFIG,
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const registered = () => readJson(CLAUDE_CONFIG)?.mcpServers ?? {}

/** The calendar server nests its token under the account type ("normal"). */
function refreshTokenOf(file) {
  const t = readJson(file)
  if (!t) return null
  if (t.refresh_token) return t
  for (const v of Object.values(t)) if (v && typeof v === 'object' && v.refresh_token) return v
  return null
}

/** Kill a process and everything it started. On Windows, killing `cmd` leaves npx running. */
function killTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
  else child.kill()
}

function run(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('cmd', ['/c', ...args], { windowsHide: true, env: { ...process.env, ...env } })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ code, out }))
    child.on('error', (e) => resolve({ code: -1, out: String(e) }))
  })
}

/**
 * Register a server in Claude Code's user config, through its own CLI rather
 * than by editing ~/.claude.json: that file is Claude Code's live state and is
 * rewritten by it, so a hand edit can be lost or can clobber something.
 */
async function register(id, env = {}) {
  await run(['claude', 'mcp', 'remove', id, '--scope', 'user'])
  const envFlags = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
  const tail = id === 'slack' ? ['--transport', 'stdio'] : []
  const r = await run(['claude', 'mcp', 'add', '--scope', 'user', id, ...envFlags, '--', 'cmd', '/c', 'npx', '-y', PACKAGES[id], ...tail])
  if (r.code !== 0) throw new Error(`could not register ${id}: ${r.out.trim().slice(0, 200)}`)
}

async function unregister(id) {
  await run(['claude', 'mcp', 'remove', id, '--scope', 'user'])
}

// ---------------------------------------------------------------- status

const cache = new Map()
const CACHE_MS = 60_000
const invalidate = (id) => (id ? cache.delete(id) : cache.clear())

async function googleAccessToken(refreshToken) {
  const key = readJson(GOOGLE_KEY)?.installed
  if (!key) throw new Error('no Google client')
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: key.client_id,
      client_secret: key.client_secret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const j = await r.json()
  if (!r.ok) {
    const e = new Error(j.error_description || j.error || `HTTP ${r.status}`)
    e.expired = j.error === 'invalid_grant'
    throw e
  }
  return j.access_token
}

/** When Google will sign this app out: issue time (file mtime) plus the token's lifetime. */
function expiryOf(file, token) {
  const secs = Number(token?.refresh_token_expires_in)
  if (!secs) return null
  return new Date(statSync(file).mtimeMs + secs * 1000).toISOString()
}

async function googleStatus(id) {
  const file = id === 'gmail' ? GMAIL_TOKEN : CALENDAR_TOKEN
  const name = id === 'gmail' ? 'Gmail' : 'Google Calendar'
  const base = { id, name, kind: 'google' }
  if (!existsSync(GOOGLE_KEY)) return { ...base, status: 'needs-setup' }
  const token = refreshTokenOf(file)
  if (!token || !registered()[id]) return { ...base, status: 'disconnected' }
  const expires = expiryOf(file, token)
  try {
    const access = await googleAccessToken(token.refresh_token)
    const url =
      id === 'gmail'
        ? 'https://gmail.googleapis.com/gmail/v1/users/me/profile'
        : 'https://www.googleapis.com/calendar/v3/calendars/primary'
    const r = await fetch(url, { headers: { authorization: `Bearer ${access}` } })
    const j = await r.json()
    if (!r.ok) return { ...base, status: 'error', detail: j.error?.message ?? `HTTP ${r.status}`, expires }
    return { ...base, status: 'connected', account: id === 'gmail' ? j.emailAddress : j.id, expires }
  } catch (e) {
    return { ...base, status: e.expired ? 'expired' : 'error', detail: String(e.message), expires }
  }
}

async function slackStatus() {
  const base = { id: 'slack', name: 'Slack', kind: 'token' }
  const env = registered().slack?.env ?? {}
  const token = env.SLACK_MCP_XOXP_TOKEN || env.SLACK_MCP_XOXB_TOKEN
  if (!token) return { ...base, status: 'disconnected' }
  try {
    const r = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
    const j = await r.json()
    if (!j.ok) return { ...base, status: j.error === 'token_revoked' || j.error === 'invalid_auth' ? 'expired' : 'error', detail: j.error }
    return { ...base, status: 'connected', account: `${j.user} · ${j.team}` }
  } catch (e) {
    return { ...base, status: 'error', detail: String(e.message) }
  }
}

/**
 * Today's events from the primary calendar, for the Schedule panel.
 *
 * Read here rather than through the calendar MCP server because that server
 * answers JARVIS, not the HUD: the panel needs its own data without spending
 * a model turn to get it. Same token, same refresh path as the status check.
 *
 * Returns { events: [...] } or { error } — never a thrown exception, because
 * a panel with no calendar should render a dash, not take the HUD down.
 */
export async function todaysEvents() {
  const token = refreshTokenOf(CALENDAR_TOKEN)
  if (!token) return { error: 'not-connected', events: [] }
  try {
    const access = await googleAccessToken(token.refresh_token)
    // Local midnight to local midnight, so "today" means the user's today and
    // not UTC's — in Dubai those differ for four hours of every evening.
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '12',
    })
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { authorization: `Bearer ${access}` } },
    )
    const j = await r.json()
    if (!r.ok) return { error: j.error?.message ?? `HTTP ${r.status}`, events: [] }
    const events = (j.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary ?? '(no title)',
      // An all-day event carries `date`; a timed one carries `dateTime`.
      start: e.start?.dateTime ?? null,
      allDay: !e.start?.dateTime,
      where: e.location ?? '',
      status: e.status ?? 'confirmed',
    }))
    return { events }
  } catch (e) {
    return { error: e.expired ? 'expired' : String(e.message), events: [] }
  }
}

export async function listIntegrations() {
  const one = async (id, fn) => {
    const hit = cache.get(id)
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
    const value = await fn()
    cache.set(id, { at: Date.now(), value })
    return value
  }
  return Promise.all([
    one('gmail', () => googleStatus('gmail')),
    one('google-calendar', () => googleStatus('google-calendar')),
    one('slack', slackStatus),
  ])
}

// --------------------------------------------------------------- connect

const pendingAuth = new Map()

/**
 * Start a Google sign-in and hand back the consent URL as soon as the tool
 * prints it. The tool keeps running, listening on localhost for Google's
 * redirect; when it exits cleanly the server is registered and `onDone` fires.
 *
 * The calendar tool opens the default browser by itself and says so; `opened`
 * reports that, so the page does not open a second tab.
 */
export function connectGoogle(id, onDone) {
  if (!existsSync(GOOGLE_KEY)) {
    const e = new Error('No Google Cloud client on this machine yet.')
    e.code = 'needs-setup'
    return Promise.reject(e)
  }
  killTree(pendingAuth.get(id))
  return new Promise((resolve, reject) => {
    const child = spawn('cmd', ['/c', 'npx', '-y', PACKAGES[id], 'auth'], {
      cwd: HOME,
      windowsHide: true,
      env: { ...process.env, GOOGLE_OAUTH_CREDENTIALS: GOOGLE_KEY },
    })
    pendingAuth.set(id, child)
    let out = ''
    let url = null
    let settled = false
    const settle = (fn) => {
      if (settled) return
      settled = true
      fn()
    }
    const onData = (d) => {
      out += d
      if (!url) {
        const m = out.match(/https:\/\/accounts\.google\.com\/[^\s"'<>]+/)
        if (m) {
          url = m[0]
          // The "opened" line arrives just after the URL, if it arrives at all.
          setTimeout(() => settle(() => resolve({ url, opened: /opened automatically/i.test(out) })), 1500)
        }
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    const timer = setTimeout(() => {
      settle(() => reject(new Error('The sign-in tool did not produce a link.')))
      killTree(child)
    }, 90_000)
    child.on('close', async (code) => {
      clearTimeout(timer)
      pendingAuth.delete(id)
      if (code === 0) {
        try {
          await register(id, id === 'google-calendar' ? { GOOGLE_OAUTH_CREDENTIALS: GOOGLE_KEY.replace(/\\/g, '/') } : {})
        } catch (e) {
          console.warn(`[jarvis] ${e.message}`)
        }
        invalidate(id)
        // Exited cleanly without ever printing a link: it already had a valid token.
        settle(() => resolve({ url: null, opened: false, already: true }))
        onDone?.()
      } else {
        settle(() => reject(new Error(`Sign-in tool exited with code ${code}.`)))
      }
    })
  })
}

export async function connectSlack(token, onDone) {
  token = String(token ?? '').trim()
  if (!/^xox[pb]-[A-Za-z0-9-]+$/.test(token)) {
    throw new Error('That is not a Slack token. It should start with xoxp- (or xoxb- for a bot).')
  }
  const r = await fetch('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  })
  const j = await r.json()
  if (!j.ok) throw new Error(`Slack rejected that token (${j.error}).`)
  await register('slack', { [token.startsWith('xoxb-') ? 'SLACK_MCP_XOXB_TOKEN' : 'SLACK_MCP_XOXP_TOKEN']: token })
  invalidate('slack')
  onDone?.()
  return { account: `${j.user} · ${j.team}` }
}

// ------------------------------------------------------------ disconnect

export async function disconnect(id, onDone) {
  if (id === 'gmail' || id === 'google-calendar') {
    const file = id === 'gmail' ? GMAIL_TOKEN : CALENDAR_TOKEN
    const other = id === 'gmail' ? CALENDAR_TOKEN : GMAIL_TOKEN
    const token = refreshTokenOf(file)
    // Google's revoke endpoint withdraws the grant for the whole OAuth client,
    // not one token — and Gmail and Calendar share this client. Revoking while
    // the other is still connected would silently sign that one out too, so
    // only the last Google service to leave revokes at Google.
    if (token && !refreshTokenOf(other)) {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        body: new URLSearchParams({ token: token.refresh_token }),
      }).catch(() => {})
    }
    rmSync(file, { force: true })
  } else if (id === 'slack') {
    const env = registered().slack?.env ?? {}
    const token = env.SLACK_MCP_XOXP_TOKEN || env.SLACK_MCP_XOXB_TOKEN
    if (token) {
      await fetch('https://slack.com/api/auth.revoke', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {})
    }
  } else {
    throw new Error(`unknown integration ${id}`)
  }
  await unregister(id)
  invalidate(id)
  onDone?.()
}
