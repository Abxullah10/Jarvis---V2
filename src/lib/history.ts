import type { Turn } from '../store'

/**
 * The conversation, kept across reloads.
 *
 * Stored in localStorage rather than on the bridge: it is this browser's view
 * of the conversation, it must survive the bridge being down, and it never
 * needs to leave the machine. JARVIS himself does not read it — the agent
 * session is separate and starts fresh — so this is the user's record, not his
 * memory.
 */

const KEY = 'jarvis.history'

/** Enough to scroll back through a working session without unbounded growth.
 *  The store itself keeps the last 40 turns in memory. */
const MAX = 200

/** A turn mid-stream has text still arriving; saving it would persist a
 *  half-written sentence if the page closed at the wrong moment. */
function clean(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.text.trim().length > 0).slice(-MAX)
}

export function loadHistory(): Turn[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Anything stored by an older version, or hand-edited, is skipped rather
    // than crashing the boot: a corrupt log should cost the history, not the app.
    return parsed.filter(
      (t): t is Turn =>
        !!t && typeof t === 'object' &&
        typeof (t as Turn).id === 'string' &&
        typeof (t as Turn).text === 'string' &&
        ((t as Turn).role === 'user' || (t as Turn).role === 'jarvis'),
    ).slice(-MAX)
  } catch {
    return []
  }
}

export function saveHistory(turns: Turn[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(clean(turns)))
  } catch {
    // Private mode, or the quota is full. Losing the log is not worth an error
    // in the middle of a conversation.
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY)
  } catch { /* nothing to do */ }
}
