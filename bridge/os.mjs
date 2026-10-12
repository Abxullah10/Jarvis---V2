/**
 * Keystrokes the operating system hears, for the things a web page cannot do.
 *
 * A page is sealed inside the browser by design: it cannot switch Chrome's
 * tabs, alt-tab to another app, or touch the volume. That boundary is a good
 * one and this does not breach it — the browser still cannot do any of it.
 * Instead the page asks the bridge, which runs on the machine as the user, and
 * the bridge presses the key.
 *
 * Why an allowlist rather than "send these keys".
 *
 * A general "type this for me" endpoint reachable from a page is a keylogger
 * in reverse: anything that can reach it can type anything into whatever
 * window happens to be focused — a terminal, a password box, a bank form. The
 * bridge is bound to localhost and checks Origin, but neither is a reason to
 * build the general version. So the vocabulary is fixed here, every entry is
 * something a person would be happy to have happen by accident, and nothing
 * destructive is in it: no Ctrl+W, no Alt+F4, no Enter.
 */
import { spawn } from 'node:child_process'

/** Windows virtual-key codes, by the names they are known by. */
const VK = {
  tab: 0x09,
  shift: 0x10,
  ctrl: 0x11,
  alt: 0x12,
  esc: 0x1b,
  left: 0x25,
  right: 0x27,
  win: 0x5b,
  mute: 0xad,
  volumeDown: 0xae,
  volumeUp: 0xaf,
  nextTrack: 0xb0,
  prevTrack: 0xb1,
  playPause: 0xb3,
}

/**
 * Every action the page may ask for, and nothing else.
 *
 * `repeat` exists because one volume keypress is about two percent, which is
 * far too fine a step for a gesture — a hand asking for "louder" means a
 * noticeable amount louder.
 */
const ACTIONS = {
  'volume-up': { keys: [VK.volumeUp], repeat: 4, label: 'Volume up' },
  'volume-down': { keys: [VK.volumeDown], repeat: 4, label: 'Volume down' },
  'volume-mute': { keys: [VK.mute], label: 'Mute' },
  'media-play': { keys: [VK.playPause], label: 'Play/pause' },
  'media-next': { keys: [VK.nextTrack], label: 'Next track' },
  'media-prev': { keys: [VK.prevTrack], label: 'Previous track' },
  // Ctrl+Tab in whatever is focused. In a browser that is the next tab; in an
  // editor, the next document. It is the same key either way.
  'next-tab': { keys: [VK.ctrl, VK.tab], label: 'Next tab' },
  'prev-tab': { keys: [VK.ctrl, VK.shift, VK.tab], label: 'Previous tab' },
  // Alt+Tab. Held briefly rather than tapped, or Windows shows the switcher
  // and dismisses it before the selection lands.
  'next-window': { keys: [VK.alt, VK.tab], hold: 180, label: 'Next window' },
  'desktop-left': { keys: [VK.ctrl, VK.win, VK.left], label: 'Desktop left' },
  'desktop-right': { keys: [VK.ctrl, VK.win, VK.right], label: 'Desktop right' },
}

export const osActions = () =>
  Object.entries(ACTIONS).map(([id, a]) => ({ id, label: a.label }))

/**
 * Press one combination.
 *
 * keybd_event rather than SendKeys: SendKeys goes through the shell's
 * automation layer, which refuses Alt+Tab outright and is unreliable for media
 * keys. keybd_event is the low-level call the keyboard driver itself uses, so
 * the system cannot tell the difference between this and the real key.
 *
 * Passed base64 UTF-16LE for the same reason as everything else here: Node's
 * argument escaping mangles quotes on the way to powershell.exe, and the
 * statements that break do so silently.
 */
function pressKeys(keys, holdMs = 40) {
  const downs = keys.map((k) => `[JK]::keybd_event(${k},0,0,[UIntPtr]::Zero)`).join('; ')
  // Released in reverse, so modifiers outlive the key they modify — releasing
  // Ctrl before Tab is not the chord anyone meant.
  const ups = [...keys].reverse().map((k) => `[JK]::keybd_event(${k},0,2,[UIntPtr]::Zero)`).join('; ')
  const ps = [
    `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class JK { [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra); }'`,
    downs,
    `Start-Sleep -Milliseconds ${holdMs}`,
    ups,
  ].join('; ')

  return new Promise((resolve) => {
    const encoded = Buffer.from(ps, 'utf16le').toString('base64')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true },
    )
    let err = ''
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'timed out' }) }, 6000)
    child.stderr.on('data', (d) => (err += d))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().slice(0, 200) || `exit ${code}` })
    })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e.message) }) })
  })
}

export async function runOsAction(id) {
  if (process.platform !== 'win32') return { ok: false, error: 'only implemented on Windows' }
  const action = ACTIONS[id]
  if (!action) return { ok: false, error: `unknown action: ${String(id).slice(0, 40)}` }

  for (let i = 0; i < (action.repeat ?? 1); i++) {
    const r = await pressKeys(action.keys, action.hold ?? 40)
    if (!r.ok) return r
  }
  return { ok: true, did: action.label }
}
