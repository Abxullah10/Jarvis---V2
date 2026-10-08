// Temporary diagnostic: Settings panel end to end. Read-only: never clicks
// Connect or Disconnect.
import WebSocket from 'ws'

const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let target
for (let i = 0; i < 40 && !target; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    target = list.find((t) => t.type === 'page' && t.url.includes('5173'))
  } catch { /* chrome still starting */ }
  if (!target) await sleep(500)
}
if (!target) { console.log('NO PAGE FOUND'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.once('open', r))
let id = 0
const call = (method, params = {}) =>
  new Promise((resolve) => {
    const my = ++id
    const on = (raw) => {
      const m = JSON.parse(raw.toString())
      if (m.id === my) { ws.off('message', on); resolve(m.result) }
    }
    ws.on('message', on)
    ws.send(JSON.stringify({ id: my, method, params }))
  })
const evaluate = async (expr) =>
  (await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value
const click = async (selector) => {
  const at = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (!at) return false
  for (const type of ['mousePressed', 'mouseReleased'])
    await call('Input.dispatchMouseEvent', { type, x: at.x, y: at.y, button: 'left', clickCount: 1 })
  return true
}

await sleep(3000)
await evaluate(`[...document.querySelectorAll('button')].find(b => /initiali/i.test(b.textContent))?.click()`)
await sleep(12000)

console.log('status line after boot:', await evaluate(`document.querySelector('.status-text')?.textContent`))
console.log('clicked Settings:', await click('.settings-open'))
await sleep(5000) // status checks call Google and Slack

console.log(JSON.stringify(await evaluate(`(() => {
  const p = document.querySelector('.set-panel');
  if (!p) return { open: false };
  const r = p.getBoundingClientRect();
  return {
    open: true,
    panel: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    rows: [...document.querySelectorAll('.set-row')].map(row =>
      row.querySelector('.set-name')?.textContent + ' | ' + row.querySelector('.set-status')?.textContent + ' | ' + row.querySelector('.set-sub')?.textContent),
    buttons: [...p.querySelectorAll('.set-btn')].map(b => b.textContent),
    errors: [...p.querySelectorAll('.set-error')].map(e => e.textContent),
    privacyItems: p.querySelectorAll('.set-list li').length,
  };
})()`), null, 2))

// Escape must close Settings and must NOT stand JARVIS down.
const phaseBefore = await evaluate(`document.querySelector('.status-text')?.textContent`)
await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(600)
console.log('after Escape:', JSON.stringify(await evaluate(`({ settingsOpen: !!document.querySelector('.set-panel'), statusBefore: ${JSON.stringify(phaseBefore)}, statusAfter: document.querySelector('.status-text')?.textContent })`)))

ws.close()
process.exit(0)
