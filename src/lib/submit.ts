/**
 * One way to start a turn, shared by the microphone and the chat box.
 *
 * `respond()` lives inside App's component closure — it owns the turn counter,
 * the speaker and the panel clearing — so the typed input cannot simply call
 * it. Rather than hoist all of that into the store or thread a callback down
 * through the HUD, App registers the function here once and anything that can
 * start a turn reaches for it.
 */

type Submit = (text: string) => void | Promise<void>

let current: Submit | null = null

export function setSubmit(fn: Submit | null): void {
  current = fn
}

/** Starts a turn with typed text. No-op before App has registered, which is
 *  only the first frame. */
export function submit(text: string): void {
  const t = text.trim()
  if (t) void current?.(t)
}

export function canSubmit(): boolean {
  return current !== null
}
